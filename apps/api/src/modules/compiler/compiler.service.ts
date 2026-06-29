import { AppDataSource } from '../../database/ormconfig.js';
import { env } from '../../config/env.js';
import { clamp, confidenceBucket, uniqueSorted, maxIsoDate, slugify, normalizeText, normalizeTaskType } from '../../shared/utils.js';
import { makeGroupKey, mergeGroupsByFuzzyClaim } from './merger.js';
import { detectConflicts } from './conflict-detector.js';
import { applyConfidenceDecay } from './decay.js';
import { logger } from '../../shared/logger.js';
import { buildSemanticRelations } from './semantic.js';
import { buildEmbeddingAdapter } from '../retrieve/embedding.js';
import type { EntityDefinition, Experience, CompiledRule, CompileConfig, MemoryCompilerPluginConfig, MemoryQuality, RulePack, VectorIndex } from '../../shared/types.js';

type FeedbackRow = {
  outcome: 'helpful' | 'not-relevant' | 'outdated' | 'accepted' | 'failed';
  source_experience_ids: string[] | string;
  created_at: string;
};

type RepoCompileRow = {
  name: string;
  last_compiled_at?: string | Date | null;
  metadata?: Record<string, unknown> | string | null;
};

function getConfig(orgConfig: Record<string, unknown>): CompileConfig {
  const d = env.defaultCompileConfig;
  const plugins = normalizeCompilerPlugins(orgConfig.plugins);

  return {
    runtimeRuleLimit: (orgConfig.runtimeRuleLimit as number) ?? d.runtimeRuleLimit,
    onboardingRuleLimit: (orgConfig.onboardingRuleLimit as number) ?? d.onboardingRuleLimit,
    fuzzyMergeThreshold: (orgConfig.fuzzyMergeThreshold as number) ?? d.fuzzyMergeThreshold,
    confidenceDecayStartDays: (orgConfig.confidenceDecayStartDays as number) ?? d.confidenceDecayStartDays,
    confidenceDecayRatePerMonth: (orgConfig.confidenceDecayRatePerMonth as number) ?? d.confidenceDecayRatePerMonth,
    confidenceDecayMax: (orgConfig.confidenceDecayMax as number) ?? d.confidenceDecayMax,
    plugins,
  };
}

function normalizeCompilerPlugins(value: unknown): MemoryCompilerPluginConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((plugin): plugin is Record<string, unknown> => Boolean(plugin) && typeof plugin === 'object')
    .map((plugin) => ({
      id: typeof plugin.id === 'string' && plugin.id.trim() ? plugin.id.trim() : 'custom',
      enabled: plugin.enabled !== false,
      kind: ['quality', 'semantic', 'policy', 'export', 'custom'].includes(String(plugin.kind)) ? plugin.kind as MemoryCompilerPluginConfig['kind'] : 'custom',
      mode: plugin.mode === 'webhook' ? 'webhook' as const : 'managed' as const,
      endpoint: typeof plugin.endpoint === 'string' && plugin.endpoint.trim() ? plugin.endpoint.trim() : null,
    }))
    .slice(0, 12);
}

function buildCompilerPluginRuns(config: CompileConfig) {
  return (config.plugins ?? []).map((plugin) => {
    if (!plugin.enabled) {
      return {
        id: plugin.id,
        kind: plugin.kind,
        mode: plugin.mode ?? 'managed',
        status: 'skipped' as const,
        reason: 'disabled',
      };
    }
    if (plugin.mode === 'webhook' && !plugin.endpoint) {
      return {
        id: plugin.id,
        kind: plugin.kind,
        mode: 'webhook',
        status: 'skipped' as const,
        reason: 'missing endpoint',
      };
    }
    return {
      id: plugin.id,
      kind: plugin.kind,
      mode: plugin.mode ?? 'managed',
      status: 'configured' as const,
    };
  });
}

function mergeExperiences(kind: string, experiences: Experience[]): CompiledRule {
  const first = experiences[0];
  const count = experiences.length;
  const evidenceCount = experiences.reduce((t, e) => t + (e.evidence?.length ?? 0), 0);
  const avgConf = experiences.reduce((t, e) => t + e.confidence, 0) / count;
  const evidenceBonus = Math.min(evidenceCount * 0.015, 0.09);
  const supportBonus = Math.min((count - 1) * 0.06, 0.18);
  const contestedPenalty = experiences.some(e => e.lifecycle?.state === 'contested') ? 0.12 : 0;
  const stalePenalty = experiences.some(e => e.lifecycle?.state === 'stale') ? 0.16 : 0;
  const confScore = clamp(avgConf + supportBonus + evidenceBonus - contestedPenalty - stalePenalty, 0, 1);
  const title = experiences.map(e => e.title).sort((a, b) => a.length - b.length)[0];
  const claim = experiences.map(e => e.claim).sort((a, b) => a.length - b.length)[0];
  const paths = uniqueSorted(experiences.flatMap(e => e.scope.paths));
  const taskTypes = uniqueSorted(experiences.flatMap(e => (e.scope.task_types ?? []).map(normalizeTaskType)));
  const entities = uniqueSorted(experiences.flatMap(e => e.scope.entities ?? []));
  const updatedAt = maxIsoDate(experiences.map(e => e.updated_at));
  const lifecycleState = experiences.some(e => e.lifecycle?.state === 'contested')
    ? 'contested'
    : experiences.some(e => e.lifecycle?.state === 'stale')
      ? 'stale'
      : experiences.some(e => e.lifecycle?.state === 'confirmed')
        ? 'confirmed'
        : experiences.some(e => e.lifecycle?.state === 'candidate')
          ? 'candidate'
          : 'active';
  const lifecycleReason = experiences
    .filter(e => e.lifecycle?.state === lifecycleState)
    .sort((a, b) => (b.lifecycle?.updated_at ?? b.updated_at).localeCompare(a.lifecycle?.updated_at ?? a.updated_at))[0]
    ?.lifecycle?.reason ?? null;
  const quality = computeQualityScore({
    claim,
    paths,
    sourceCount: count,
    evidenceCount,
    confidenceScore: confScore,
    lifecycleState,
  });
  const policy: CompiledRule['policy'] = {
    visibility: first.policy?.visibility ?? 'repo',
    sensitivity: experiences.some(e => e.policy?.sensitivity === 'secret-adjacent')
      ? 'secret-adjacent'
      : experiences.some(e => e.policy?.sensitivity === 'internal') ? 'internal' : 'normal',
    redaction_status: experiences.some(e => e.policy?.redaction_status === 'redacted') ? 'redacted' : 'not_scanned',
  };
  const redactionCategories = uniqueSorted(experiences.flatMap(e => e.policy?.redaction_categories ?? []));
  if (redactionCategories.length > 0) policy.redaction_categories = redactionCategories;
  if (first.policy?.user_id) policy.user_id = first.policy.user_id;
  if (first.policy?.team_id) policy.team_id = first.policy.team_id;
  if (first.policy?.template_id) policy.template_id = first.policy.template_id;

  return {
    id: slugify(`${first.repo_id}-${kind}-${title}`),
    kind: kind as CompiledRule['kind'],
    title,
    claim,
    scope: {
      paths,
      task_types: taskTypes,
      entities,
    },
    confidence: confidenceBucket(confScore),
    confidence_score: Number(confScore.toFixed(2)),
    quality_score: quality.total,
    quality,
    source_count: count,
    evidence_count: evidenceCount,
    updated_at: updatedAt,
    sources: uniqueSorted(experiences.map(e => e.id)),
    lifecycle: {
      state: lifecycleState,
      reason: lifecycleReason,
      updated_at: updatedAt,
    },
    provenance: {
      authors: uniqueSorted(experiences.map(e => e.provenance?.author ?? e.author_id)),
      source_types: uniqueSorted(experiences.map(e => e.provenance?.source_type ?? e.source_type)),
      evidence_refs: uniqueSorted(experiences.flatMap(e => e.provenance?.evidence_refs ?? e.evidence?.map(item => item.ref) ?? [])),
    },
    relationships: {
      supports: uniqueSorted(experiences.map(e => e.id)),
      contradicts: uniqueSorted(experiences.flatMap(e => e.relationships?.contradicts ?? [])),
      supersedes: uniqueSorted(experiences.flatMap(e => e.relationships?.supersedes ?? [])),
      superseded_by: uniqueSorted(experiences.flatMap(e => e.relationships?.superseded_by ?? [])),
      specializes: uniqueSorted(experiences.flatMap(e => e.relationships?.specializes ?? [])),
      generalizes: uniqueSorted(experiences.flatMap(e => e.relationships?.generalizes ?? [])),
      related_to: uniqueSorted(experiences.flatMap(e => e.relationships?.related_to ?? [])),
    },
    policy,
    validity: {
      branches: uniqueSorted(experiences.flatMap(e => e.validity?.branches ?? [])),
      valid_from_commit: experiences.map(e => e.validity?.valid_from_commit).filter(Boolean).sort()[0] ?? null,
      valid_until_commit: maxIsoDate(experiences.map(e => e.validity?.valid_until_commit ?? undefined)),
      tags: uniqueSorted(experiences.flatMap(e => e.validity?.tags ?? [])),
    },
  };
}

function computeQualityScore(input: {
  claim: string;
  paths: string[];
  sourceCount: number;
  evidenceCount: number;
  confidenceScore: number;
  lifecycleState: string;
}): MemoryQuality {
  const clarity = clamp(input.claim.length >= 24 && input.claim.length <= 220 ? 0.9 : 0.65, 0, 1);
  const specificityScore = input.paths.some(p => p !== '**' && p !== '**/*') ? 0.85 : 0.45;
  const evidenceStrength = clamp(input.evidenceCount * 0.2 + Math.min(input.sourceCount * 0.15, 0.45), 0, 1);
  const freshness = input.lifecycleState === 'stale'
    ? 0.35
    : input.lifecycleState === 'contested'
      ? 0.55
      : input.lifecycleState === 'candidate'
        ? 0.62
        : 0.85;
  const conflictRisk = input.lifecycleState === 'contested' ? 0.8 : 0.15;
  const actionability = /\b(should|must|use|avoid|route|verify|ensure|prefer|keep|add|update|run)\b/i.test(input.claim) ? 0.9 : 0.65;
  const total = clamp(
    clarity * 0.16 +
      specificityScore * 0.18 +
      evidenceStrength * 0.16 +
      freshness * 0.16 +
      (1 - conflictRisk) * 0.14 +
      actionability * 0.12 +
      input.confidenceScore * 0.08,
    0,
    1,
  );
  return {
    total: Number(total.toFixed(2)),
    clarity: Number(clarity.toFixed(2)),
    specificity: Number(specificityScore.toFixed(2)),
    evidence_strength: Number(evidenceStrength.toFixed(2)),
    freshness: Number(freshness.toFixed(2)),
    conflict_risk: Number(conflictRisk.toFixed(2)),
    actionability: Number(actionability.toFixed(2)),
  };
}

function sortRules(a: CompiledRule, b: CompiledRule): number {
  return b.confidence_score - a.confidence_score
    || b.source_count - a.source_count
    || b.evidence_count - a.evidence_count
    || a.id.localeCompare(b.id);
}

function allPackItems(rulePack: RulePack): CompiledRule[] {
  return [
    ...rulePack.rules,
    ...rulePack.exceptions,
    ...(rulePack.procedures ?? []),
    ...(rulePack.checklists ?? []),
    ...(rulePack.notes ?? []),
  ];
}

function buildPathIndex(rulePack: RulePack) {
  const pathMap: Record<string, { rules: string[]; exceptions: string[] }> = {};
  for (const rule of allPackItems(rulePack)) {
    for (const p of rule.scope.paths) {
      pathMap[p] ??= { rules: [], exceptions: [] };
      if (rule.kind === 'exception') pathMap[p].exceptions.push(rule.id);
      else pathMap[p].rules.push(rule.id);
    }
  }
  for (const v of Object.values(pathMap)) {
    v.rules = uniqueSorted(v.rules);
    v.exceptions = uniqueSorted(v.exceptions);
  }
  return { version: 1, org_id: rulePack.org_id, repo_name: rulePack.repo_name, generated_at: rulePack.generated_at, paths: pathMap };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeEntityDefinitions(metadata: Record<string, unknown>): Record<string, EntityDefinition[]> {
  const entities = metadata.code_entities ?? metadata.entity_definitions;
  if (!Array.isArray(entities)) return {};
  const definitions: Record<string, EntityDefinition[]> = {};
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue;
    const row = entity as Record<string, unknown>;
    const id = stringValue(row.id) ?? (stringValue(row.kind) && stringValue(row.name) ? `${stringValue(row.kind)}:${stringValue(row.name)}` : null);
    const path = stringValue(row.path);
    if (!id || !path) continue;
    definitions[id] ??= [];
    definitions[id].push({
      kind: stringValue(row.kind) ?? undefined,
      name: stringValue(row.name) ?? id,
      path,
      line: numberValue(row.line),
    });
  }
  for (const values of Object.values(definitions)) {
    values.sort((left, right) => `${left.path}:${left.line ?? 0}`.localeCompare(`${right.path}:${right.line ?? 0}`));
  }
  return definitions;
}

function buildEntityIndex(rulePack: RulePack, metadata: Record<string, unknown>) {
  const entityMap: Record<string, { rules: string[]; exceptions: string[]; procedures: string[]; checklists: string[]; definitions: EntityDefinition[] }> = {};
  const definitions = normalizeEntityDefinitions(metadata);
  for (const item of allPackItems(rulePack)) {
    for (const entity of item.scope.entities ?? []) {
      entityMap[entity] ??= { rules: [], exceptions: [], procedures: [], checklists: [], definitions: [] };
      if (item.kind === 'exception') entityMap[entity].exceptions.push(item.id);
      else if (item.kind === 'procedure') entityMap[entity].procedures.push(item.id);
      else if (item.kind === 'checklist') entityMap[entity].checklists.push(item.id);
      else entityMap[entity].rules.push(item.id);
    }
  }
  for (const [entityId, entityDefinitions] of Object.entries(definitions)) {
    entityMap[entityId] ??= { rules: [], exceptions: [], procedures: [], checklists: [], definitions: [] };
    entityMap[entityId].definitions.push(...entityDefinitions);
  }
  for (const value of Object.values(entityMap)) {
    value.rules = uniqueSorted(value.rules);
    value.exceptions = uniqueSorted(value.exceptions);
    value.procedures = uniqueSorted(value.procedures);
    value.checklists = uniqueSorted(value.checklists);
    value.definitions = value.definitions.sort((left, right) => `${left.path}:${left.line ?? 0}`.localeCompare(`${right.path}:${right.line ?? 0}`));
  }
  return { version: 1, org_id: rulePack.org_id, repo_name: rulePack.repo_name, generated_at: rulePack.generated_at, entities: entityMap };
}

function buildReviewQueue(rulePack: RulePack) {
  const items = [];
  const consistency = (rulePack as RulePack & {
    consistency?: {
      findings?: Array<{ rule_id?: string; reason?: string; severity?: string; claim?: string }>;
    };
  }).consistency;
  const driftByRule = new Map<string, Array<{ reason?: string; severity?: string }>>();
  for (const finding of consistency?.findings ?? []) {
    if (!finding.rule_id) continue;
    const bucket = driftByRule.get(finding.rule_id) ?? [];
    bucket.push(finding);
    driftByRule.set(finding.rule_id, bucket);
  }
  for (const item of allPackItems(rulePack)) {
    if (item.lifecycle?.state === 'stale') items.push({ id: item.id, reason: 'stale', priority: 'high', claim: item.claim });
    if (item.lifecycle?.state === 'contested' || (item.conflicts_with?.length ?? 0) > 0) {
      items.push({ id: item.id, reason: 'conflict', priority: 'high', claim: item.claim, conflicts_with: item.conflicts_with ?? [] });
    }
    if (item.evidence_count === 0 && item.confidence_score >= 0.8) {
      items.push({ id: item.id, reason: 'high-confidence-without-evidence', priority: 'medium', claim: item.claim });
    }
    if ((item.quality_score ?? 1) < 0.55) items.push({ id: item.id, reason: 'low-quality', priority: 'medium', claim: item.claim });
    if (item.lifecycle?.state === 'candidate' && item.provenance?.source_types?.includes('trajectory')) {
      items.push({ id: item.id, reason: 'trajectory-candidate', priority: 'medium', claim: item.claim });
    }
    if (item.policy?.sensitivity && item.policy.sensitivity !== 'normal') {
      items.push({ id: item.id, reason: 'policy-sensitive', priority: 'medium', claim: item.claim, sensitivity: item.policy.sensitivity });
    }
    const driftFindings = driftByRule.get(item.id) ?? [];
    if (driftFindings.length > 0) {
      items.push({
        id: item.id,
        reason: 'consistency-drift',
        priority: driftFindings.some(finding => finding.severity === 'high') ? 'high' : 'medium',
        claim: item.claim,
        drift_reasons: uniqueSorted(driftFindings.map(finding => finding.reason ?? 'unknown')),
      });
    }
  }
  return { version: 1, org_id: rulePack.org_id, repo_name: rulePack.repo_name, generated_at: rulePack.generated_at, items };
}

async function attachEmbeddings(rulePack: RulePack): Promise<VectorIndex | null> {
  const adapter = buildEmbeddingAdapter(env.embeddings);
  if (!adapter) return null;
  const items = allPackItems(rulePack);
  for (const item of items) {
    item.embedding_model = adapter.model;
    item.embedding = await adapter.embed([item.claim, item.scope.paths.join(' '), item.scope.entities?.join(' ') ?? ''].join(' '));
  }
  return {
    version: 1,
    provider: adapter.provider,
    dimensions: adapter.dimensions,
    items: items.map(item => ({
      id: item.id,
      kind: item.kind,
      claim: item.claim,
      embedding_model: item.embedding_model,
      embedding: item.embedding ?? [],
    })),
  };
}

function normalizeExperience(row: Experience): Experience {
  const evidence = row.evidence ?? [];
  return {
    ...row,
    kind: row.kind ?? 'rule',
    scope: {
      paths: row.scope.paths,
      task_types: (row.scope.task_types ?? []).map(normalizeTaskType),
      entities: uniqueSorted(row.scope.entities ?? []),
    },
    evidence,
    lifecycle: row.lifecycle ?? { state: row.status === 'deprecated' ? 'deprecated' : 'active', updated_at: row.updated_at },
    provenance: {
      source_type: row.provenance?.source_type ?? row.source_type,
      author: row.provenance?.author ?? row.author_id,
      session: row.provenance?.session ?? 'unknown',
      commit: row.provenance?.commit ?? null,
      branch: row.provenance?.branch ?? null,
      imported_from: row.provenance?.imported_from ?? null,
      evidence_refs: uniqueSorted([...(row.provenance?.evidence_refs ?? []), ...evidence.map(item => item.ref)]),
    },
    relationships: row.relationships ?? {},
    policy: row.policy ?? { visibility: 'repo', sensitivity: 'normal', redaction_status: 'not_scanned' },
    validity: row.validity ?? { branches: [], valid_from_commit: null, valid_until_commit: null, tags: [] },
  };
}

function parseJsonField<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as T;
}

function extractConsistency(metadata: RepoCompileRow['metadata']) {
  const parsed = parseJsonField<Record<string, unknown>>(metadata, {});
  return parsed.consistency ?? null;
}

async function recordCompileMetric(
  orgId: string,
  repoId: string | null,
  metricType: 'compile_latency_ms' | 'compile_sync_delay_ms',
  valueMs: number,
) {
  if (!Number.isFinite(valueMs) || valueMs < 0) return;
  const date = new Date().toISOString().slice(0, 10);
  const roundedMs = Math.round(valueMs);
  const metricId = `${date}_${metricType}_${repoId ?? 'org'}`;
  await AppDataSource.query(
    `INSERT INTO "${orgId}_usage_metrics" (id, date, metric_type, count, details)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (id) DO UPDATE
       SET count = "${orgId}_usage_metrics".count + 1,
           details = jsonb_build_object(
             'repo_id', $5,
             'last_ms', $6,
             'total_ms', COALESCE(("${orgId}_usage_metrics".details ->> 'total_ms')::numeric, 0) + $6,
             'max_ms', GREATEST(COALESCE(("${orgId}_usage_metrics".details ->> 'max_ms')::numeric, 0), $6),
             'updated_at', NOW()
           )`,
    [
      metricId,
      date,
      metricType,
      JSON.stringify({ repo_id: repoId, last_ms: roundedMs, total_ms: roundedMs, max_ms: roundedMs }),
      repoId,
      roundedMs,
    ],
  );
}

function computeSyncDelayMs(experiences: Experience[], lastCompiledAt: RepoCompileRow['last_compiled_at'], compiledAtMs: number) {
  const lastCompiledMs = lastCompiledAt ? new Date(lastCompiledAt).getTime() : 0;
  const pendingTimes = experiences
    .map(exp => new Date(exp.updated_at).getTime())
    .filter(time => Number.isFinite(time) && time > lastCompiledMs);
  if (pendingTimes.length === 0) return null;
  return Math.max(0, compiledAtMs - Math.min(...pendingTimes));
}

function applyFeedback(experiences: Experience[], feedbackRows: FeedbackRow[]) {
  const byId = new Map(experiences.map(exp => [exp.id, exp]));
  const orderedRows = [...feedbackRows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const row of orderedRows) {
    const sourceIds = parseJsonField<string[]>(row.source_experience_ids, []);
    for (const sourceId of sourceIds) {
      const exp = byId.get(sourceId);
      if (!exp) continue;

      if (row.outcome === 'helpful' || row.outcome === 'accepted') {
        exp.confidence = clamp(exp.confidence + 0.08, 0, 1);
        exp.lifecycle = { ...(exp.lifecycle ?? {}), state: 'confirmed', reason: `feedback:${row.outcome}`, updated_at: row.created_at };
      } else if (row.outcome === 'outdated') {
        exp.confidence = clamp(exp.confidence - 0.15, 0, 1);
        exp.lifecycle = { ...(exp.lifecycle ?? {}), state: 'stale', reason: 'feedback:outdated', updated_at: row.created_at };
      } else {
        exp.confidence = clamp(exp.confidence - 0.18, 0, 1);
        exp.lifecycle = { ...(exp.lifecycle ?? {}), state: 'contested', reason: `feedback:${row.outcome}`, updated_at: row.created_at };
      }
    }
  }
}

function buildOnboarding(rulePack: RulePack, config: CompileConfig): string {
  const top = rulePack.rules.slice(0, config.onboardingRuleLimit);
  const lines = [`# Onboarding Digest: ${rulePack.repo_name}`, '', `Generated at: ${rulePack.generated_at}`, '', '## What this repo tends to expect', ''];
  if (top.length === 0) { lines.push('- No compiled rules yet.'); }
  else { for (const r of top) lines.push(`- [${r.confidence}] ${r.claim} (${r.source_count} sources, scope: ${r.scope.paths.join(', ')})`); }
  const exc = rulePack.exceptions.slice(0, 5);
  lines.push('', '## Exceptions worth knowing', '');
  if (exc.length === 0) { lines.push('- No compiled exceptions yet.'); }
  else { for (const e of exc) lines.push(`- [${e.confidence}] ${e.claim} (${e.source_count} sources, scope: ${e.scope.paths.join(', ')})`); }
  return lines.join('\n') + '\n';
}

export class CompilerService {
  async compileRepo(orgId: string, repoId: string): Promise<{ ruleCount: number; exceptionCount: number }> {
    const startedAt = Date.now();
    const org = await AppDataSource.query(`SELECT compile_config FROM orgs WHERE id = $1`, [orgId]);
    const config = getConfig(org[0]?.compile_config ?? {});

    // Load repo info
    const repos = await AppDataSource.query(`SELECT name, last_compiled_at, metadata FROM "${orgId}_repos" WHERE id = $1`, [repoId]) as RepoCompileRow[];
    if (repos.length === 0) throw new Error(`Repo ${repoId} not found`);
    const repoName = repos[0].name;

    // Load active experiences
    const rows = await AppDataSource.query(
      `SELECT * FROM "${orgId}_experiences" WHERE repo_id = $1 AND status = 'active' AND is_deleted = false`,
      [repoId],
    );

    const experiences: Experience[] = rows.map((r: Record<string, unknown>) => normalizeExperience({
      ...r,
      scope: parseJsonField(r.scope as Experience['scope'] | string, { paths: [], task_types: [] }),
      evidence: parseJsonField(r.evidence as Experience['evidence'] | string, []),
      lifecycle: parseJsonField(r.lifecycle as Experience['lifecycle'] | string | null, undefined),
      provenance: parseJsonField(r.provenance as Experience['provenance'] | string | null, undefined),
      relationships: parseJsonField(r.relationships as Experience['relationships'] | string | null, undefined),
      policy: parseJsonField(r.policy as Experience['policy'] | string | null, undefined),
      validity: parseJsonField(r.validity as Experience['validity'] | string | null, undefined),
      confidence: Number(r.confidence),
      updated_at: r.updated_at ? new Date(r.updated_at as string).toISOString() : new Date().toISOString(),
    } as Experience)) as Experience[];

    const feedbackRows = await AppDataSource.query(
      `SELECT outcome, source_experience_ids, created_at
       FROM "${orgId}_feedback_events"
       WHERE repo_id = $1
       ORDER BY created_at ASC`,
      [repoId],
    ) as FeedbackRow[];
    applyFeedback(experiences, feedbackRows);

    // Apply decay
    for (const exp of experiences) applyConfidenceDecay(exp, config);

    // Group
    const grouped = new Map<string, Experience[]>();
    for (const exp of experiences) {
      const key = makeGroupKey(exp);
      const bucket = grouped.get(key) ?? [];
      bucket.push(exp);
      grouped.set(key, bucket);
    }

    // Fuzzy merge
    const merged = mergeGroupsByFuzzyClaim(grouped, config.fuzzyMergeThreshold);

    // Build rules
    const items = [...merged.values()].map(bucket => mergeExperiences(bucket[0].kind ?? 'rule', bucket));
    const allRules = items.filter(i => i.kind === 'rule');
    detectConflicts(allRules);

    const now = new Date().toISOString();
    const rulePack: RulePack = {
      version: 1,
      org_id: orgId,
      repo_id: repoId,
      repo_name: repoName,
      generated_at: now,
      source_experience_count: experiences.length,
      rules: allRules.sort(sortRules),
      exceptions: items.filter(i => i.kind === 'exception').sort(sortRules),
      procedures: items.filter(i => i.kind === 'procedure').sort(sortRules),
      checklists: items.filter(i => i.kind === 'checklist').sort(sortRules),
      notes: items.filter(i => i.kind === 'note').sort(sortRules),
    };
    const consistency = extractConsistency(repos[0].metadata);
    if (consistency) {
      Object.assign(rulePack, { consistency });
    }

    const semanticRelations = buildSemanticRelations(rulePack);
    const vectorIndex = await attachEmbeddings(rulePack);
    rulePack.semantic_relations = semanticRelations;
    if (vectorIndex) rulePack.vector_index = vectorIndex;
    const pluginRuns = buildCompilerPluginRuns(config);
    if (pluginRuns.length > 0) rulePack.compiler_plugins = pluginRuns;

    const pathIndex = buildPathIndex(rulePack);
    const repoMetadata = parseJsonField<Record<string, unknown>>(repos[0].metadata, {});
    const entityIndex = buildEntityIndex(rulePack, repoMetadata);
    const reviewQueue = buildReviewQueue(rulePack);
    const onboarding = buildOnboarding(rulePack, config);

    // Get next version
    const verRows = await AppDataSource.query(
      `SELECT COALESCE(MAX(version), 0) + 1 as next FROM "${orgId}_compiled_rules" WHERE repo_id = $1`,
      [repoId],
    );
    const nextVersion = verRows[0].next;

    // Save
    await AppDataSource.query(
      `INSERT INTO "${orgId}_compiled_rules" (repo_id, rule_type, content, path_index, onboarding, version, source_experience_count)
       VALUES ($1, 'repo', $2, $3, $4, $5, $6)`,
      [
        repoId,
        JSON.stringify({ ...rulePack, entity_index: entityIndex, review_queue: reviewQueue }),
        JSON.stringify(pathIndex),
        onboarding,
        nextVersion,
        experiences.length,
      ],
    );

    // Update repo metadata
    await AppDataSource.query(
      `UPDATE "${orgId}_repos" SET last_compiled_at = NOW(), compile_version = $1, experience_count = $2, updated_at = NOW() WHERE id = $3`,
      [nextVersion, experiences.length, repoId],
    );

    logger.info('Compiled repo', { orgId, repoId, repoName, rules: allRules.length, exceptions: rulePack.exceptions.length });
    await this.recordCompileMetrics(orgId, repoId, experiences, repos[0].last_compiled_at, startedAt);
    return { ruleCount: allRules.length, exceptionCount: rulePack.exceptions.length };
  }

  async compileOrgRules(orgId: string): Promise<number> {
    const startedAt = Date.now();
    // Load all repo compiled rules
    const repos = await AppDataSource.query(
      `SELECT id, name FROM "${orgId}_repos" WHERE allowlisted = true AND is_deleted = false`,
    );

    const claimToRepos = new Map<string, { rule: CompiledRule; repos: string[] }>();
    for (const repo of repos) {
      const rows = await AppDataSource.query(
        `SELECT content FROM "${orgId}_compiled_rules" WHERE repo_id = $1 AND is_deleted = false ORDER BY version DESC LIMIT 1`,
        [repo.id],
      );
      if (rows.length === 0) continue;
      const pack = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
      for (const rule of (pack.rules ?? [])) {
        const key = normalizeText(rule.claim);
        const entry = claimToRepos.get(key);
        if (entry) {
          entry.repos.push(repo.name as string);
        } else {
          claimToRepos.set(key, { rule, repos: [repo.name as string] });
        }
      }
    }

    const orgRules: CompiledRule[] = [];
    for (const [, entry] of claimToRepos) {
      if (entry.repos.length >= 2) {
        orgRules.push({ ...entry.rule, id: `org-${entry.rule.id}` });
      }
    }

    await AppDataSource.query(
      `UPDATE "${orgId}_compiled_rules" SET is_deleted = true WHERE repo_id IS NULL AND rule_type = 'org' AND is_deleted = false`,
    );

    if (orgRules.length > 0) {
      const verRows = await AppDataSource.query(
        `SELECT COALESCE(MAX(version), 0) + 1 as next FROM "${orgId}_compiled_rules" WHERE repo_id IS NULL`,
      );
      await AppDataSource.query(
        `INSERT INTO "${orgId}_compiled_rules" (repo_id, rule_type, content, version)
         VALUES (NULL, 'org', $1, $2)`,
        [JSON.stringify({ version: 1, org_id: orgId, rules: orgRules.sort(sortRules) }), verRows[0].next],
      );
    }

    await this.recordOrgCompileMetric(orgId, startedAt);
    return orgRules.length;
  }

  private async recordCompileMetrics(
    orgId: string,
    repoId: string,
    experiences: Experience[],
    lastCompiledAt: RepoCompileRow['last_compiled_at'],
    startedAt: number,
  ) {
    try {
      const finishedAt = Date.now();
      await recordCompileMetric(orgId, repoId, 'compile_latency_ms', finishedAt - startedAt);
      const syncDelayMs = computeSyncDelayMs(experiences, lastCompiledAt, finishedAt);
      if (syncDelayMs != null) {
        await recordCompileMetric(orgId, repoId, 'compile_sync_delay_ms', syncDelayMs);
      }
    } catch (error) {
      logger.info('Compile metric recording skipped', { orgId, repoId, error: (error as Error).message });
    }
  }

  private async recordOrgCompileMetric(orgId: string, startedAt: number) {
    try {
      await recordCompileMetric(orgId, null, 'compile_latency_ms', Date.now() - startedAt);
    } catch (error) {
      logger.info('Org compile metric recording skipped', { orgId, error: (error as Error).message });
    }
  }
}

export const compilerService = new CompilerService();
