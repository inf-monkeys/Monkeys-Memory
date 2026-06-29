export type RepoMetadataIngestBody = {
  provider?: string;
  event?: string;
  mode?: 'patch' | 'snapshot';
  schema_version?: number;
  scan_mode?: unknown;
  scanned_at?: string;
  branch?: string | null;
  commit?: string | null;
  known_paths?: unknown;
  known_path_count?: unknown;
  known_path_sample?: unknown;
  known_dirs?: unknown;
  changed_paths?: unknown;
  deleted_paths?: unknown;
  renamed_paths?: unknown;
  code_entities?: unknown;
  entity_definitions?: unknown;
  code_entity_count?: unknown;
  code_entity_sample?: unknown;
  repo_profile?: unknown;
  repo_brief?: unknown;
  agent_repo_guide?: unknown;
};

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
}

function normalizePathValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStringList(value: unknown, limit = 50): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeStringValue).filter((item): item is string => Boolean(item)))]
    .sort()
    .slice(0, limit);
}

function normalizeTextValue(value: unknown, limit: number): string | undefined {
  const text = normalizeStringValue(value);
  return text ? text.slice(0, limit) : undefined;
}

function normalizePathList(value: unknown, limit = 5000): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizePathValue).filter((item): item is string => Boolean(item)))]
    .sort()
    .slice(0, limit);
}

function normalizeRenames(value: unknown): Array<{ from: string; to: string }> {
  if (!Array.isArray(value)) return [];
  const renames: Array<{ from: string; to: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const from = normalizePathValue(row.from ?? row.old_path ?? row.previous_path);
    const to = normalizePathValue(row.to ?? row.new_path ?? row.path);
    if (from && to) renames.push({ from, to });
  }
  return renames.slice(0, 1000);
}

function normalizeEntityDefinitions(value: unknown, limit = 5000) {
  if (!Array.isArray(value)) return [];
  const definitions: Array<{ id: string; kind?: string; name: string; path: string; line?: number; signature?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = normalizeStringValue(row.id)
      ?? (normalizeStringValue(row.kind) && normalizeStringValue(row.name) ? `${normalizeStringValue(row.kind)}:${normalizeStringValue(row.name)}` : null);
    const path = normalizePathValue(row.path);
    if (!id || !path) continue;
    definitions.push({
      id,
      kind: normalizeStringValue(row.kind) ?? undefined,
      name: normalizeStringValue(row.name) ?? id,
      path,
      line: normalizeNumberValue(row.line),
      signature: normalizeTextValue(row.signature, 180),
    });
  }
  return definitions
    .sort((left, right) => `${left.id}:${left.path}:${left.line ?? 0}`.localeCompare(`${right.id}:${right.path}:${right.line ?? 0}`))
    .slice(0, limit);
}

function normalizePathGroups(value: unknown) {
  if (!Array.isArray(value)) return [];
  const groups: Array<{ name: string; paths: string[]; purpose?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = normalizeStringValue(row.name);
    if (!name) continue;
    const paths = normalizePathList(row.paths, 40);
    if (paths.length === 0) continue;
    groups.push({
      name,
      paths,
      purpose: normalizeTextValue(row.purpose, 180),
    });
  }
  return groups.slice(0, 24);
}

function normalizeCommands(value: unknown) {
  if (!Array.isArray(value)) return [];
  const commands: Array<{ name: string; command: string; purpose?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = normalizeStringValue(row.name);
    const command = normalizeStringValue(row.command);
    if (!name || !command) continue;
    commands.push({
      name,
      command: command.slice(0, 180),
      purpose: normalizeTextValue(row.purpose, 180),
    });
  }
  return commands.slice(0, 24);
}

function normalizeAgentRepoGuide(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const ownership = row.ownership && typeof row.ownership === 'object'
    ? row.ownership as Record<string, unknown>
    : {};
  return {
    schema_version: normalizeNumberValue(row.schema_version) ?? 1,
    summary: normalizeTextValue(row.summary, 1000) ?? '',
    architecture: normalizeStringList(row.architecture, 40),
    primary_workflows: normalizeStringList(row.primary_workflows, 40),
    ownership: {
      owns: normalizeStringList(ownership.owns, 40),
      does_not_own: normalizeStringList(ownership.does_not_own, 40),
      boundaries: normalizeStringList(ownership.boundaries, 40),
    },
    commands: normalizeCommands(row.commands),
    agent_instructions: normalizeStringList(row.agent_instructions, 60),
    memory_hints: normalizeStringList(row.memory_hints, 60),
    confidence: normalizeStringValue(row.confidence) ?? 'medium',
  };
}

function normalizeRepoProfile(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const ownership = row.ownership && typeof row.ownership === 'object'
    ? row.ownership as Record<string, unknown>
    : {};
  return {
    schema_version: normalizeNumberValue(row.schema_version) ?? 1,
    name: normalizeStringValue(row.name) ?? undefined,
    kind: normalizeStringValue(row.kind) ?? 'repository',
    description: normalizeTextValue(row.description, 300) ?? null,
    package_manager: normalizeStringValue(row.package_manager) ?? null,
    languages: normalizeStringList(row.languages, 30),
    frameworks: normalizeStringList(row.frameworks, 30),
    path_groups: normalizePathGroups(row.path_groups),
    ownership: {
      owns: normalizeStringList(ownership.owns, 40),
      does_not_own: normalizeStringList(ownership.does_not_own, 40),
      boundary_notes: normalizeStringList(ownership.boundary_notes, 40),
    },
    important_commands: normalizeCommands(row.important_commands),
    contributor_guides: normalizePathList(row.contributor_guides, 20),
  };
}

function mergePathSets(base: unknown, additions: string[], removals: string[] = []) {
  const values = new Set(normalizePathList(base));
  for (const item of additions) values.add(item);
  for (const item of removals) values.delete(item);
  return [...values].sort();
}

export function buildRepoMetadataIngest(metadata: Record<string, unknown>, body: RepoMetadataIngestBody) {
  const now = new Date().toISOString();
  const mode = body.mode === 'snapshot' ? 'snapshot' : 'patch';
  const knownInput = normalizePathList(body.known_paths);
  const knownPathSampleInput = normalizePathList(body.known_path_sample, 1000);
  const knownDirsInput = normalizePathList(body.known_dirs, 2000);
  const changedInput = normalizePathList(body.changed_paths);
  const deletedInput = normalizePathList(body.deleted_paths);
  const renamedInput = normalizeRenames(body.renamed_paths);
  const renameFrom = renamedInput.map(rename => rename.from);
  const renameTo = renamedInput.map(rename => rename.to);
  const scanMode = normalizeStringValue(body.scan_mode) === 'compact' ? 'compact' : 'full';
  const fullCodeEntitiesInput = normalizeEntityDefinitions(body.code_entities ?? body.entity_definitions);
  const codeEntitySampleInput = normalizeEntityDefinitions(body.code_entity_sample, 1000);
  const codeEntitiesInput = fullCodeEntitiesInput.length > 0 ? fullCodeEntitiesInput : codeEntitySampleInput;
  const repoProfileInput = normalizeRepoProfile(body.repo_profile);
  const repoBriefInput = normalizeTextValue(body.repo_brief, 6000);
  const agentRepoGuideInput = normalizeAgentRepoGuide(body.agent_repo_guide);

  const isCompactScan = scanMode === 'compact';
  const knownPaths = isCompactScan
    ? []
    : mode === 'snapshot' && Array.isArray(body.known_paths)
    ? mergePathSets([], [...knownInput, ...renameTo], [...deletedInput, ...renameFrom])
    : mergePathSets(metadata.known_paths, [...knownInput, ...renameTo], [...deletedInput, ...renameFrom]);
  const changedPaths = mergePathSets(mode === 'snapshot' ? [] : metadata.changed_paths, [...changedInput, ...renameFrom, ...renameTo]);
  const deletedPaths = mergePathSets(mode === 'snapshot' ? [] : metadata.deleted_paths, [...deletedInput, ...renameFrom]);
  const codeEntities = isCompactScan
    ? []
    : Array.isArray(body.code_entities) || Array.isArray(body.entity_definitions)
    ? codeEntitiesInput
    : metadata.code_entities;
  const knownPathCount = normalizeNumberValue(body.known_path_count) ?? knownPaths.length;
  const codeEntityCount = normalizeNumberValue(body.code_entity_count) ?? (Array.isArray(codeEntities) ? codeEntities.length : codeEntitiesInput.length);

  const ingest = {
    provider: normalizeStringValue(body.provider) ?? 'manual',
    event: normalizeStringValue(body.event) ?? 'repo-metadata',
    mode,
    branch: normalizeStringValue(body.branch) ?? null,
    commit: normalizeStringValue(body.commit) ?? null,
    changed_count: changedInput.length,
    deleted_count: deletedInput.length,
    known_count: knownInput.length,
    known_path_count: knownPathCount,
    renamed_count: renamedInput.length,
    entity_count: codeEntityCount,
    scan_mode: scanMode,
    ingested_at: now,
  };

  return {
    metadata: {
      ...metadata,
      known_paths: knownPaths,
      known_path_count: knownPathCount,
      known_path_sample: isCompactScan ? knownPathSampleInput : knownPaths.slice(0, 1000),
      known_dirs: isCompactScan ? knownDirsInput : mergePathSets([], knownPaths.flatMap((item) => item.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/')))),
      changed_paths: changedPaths,
      deleted_paths: deletedPaths,
      renamed_paths: renamedInput,
      scan_mode: scanMode,
      paths_updated_at: now,
      ...(codeEntities ? { code_entities: codeEntities } : {}),
      code_entity_count: codeEntityCount,
      code_entity_sample: isCompactScan ? codeEntitySampleInput : (Array.isArray(codeEntities) ? codeEntities.slice(0, 1000) : []),
      ...(repoProfileInput ? { repo_profile: repoProfileInput } : {}),
      ...(repoBriefInput ? { repo_brief: repoBriefInput } : {}),
      ...(agentRepoGuideInput ? { agent_repo_guide: agentRepoGuideInput } : {}),
      provider_metadata: {
        ...(metadata.provider_metadata && typeof metadata.provider_metadata === 'object' ? metadata.provider_metadata as Record<string, unknown> : {}),
        last_ingest: ingest,
      },
    },
    summary: {
      provider: ingest.provider,
      event: ingest.event,
      mode,
      known_paths: knownPaths.length,
      known_path_count: knownPathCount,
      known_dirs: (isCompactScan ? knownDirsInput : normalizePathList((metadata.known_dirs), 2000)).length,
      changed_paths: changedPaths.length,
      deleted_paths: deletedPaths.length,
      renamed_paths: renamedInput.length,
      code_entities: Array.isArray(codeEntities) ? codeEntities.length : 0,
      code_entity_count: codeEntityCount,
      scan_mode: scanMode,
      repo_profile: Boolean(repoProfileInput),
      repo_brief: Boolean(repoBriefInput),
      agent_repo_guide: Boolean(agentRepoGuideInput),
      paths_updated_at: now,
    },
  };
}
