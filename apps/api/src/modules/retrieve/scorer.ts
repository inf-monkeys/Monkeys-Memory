import { matchGlob, specificity, normalizeTaskType } from '../../shared/utils.js';
import type { CompiledRule, RetrievalExplanation } from '../../shared/types.js';
import { cosineSimilarity, buildEmbeddingAdapter, type EmbeddingConfig } from './embedding.js';

export type RepoScanContext = {
  knownPaths?: string[];
  knownDirs?: string[];
  repoKind?: string | null;
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isConcreteScope(path: string): boolean {
  return path !== '**' && path !== '**/*' && !path.includes('*') && !path.startsWith('!');
}

function scopeOverlaps(scopePath: string, candidatePath: string): boolean {
  const scope = normalizePath(scopePath);
  const candidate = normalizePath(candidatePath);
  if (!scope || !candidate) return false;
  return scope === candidate || candidate.startsWith(`${scope}/`) || scope.startsWith(`${candidate}/`);
}

function normalizeScopePrefix(path: string): string {
  return normalizePath(path).replace(/\/?\*\*.*$/, '').replace(/\*.*$/, '').replace(/\/+$/, '');
}

function scopeMaybeKnown(scopePath: string, knownPaths: string[], knownDirs: string[]): boolean {
  const normalized = normalizePath(scopePath);
  if (knownPaths.some(path => scopeOverlaps(normalized, path))) return true;
  if (knownDirs.length === 0) return false;
  const prefix = normalizeScopePrefix(normalized);
  return knownDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`) || dir.startsWith(`${prefix}/`));
}

function wrongRepoScopeReason(kind: string | null | undefined, scopePath: string): string | null {
  const normalized = normalizePath(scopePath);
  if (!kind || !normalized) return null;
  const backendKinds = new Set(['backend-service', 'saas-backend']);
  const frontendKinds = new Set(['web-frontend', 'frontend-app', 'saas-frontend']);
  const cliKinds = new Set(['cli-tool', 'saas-cli']);
  if (backendKinds.has(kind)) {
    if (/^(src\/pages|src\/components|src\/lib\/api\.ts|app\/|pages\/|components\/)/.test(normalized) || normalized.endsWith('.tsx')) return 'frontend path in backend repo';
    if (/^(bin\/|src\/commands\/)/.test(normalized)) return 'CLI path in backend repo';
  }
  if (frontendKinds.has(kind)) {
    if (/^src\/modules\/.+\.(controller|service)\.ts$/.test(normalized) || normalized.includes('/migrations/') || normalized.includes('ormconfig')) return 'backend path in frontend repo';
    if (/^(bin\/|src\/commands\/)/.test(normalized)) return 'CLI path in frontend repo';
  }
  if (cliKinds.has(kind)) {
    if (/^src\/modules\/.+\.(controller|service)\.ts$/.test(normalized) || normalized.includes('/migrations/')) return 'backend path in CLI repo';
    if (/^(src\/pages|src\/components|app\/|pages\/)/.test(normalized)) return 'frontend path in CLI repo';
  }
  if (kind === 'documentation' && !/^docs?\//.test(normalized) && !/\.(tex|bib|md|mdx|png|jpg|jpeg|gif|svg|pdf)$/.test(normalized)) return 'product code path in documentation repo';
  return null;
}

export function explainRule(rule: CompiledRule, targetPath: string | null, taskType: string | null, options: { orgLevel?: boolean; queryEmbedding?: number[]; vectorSimilarity?: number; repoContext?: RepoScanContext } = {}): { score: number; explanation: RetrievalExplanation } {
  const why: string[] = [];
  const risks: string[] = [];
  if (['deprecated', 'superseded', 'stale'].includes(rule.lifecycle?.state ?? '')) {
    return {
      score: 0,
      explanation: {
        why: [`lifecycle state is ${rule.lifecycle?.state}`],
        risks: ['memory is retired from runtime retrieval'],
        matched_scope: { paths: [], task: null },
        matched_evidence: rule.provenance?.evidence_refs ?? [],
        relationship: {
          supports: rule.relationships?.supports ?? rule.sources ?? [],
          contradicts: rule.conflicts_with ?? rule.relationships?.contradicts ?? [],
          supersedes: rule.relationships?.supersedes ?? [],
          superseded_by: rule.relationships?.superseded_by ?? [],
        },
      },
    };
  }
  let score = rule.confidence_score * 100;
  why.push(`confidence ${rule.confidence_score}`);

  if (typeof rule.quality_score === 'number') {
    score += rule.quality_score * 15;
    why.push(`quality ${rule.quality_score}`);
  }
  const semanticSimilarity = typeof options.vectorSimilarity === 'number'
    ? options.vectorSimilarity
    : options.queryEmbedding && rule.embedding
      ? cosineSimilarity(options.queryEmbedding, rule.embedding)
      : 0;
  if (semanticSimilarity > 0) {
    score += semanticSimilarity * 20;
    why.push(`semantic similarity ${Number(semanticSimilarity.toFixed(2))}`);
  }

  // Task type match: +30
  const normalized = taskType ? normalizeTaskType(taskType) : null;
  if (normalized && rule.scope.task_types.some(t => normalizeTaskType(t) === normalized)) {
    score += 30;
    why.push(`task matched ${normalized}`);
  }

  // Path match: +40 + specificity bonus
  const matchedPaths: string[] = [];
  if (targetPath) {
    const matched = rule.scope.paths.filter(p => matchGlob(p, targetPath));
    if (matched.length > 0) {
      matchedPaths.push(...matched);
      const best = Math.max(...matched.map(specificity));
      score += 40 + best / 10;
      why.push(`path matched ${matched.join(', ')}`);
      why.push(`path specificity ${Number(best.toFixed(1))}`);
    }
  } else {
    const hasGlobal = rule.scope.paths.some(p => p === '**' || p === '**/*');
    if (hasGlobal) {
      score += 10;
      why.push('global scope matched');
    }
  }

  const knownPaths = options.repoContext?.knownPaths ?? [];
  const knownDirs = options.repoContext?.knownDirs ?? [];
  const repoKind = options.repoContext?.repoKind;
  if (knownPaths.length > 0 || knownDirs.length > 0) {
    const absentScopes: string[] = [];
    const wrongScopes: string[] = [];
    for (const scopePath of rule.scope.paths ?? []) {
      const normalizedScope = normalizePath(scopePath);
      const wrongReason = wrongRepoScopeReason(repoKind, normalizedScope);
      if (wrongReason) {
        wrongScopes.push(`${normalizedScope} (${wrongReason})`);
        continue;
      }
      if (isConcreteScope(normalizedScope) && !scopeMaybeKnown(normalizedScope, knownPaths, knownDirs)) {
        absentScopes.push(normalizedScope);
      }
    }
    if (wrongScopes.length > 0) {
      score *= 0.25;
      risks.push(`scope likely belongs to another repo: ${wrongScopes.slice(0, 3).join(', ')}`);
      why.push('repo scan wrong-scope penalty');
    } else if (absentScopes.length > 0) {
      score *= 0.55;
      risks.push(`scope path absent from latest repo scan: ${absentScopes.slice(0, 3).join(', ')}`);
      why.push('repo scan missing-scope penalty');
    }
    if (targetPath && !scopeMaybeKnown(targetPath, knownPaths, knownDirs)) {
      score *= 0.7;
      risks.push('requested path is absent from the latest repo scan');
      why.push('requested path not found in repo scan');
    }
  }

  if (options.orgLevel) why.push('organization-level rule');
  if (rule.lifecycle?.state && !['active', 'confirmed'].includes(rule.lifecycle.state)) {
    risks.push(`lifecycle state is ${rule.lifecycle.state}`);
    if (rule.lifecycle.state === 'candidate') {
      score *= 0.88;
      why.push('candidate memory score penalty');
      risks.push('requires human review before treating as established guidance');
    }
  }
  if ((rule.conflicts_with?.length ?? 0) > 0) risks.push(`conflicts with ${rule.conflicts_with!.join(', ')}`);
  if (rule.policy?.sensitivity && rule.policy.sensitivity !== 'normal') risks.push(`sensitivity is ${rule.policy.sensitivity}`);
  if ((rule.quality?.conflict_risk ?? 0) >= 0.6) risks.push('high conflict risk');
  if (rule.evidence_count === 0) risks.push('no evidence references');

  return {
    score: Number(score.toFixed(2)),
    explanation: {
      why,
      risks,
      matched_scope: {
        paths: matchedPaths,
        task: normalized && rule.scope.task_types.some(t => normalizeTaskType(t) === normalized) ? normalized : null,
      },
      matched_evidence: rule.provenance?.evidence_refs ?? [],
      relationship: {
        supports: rule.relationships?.supports ?? rule.sources ?? [],
        contradicts: rule.conflicts_with ?? rule.relationships?.contradicts ?? [],
        supersedes: rule.relationships?.supersedes ?? [],
        superseded_by: rule.relationships?.superseded_by ?? [],
      },
    },
  };
}

export async function embedRetrieveQuery(repo: string, targetPath?: string | null, taskType?: string | null, config: EmbeddingConfig = {}): Promise<number[]> {
  const adapter = buildEmbeddingAdapter(config);
  return adapter ? adapter.embed([repo, targetPath, taskType].filter(Boolean).join(' ')) : [];
}

export function scoreRule(rule: CompiledRule, targetPath: string | null, taskType: string | null): number {
  return explainRule(rule, targetPath, taskType).score;
}

export function sortByScore(a: CompiledRule & { runtime_score: number }, b: CompiledRule & { runtime_score: number }): number {
  return b.runtime_score - a.runtime_score || a.id.localeCompare(b.id);
}
