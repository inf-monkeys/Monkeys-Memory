import { AppDataSource } from '../../database/ormconfig.js';
import { NotFoundError } from '../../shared/errors.js';
import type { CompiledRule, EntityDefinition, EntityIndex, RulePack } from '../../shared/types.js';

type RepoRow = {
  id: string;
  name: string;
  metadata: Record<string, unknown> | string | null;
  last_compiled_at: string | Date | null;
  updated_at: string | Date;
};

type CompiledRow = {
  content: RulePack | string;
  compiled_at: string | Date;
  version: number;
};

type RulePackWithEntityIndex = RulePack & {
  entity_index?: EntityIndex;
};

export type ConsistencyFindingReason =
  | 'wrong-repo-scope'
  | 'missing-scope-path'
  | 'deleted-scope-path'
  | 'changed-scope-path'
  | 'missing-entity-definition'
  | 'entity-outside-scope'
  | 'compiled-behind-repo';

export type ConsistencyFinding = {
  id: string;
  reason: ConsistencyFindingReason;
  severity: 'low' | 'medium' | 'high';
  rule_id?: string;
  claim?: string;
  path?: string;
  matched_path?: string;
  message: string;
};

export type ConsistencyReport = {
  repo_id: string;
  repo_name: string;
  scanned_at: string;
  compiled_version: number | null;
  compiled_at: string | null;
  finding_count: number;
  findings: ConsistencyFinding[];
  metadata: {
    known_paths: string[];
    known_path_count?: number;
    known_dirs?: string[];
    changed_paths: string[];
    deleted_paths: string[];
    repo_profile?: {
      kind?: string;
      languages?: string[];
      frameworks?: string[];
    };
  };
};

function parseJsonField<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as T;
}

function parseRulePack(content: RulePack | string): RulePack {
  return typeof content === 'string' ? JSON.parse(content) as RulePack : content;
}

function allItems(pack: RulePack): CompiledRule[] {
  return [
    ...(pack.rules ?? []),
    ...(pack.exceptions ?? []),
    ...(pack.procedures ?? []),
    ...(pack.checklists ?? []),
    ...(pack.notes ?? []),
  ];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))].sort();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function repoKind(metadata: Record<string, unknown>): string | null {
  const profile = metadata.repo_profile;
  if (!profile || typeof profile !== 'object') return null;
  const kind = (profile as Record<string, unknown>).kind;
  return typeof kind === 'string' && kind.trim() ? kind.trim() : null;
}

function repoProfileSummary(metadata: Record<string, unknown>) {
  const profile = metadata.repo_profile;
  if (!profile || typeof profile !== 'object') return undefined;
  const row = profile as Record<string, unknown>;
  const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return {
    kind: typeof row.kind === 'string' ? row.kind : undefined,
    languages: stringList(row.languages),
    frameworks: stringList(row.frameworks),
  };
}

function wrongRepoScopeReason(kind: string | null, scopePath: string): string | null {
  const normalized = normalizePath(scopePath);
  if (!kind || !normalized) return null;
  const backendKinds = new Set(['backend-service', 'saas-backend']);
  const frontendKinds = new Set(['web-frontend', 'frontend-app', 'saas-frontend']);
  const cliKinds = new Set(['cli-tool', 'saas-cli']);
  if (backendKinds.has(kind)) {
    if (/^(src\/pages|src\/components|src\/lib\/api\.ts|app\/|pages\/|components\/)/.test(normalized) || normalized.endsWith('.tsx')) {
      return 'frontend path in backend repo';
    }
    if (/^(bin\/|src\/commands\/)/.test(normalized)) return 'CLI path in backend repo';
  }
  if (frontendKinds.has(kind)) {
    if (/^src\/modules\/.+\.(controller|service)\.ts$/.test(normalized) || normalized.includes('/migrations/') || normalized.includes('ormconfig')) {
      return 'backend path in frontend repo';
    }
    if (/^(bin\/|src\/commands\/)/.test(normalized)) return 'CLI path in frontend repo';
  }
  if (cliKinds.has(kind)) {
    if (/^src\/modules\/.+\.(controller|service)\.ts$/.test(normalized) || normalized.includes('/migrations/')) return 'backend path in CLI repo';
    if (/^(src\/pages|src\/components|app\/|pages\/)/.test(normalized)) return 'frontend path in CLI repo';
  }
  if (kind === 'documentation' && !/^docs?\//.test(normalized) && !/\.(tex|bib|md|mdx|png|jpg|jpeg|gif|svg|pdf)$/.test(normalized)) {
    return 'product code path in paper repo';
  }
  return null;
}

function isConcreteScope(path: string): boolean {
  return path !== '**' && path !== '**/*' && !path.includes('*') && !path.startsWith('!');
}

function normalizeScopePrefix(path: string): string {
  return normalizePath(path).replace(/\/?\*\*.*$/, '').replace(/\*.*$/, '').replace(/\/+$/, '');
}

function scopeOverlaps(scopePath: string, candidatePath: string): boolean {
  const scope = normalizePath(scopePath);
  const candidate = normalizePath(candidatePath);
  if (!scope || !candidate) return false;
  return scope === candidate || candidate.startsWith(`${scope}/`) || scope.startsWith(`${candidate}/`);
}

function scopeContainsDefinition(scopePath: string, definition: EntityDefinition): boolean {
  const prefix = normalizeScopePrefix(scopePath);
  const definitionPath = normalizePath(definition.path);
  if (!prefix || !definitionPath) return false;
  return definitionPath === prefix || definitionPath.startsWith(`${prefix}/`) || prefix.startsWith(`${definitionPath}/`);
}

function metadataEntityIndex(metadata: Record<string, unknown>): Record<string, EntityDefinition[]> {
  const raw = metadata.code_entities ?? metadata.entity_definitions ?? metadata.code_entity_sample;
  if (!Array.isArray(raw)) return {};
  const definitions: Record<string, EntityDefinition[]> = {};
  for (const entity of raw) {
    if (!entity || typeof entity !== 'object') continue;
    const row = entity as Record<string, unknown>;
    const kind = typeof row.kind === 'string' ? row.kind : undefined;
    const name = typeof row.name === 'string' ? row.name : undefined;
    const id = typeof row.id === 'string' ? row.id : kind && name ? `${kind}:${name}` : null;
    const path = typeof row.path === 'string' ? normalizePath(row.path) : null;
    if (!id || !path) continue;
    definitions[id] ??= [];
    definitions[id].push({
      kind,
      name,
      path,
      line: typeof row.line === 'number' ? row.line : undefined,
    });
  }
  return definitions;
}

function isCompactMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.scan_mode === 'compact';
}

function scopeMaybeKnown(scopePath: string, knownPaths: string[], knownDirs: string[]): boolean {
  const normalized = normalizePath(scopePath);
  if (knownPaths.some(path => scopeOverlaps(normalized, path))) return true;
  if (knownDirs.length === 0) return false;
  return knownDirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`) || dir.startsWith(`${normalizeScopePrefix(normalized)}/`));
}

function newestDate(values: Array<string | Date | null | undefined>): Date | null {
  const dates = values
    .filter(Boolean)
    .map(value => new Date(value as string | Date))
    .filter(date => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] ?? null;
}

function findingId(reason: ConsistencyFindingReason, parts: Array<string | undefined>): string {
  return ['drift', reason, ...parts.filter(Boolean)].join(':').replace(/[^a-zA-Z0-9:_-]+/g, '-').slice(0, 160);
}

function buildFinding(input: Omit<ConsistencyFinding, 'id'>): ConsistencyFinding {
  return {
    ...input,
    id: findingId(input.reason, [input.rule_id, input.path, input.matched_path]),
  };
}

export class ConsistencyService {
  async latestReport(orgId: string, repoId: string): Promise<ConsistencyReport | null> {
    const repo = await this.loadRepo(orgId, repoId);
    const metadata = parseJsonField<Record<string, unknown>>(repo.metadata, {});
    return parseJsonField<ConsistencyReport | null>(metadata.consistency as ConsistencyReport | string | null | undefined, null);
  }

  async scanRepo(orgId: string, repoId: string): Promise<ConsistencyReport> {
    const repo = await this.loadRepo(orgId, repoId);
    const metadata = parseJsonField<Record<string, unknown>>(repo.metadata, {});
    const knownPaths = stringList(metadata.known_paths);
    const knownDirs = stringList(metadata.known_dirs);
    const changedPaths = stringList(metadata.changed_paths);
    const deletedPaths = stringList(metadata.deleted_paths);
    const kind = repoKind(metadata);
    const metadataEntities = metadataEntityIndex(metadata);
    const compactMetadata = isCompactMetadata(metadata);
    const compiled = await this.loadLatestCompiled(orgId, repoId);
    const pack = compiled ? parseRulePack(compiled.content) as RulePackWithEntityIndex : null;
    const findings: ConsistencyFinding[] = [];

    if (compiled) {
      const compiledAt = newestDate([compiled.compiled_at]);
      const repoUpdatedAt = newestDate([metadata.paths_updated_at as string | undefined, repo.updated_at]);
      if (compiledAt && repoUpdatedAt && repoUpdatedAt.getTime() > compiledAt.getTime()) {
        findings.push(buildFinding({
          reason: 'compiled-behind-repo',
          severity: 'medium',
          message: 'Repository metadata changed after the latest compiled memory pack.',
        }));
      }
    }

    if (pack) {
      for (const item of allItems(pack)) {
        for (const scopePath of item.scope.paths ?? []) {
          const normalizedScope = normalizePath(scopePath);
          const wrongScope = wrongRepoScopeReason(kind, normalizedScope);
          if (wrongScope) {
            findings.push(buildFinding({
              reason: 'wrong-repo-scope',
              severity: 'high',
              rule_id: item.id,
              claim: item.claim,
              path: normalizedScope,
              message: `Compiled memory references a likely wrong-repository scope: ${wrongScope}.`,
            }));
            continue;
          }
          for (const deletedPath of deletedPaths) {
            if (scopeOverlaps(normalizedScope, deletedPath)) {
              findings.push(buildFinding({
                reason: 'deleted-scope-path',
                severity: 'high',
                rule_id: item.id,
                claim: item.claim,
                path: normalizedScope,
                matched_path: deletedPath,
                message: 'Compiled memory references a path that repository metadata marks as deleted.',
              }));
            }
          }
          for (const changedPath of changedPaths) {
            if (scopeOverlaps(normalizedScope, changedPath)) {
              findings.push(buildFinding({
                reason: 'changed-scope-path',
                severity: 'medium',
                rule_id: item.id,
                claim: item.claim,
                path: normalizedScope,
                matched_path: changedPath,
                message: 'Compiled memory scope overlaps recently changed repository paths.',
              }));
            }
          }
          const hasExplicitDrift = deletedPaths.some(path => scopeOverlaps(normalizedScope, path))
            || changedPaths.some(path => scopeOverlaps(normalizedScope, path));
          if (
            !hasExplicitDrift
            && (knownPaths.length > 0 || knownDirs.length > 0)
            && isConcreteScope(normalizedScope)
            && !scopeMaybeKnown(normalizedScope, knownPaths, knownDirs)
          ) {
            findings.push(buildFinding({
              reason: 'missing-scope-path',
              severity: 'medium',
              rule_id: item.id,
              claim: item.claim,
              path: normalizedScope,
              message: 'Compiled memory references a concrete path absent from repository metadata.',
            }));
          }
        }
        for (const entityId of item.scope.entities ?? []) {
          const entityEntry = pack.entity_index?.entities[entityId];
          const definitions = entityEntry?.definitions?.length ? entityEntry.definitions : metadataEntities[entityId] ?? [];
          if (definitions.length === 0) {
            if (compactMetadata) continue;
            findings.push(buildFinding({
              reason: 'missing-entity-definition',
              severity: 'medium',
              rule_id: item.id,
              claim: item.claim,
              path: (item.scope.paths ?? [])[0],
              message: 'Compiled memory references an entity without a known code definition.',
            }));
            continue;
          }
          const matchingDefinitions = definitions.filter((definition) =>
            (item.scope.paths ?? []).some((scopePath) => scopeContainsDefinition(scopePath, definition)),
          );
          if (matchingDefinitions.length === 0) {
            findings.push(buildFinding({
              reason: 'entity-outside-scope',
              severity: 'medium',
              rule_id: item.id,
              claim: item.claim,
              path: (item.scope.paths ?? [])[0],
              matched_path: definitions.map((definition) => definition.path).join(', '),
              message: 'Compiled memory entity definitions do not fall within the compiled path scope.',
            }));
          }
        }
      }
    }

    const uniqueFindings = [...new Map(findings.map(finding => [finding.id, finding])).values()]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id));
    const report: ConsistencyReport = {
      repo_id: repo.id,
      repo_name: repo.name,
      scanned_at: new Date().toISOString(),
      compiled_version: compiled?.version ?? null,
      compiled_at: compiled ? new Date(compiled.compiled_at).toISOString() : null,
      finding_count: uniqueFindings.length,
      findings: uniqueFindings,
      metadata: {
        known_paths: knownPaths,
        known_path_count: typeof metadata.known_path_count === 'number' ? metadata.known_path_count : knownPaths.length,
        known_dirs: knownDirs,
        changed_paths: changedPaths,
        deleted_paths: deletedPaths,
        repo_profile: repoProfileSummary(metadata),
      },
    };

    await this.persistReport(orgId, repoId, metadata, report);
    return report;
  }

  private async loadRepo(orgId: string, repoId: string): Promise<RepoRow> {
    const rows = await AppDataSource.query(
      `SELECT id, name, metadata, last_compiled_at, updated_at
         FROM "${orgId}_repos"
        WHERE id = $1
          AND is_deleted = false
        LIMIT 1`,
      [repoId],
    ) as RepoRow[];
    if (rows.length === 0) throw new NotFoundError('Repo not found');
    return rows[0];
  }

  private async loadLatestCompiled(orgId: string, repoId: string): Promise<CompiledRow | null> {
    const rows = await AppDataSource.query(
      `SELECT content, compiled_at, version
         FROM "${orgId}_compiled_rules"
        WHERE repo_id = $1
          AND rule_type = 'repo'
          AND is_deleted = false
        ORDER BY version DESC
        LIMIT 1`,
      [repoId],
    ) as CompiledRow[];
    return rows[0] ?? null;
  }

  private async persistReport(orgId: string, repoId: string, metadata: Record<string, unknown>, report: ConsistencyReport) {
    await AppDataSource.query(
      `UPDATE "${orgId}_repos"
          SET metadata = $1
        WHERE id = $2`,
      [JSON.stringify({ ...metadata, consistency: report }), repoId],
    );
  }
}

function severityRank(severity: ConsistencyFinding['severity']): number {
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export const consistencyService = new ConsistencyService();
