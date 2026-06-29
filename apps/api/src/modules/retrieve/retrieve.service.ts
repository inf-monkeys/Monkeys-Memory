import { AppDataSource } from '../../database/ormconfig.js';
import { env } from '../../config/env.js';
import { embedRetrieveQuery, explainRule, sortByScore, type RepoScanContext } from './scorer.js';
import { cosineSimilarity } from './embedding.js';
import { normalizeTaskType } from '../../shared/utils.js';
import { evaluateMemoryPolicy } from '../policy/policy-engine.js';
import type { CompiledRule, MemoryPolicy, RetrieveRequest, RulePack } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

interface ScoredRule extends CompiledRule {
  runtime_score: number;
  org_level?: boolean;
  hierarchy_layer?: MemoryPolicy['visibility'];
}

function isRuleAllowed(rule: CompiledRule, req: RetrieveRequest): boolean {
  return evaluateMemoryPolicy(rule, req).allowed;
}

type HierarchyLayer = 'user' | 'team' | 'template' | 'repo' | 'org' | 'global';

function hierarchyLayer(rule: CompiledRule, fallback: HierarchyLayer = 'repo'): HierarchyLayer {
  const visibility = rule.policy?.visibility;
  if (visibility === 'user' || visibility === 'team' || visibility === 'template' || visibility === 'repo' || visibility === 'org' || visibility === 'global') return visibility;
  if (rule.policy?.template_id) return 'template';
  return fallback;
}

function emptyHierarchy(): Record<HierarchyLayer, ScoredRule[]> {
  return { user: [], team: [], template: [], repo: [], org: [], global: [] };
}

function addHierarchyEntry(hierarchy: Record<HierarchyLayer, ScoredRule[]>, rule: ScoredRule, fallback: HierarchyLayer) {
  const layer = hierarchyLayer(rule, fallback);
  hierarchy[layer].push({ ...rule, hierarchy_layer: layer });
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))].sort();
}

function repoScanContext(metadata: Record<string, unknown>): RepoScanContext {
  const profile = metadata.repo_profile && typeof metadata.repo_profile === 'object'
    ? metadata.repo_profile as Record<string, unknown>
    : {};
  return {
    knownPaths: stringList(metadata.known_paths),
    knownDirs: stringList(metadata.known_dirs),
    repoKind: typeof profile.kind === 'string' ? profile.kind : null,
  };
}

function scorePackItems(items: CompiledRule[] | undefined, req: RetrieveRequest, queryEmbedding: number[], vectorSimilarityById: Map<string, number>, options: { orgLevel?: boolean; scoreMultiplier?: number; fallbackLayer?: HierarchyLayer; repoContext?: RepoScanContext } = {}) {
  return (items ?? [])
    .filter(r => isRuleAllowed(r, req))
    .map(r => {
      const scored = explainRule(r, req.path ?? null, req.task ?? null, {
        queryEmbedding,
        vectorSimilarity: vectorSimilarityById.get(r.id),
        orgLevel: options.orgLevel,
        repoContext: options.repoContext,
      });
      const score = Number((scored.score * (options.scoreMultiplier ?? 1)).toFixed(2));
      return { ...r, runtime_score: score, explanation: scored.explanation, org_level: options.orgLevel, hierarchy_layer: hierarchyLayer(r, options.fallbackLayer ?? 'repo') };
    })
    .filter(r => r.runtime_score > 0)
    .sort(sortByScore);
}

export class RetrieveService {
  async retrieve(orgId: string, req: RetrieveRequest) {
    const config = env.defaultCompileConfig;
    const limit = req.limit ?? config.runtimeRuleLimit;

    // Find repo
    const repos = await AppDataSource.query(
      `SELECT id, name, allowlisted, metadata FROM "${orgId}_repos" WHERE name = $1 AND is_deleted = false`,
      [req.repo],
    );

    if (repos.length === 0 || !repos[0].allowlisted) {
      return { enabled: false, reason: 'repo not in allowlist', org_id: orgId, repo: req.repo, rules: [], exceptions: [], org_rules: [], hierarchy: emptyHierarchy() };
    }

    const repoId = repos[0].id;
    const metadata = parseJsonField<Record<string, unknown>>(repos[0].metadata, {});
    const repoContext = repoScanContext(metadata);

    // Load latest compiled rules
    const compiled = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules" WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false ORDER BY version DESC LIMIT 1`,
      [repoId],
    );

    if (compiled.length === 0) {
      return { enabled: true, org_id: orgId, repo: req.repo, path: req.path ?? null, task: req.task ?? null, rules: [], exceptions: [], org_rules: [], hierarchy: emptyHierarchy() };
    }

    const pack: RulePack = typeof compiled[0].content === 'string'
      ? JSON.parse(compiled[0].content)
      : compiled[0].content;
    const queryEmbedding = await embedRetrieveQuery(req.repo, req.path, req.task, env.embeddings);
    const vectorSimilarityById = new Map<string, number>();
    for (const item of pack.vector_index?.items ?? []) {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      if (similarity > 0) vectorSimilarityById.set(item.id, similarity);
    }

    const hierarchy = emptyHierarchy();

    // Score and rank repo-pack memory by kind.
    const scoredRules = scorePackItems(pack.rules, req, queryEmbedding, vectorSimilarityById, { fallbackLayer: 'repo', repoContext });
    const rules: ScoredRule[] = scoredRules.slice(0, limit);
    for (const rule of scoredRules) addHierarchyEntry(hierarchy, rule, 'repo');

    const scoredExceptions = scorePackItems(pack.exceptions, req, queryEmbedding, vectorSimilarityById, { fallbackLayer: 'repo', repoContext });
    const exceptions: ScoredRule[] = scoredExceptions.slice(0, Math.min(3, limit));
    for (const exception of scoredExceptions) addHierarchyEntry(hierarchy, exception, 'repo');

    for (const item of scorePackItems([...(pack.procedures ?? []), ...(pack.checklists ?? []), ...(pack.notes ?? [])], req, queryEmbedding, vectorSimilarityById, { fallbackLayer: 'repo', repoContext })) {
      addHierarchyEntry(hierarchy, item, 'repo');
    }

    // Load org-level rules
    const orgCompiled = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules" WHERE repo_id IS NULL AND rule_type = 'org' AND is_deleted = false ORDER BY version DESC LIMIT 1`,
    );

    let orgRules: ScoredRule[] = [];
    if (orgCompiled.length > 0) {
      const orgPack = typeof orgCompiled[0].content === 'string'
        ? JSON.parse(orgCompiled[0].content)
        : orgCompiled[0].content;
      const repoClaimSet = new Set(rules.map(r => r.claim));
      orgRules = scorePackItems((orgPack.rules ?? [])
        .filter((r: CompiledRule) => !repoClaimSet.has(r.claim))
        , req, queryEmbedding, new Map(), { orgLevel: true, scoreMultiplier: 0.7, fallbackLayer: 'org', repoContext })
        .slice(0, 3);
      for (const rule of orgRules) addHierarchyEntry(hierarchy, rule, 'org');
    }

    for (const layer of Object.keys(hierarchy) as HierarchyLayer[]) {
      hierarchy[layer] = hierarchy[layer]
        .sort(sortByScore)
        .slice(0, limit);
    }

    return {
      enabled: true,
      org_id: orgId,
      repo: req.repo,
      path: req.path ?? null,
      task: req.task ?? null,
      rules,
      exceptions,
      org_rules: orgRules,
      hierarchy,
    };
  }
}

export const retrieveService = new RetrieveService();
