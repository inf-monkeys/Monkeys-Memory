import type { FastifyInstance } from 'fastify';
import { accountRecentReauthGuard, accountWriteGuard, authMiddleware, requireRole } from '../../middleware/auth.middleware.js';
import { AppDataSource } from '../../database/ormconfig.js';
import { compilerService } from '../compiler/compiler.service.js';
import { checkRepoQuota } from '../../shared/quota.js';
import type { CompiledRule, RulePack } from '../../shared/types.js';
import { buildRepoMetadataIngest, parseJsonField, type RepoMetadataIngestBody } from './repo-metadata.js';

type CompiledResponseRow = {
  content: RulePack | string;
  onboarding: string | null;
  version: number;
  compiled_at: string;
};

type SourceExperienceRow = {
  id: string;
  title: string;
  claim: string;
  kind: string;
  scope: unknown;
  evidence: unknown;
  confidence: string | number;
  lifecycle: unknown;
  provenance: unknown;
  relationships: unknown;
  policy: unknown;
  validity: unknown;
  created_at: string;
  updated_at: string;
  author_name: string | null;
};

type EventRow = {
  id: string;
  compiled_rule_id: string;
  source_experience_ids: unknown;
  outcome?: string;
  action?: string;
  review_item_reason?: string | null;
  note?: string | null;
  user_id: string;
  created_at: string;
};

type TrajectoryLineageRow = {
  id: string;
  repo_id: string;
  user_id: string;
  task: string | null;
  outcome: string;
  summary: string | null;
  events: unknown;
  candidates: unknown;
  status: string;
  created_at: string;
  updated_at: string;
};

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

function normalizeSourceExperience(row: SourceExperienceRow) {
  return {
    ...row,
    confidence: Number(row.confidence),
    scope: parseJsonField(row.scope, {}),
    evidence: parseJsonField(row.evidence, []),
    lifecycle: parseJsonField(row.lifecycle, null),
    provenance: parseJsonField(row.provenance, null),
    relationships: parseJsonField(row.relationships, {}),
    policy: parseJsonField(row.policy, null),
    validity: parseJsonField(row.validity, null),
  };
}

function normalizeEvent(row: EventRow) {
  return {
    ...row,
    source_experience_ids: parseJsonField(row.source_experience_ids, []),
  };
}

function normalizeTrajectoryLineage(row: TrajectoryLineageRow, sourceIds: Set<string>) {
  const candidates = parseJsonField<Array<{ created_experience_id?: string | null }>>(row.candidates, [])
    .filter((candidate) => candidate.created_experience_id && sourceIds.has(candidate.created_experience_id));
  return {
    ...row,
    events: parseJsonField(row.events, {}),
    candidates,
  };
}

async function enrichRulePack(orgId: string, content: RulePack | string): Promise<RulePack> {
  const parsed = parseRulePack(content);
  const sourceIds = [...new Set(allItems(parsed).flatMap((rule) => rule.sources ?? []))];

  if (sourceIds.length === 0) {
    return parsed;
  }

  const sourceRows = await AppDataSource.query(
    `SELECT e.id,
            e.created_at,
            COALESCE(NULLIF(u.name, ''), u.email, e.author_id) AS author_name
       FROM "${orgId}_experiences" e
       LEFT JOIN "${orgId}_users" u
         ON u.id = e.author_id
        AND u.is_deleted = false
      WHERE e.id = ANY($1)`,
    [sourceIds],
  ) as Array<{ id: string; created_at: string; author_name: string | null }>;

  const sourceMap = new Map(sourceRows.map((row) => [row.id, row]));
  const attachLatestSource = (rule: CompiledRule): CompiledRule => {
    const latest = (rule.sources ?? [])
      .map((sourceId) => sourceMap.get(sourceId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    return {
      ...rule,
      pushed_at: latest?.created_at ?? null,
      pushed_by: latest?.author_name ?? null,
    };
  };

  return {
    ...parsed,
    rules: (parsed.rules ?? []).map(attachLatestSource),
    exceptions: (parsed.exceptions ?? []).map(attachLatestSource),
    procedures: (parsed.procedures ?? []).map(attachLatestSource),
    checklists: (parsed.checklists ?? []).map(attachLatestSource),
    notes: (parsed.notes ?? []).map(attachLatestSource),
  };
}

export async function repoRoutes(app: FastifyInstance) {
  // List repos
  app.get('/api/v1/repos', { preHandler: [authMiddleware] }, async (req) => {
    const rows = await AppDataSource.query(
      `SELECT id, name, allowlisted, last_compiled_at, compile_version, experience_count, created_at
       FROM "${req.auth.orgId}_repos" WHERE is_deleted = false ORDER BY created_at DESC`,
    );
    return { repos: rows };
  });

  // Add repo
  app.post('/api/v1/repos', { preHandler: [authMiddleware, requireRole('owner', 'admin'), accountWriteGuard, accountRecentReauthGuard] }, async (req, reply) => {
    const body = req.body as { name: string };
    if (!body.name) return reply.status(400).send({ error: 'name is required' });

    await checkRepoQuota(req.auth.orgId);

    const result = await AppDataSource.query(
      `INSERT INTO "${req.auth.orgId}_repos" (name, allowlisted) VALUES ($1, true) RETURNING id, name`,
      [body.name],
    );
    return reply.status(201).send(result[0]);
  });

  // Trigger compile
  app.post('/api/v1/repos/:repoId/compile', { preHandler: [authMiddleware, requireRole('owner', 'admin'), accountWriteGuard] }, async (req) => {
    const { repoId } = req.params as { repoId: string };
    const result = await compilerService.compileRepo(req.auth.orgId, repoId);
    await compilerService.compileOrgRules(req.auth.orgId);
    return result;
  });

  // Ingest repository metadata from Git providers, CI jobs, or explicit admin updates.
  app.post('/api/v1/repos/:repoId/metadata/ingest', { preHandler: [authMiddleware, requireRole('owner', 'admin'), accountWriteGuard] }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = (req.body ?? {}) as RepoMetadataIngestBody;
    const rows = await AppDataSource.query(
      `SELECT metadata FROM "${req.auth.orgId}_repos" WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [repoId],
    ) as Array<{ metadata: Record<string, unknown> | string | null }>;
    if (rows.length === 0) return reply.status(404).send({ error: 'Repo not found' });

    const currentMetadata = parseJsonField<Record<string, unknown>>(rows[0].metadata, {});
    const { metadata, summary } = buildRepoMetadataIngest(currentMetadata, body);
    await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_repos"
          SET metadata = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(metadata), repoId],
    );
    await AppDataSource.query(
      `INSERT INTO "${req.auth.orgId}_audit_logs" (user_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.auth.userId,
        'repo.metadata.ingest',
        'repo',
        repoId,
        JSON.stringify(summary),
        req.ip ?? null,
      ],
    );
    return { repo_id: repoId, metadata: summary };
  });

  // CLI-safe repo scan ingestion. The CLI authenticates with mk_cli_ or PAT and
  // resolves org membership through authMiddleware, so this path does not use
  // browser CSRF guards.
  app.post('/api/v1/repos/:repoId/scan', { preHandler: [authMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = (req.body ?? {}) as RepoMetadataIngestBody;
    const rows = await AppDataSource.query(
      `SELECT metadata FROM "${req.auth.orgId}_repos" WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [repoId],
    ) as Array<{ metadata: Record<string, unknown> | string | null }>;
    if (rows.length === 0) return reply.status(404).send({ error: 'Repo not found' });

    const currentMetadata = parseJsonField<Record<string, unknown>>(rows[0].metadata, {});
    const { metadata, summary } = buildRepoMetadataIngest(currentMetadata, {
      ...body,
      provider: body.provider ?? 'cli',
      event: body.event ?? 'repo-scan',
      mode: 'snapshot',
    });
    await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_repos"
          SET metadata = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(metadata), repoId],
    );
    await AppDataSource.query(
      `INSERT INTO "${req.auth.orgId}_audit_logs" (user_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.auth.userId,
        'repo.scan.cli',
        'repo',
        repoId,
        JSON.stringify(summary),
        req.ip ?? null,
      ],
    );
    return { repo_id: repoId, metadata: summary };
  });

  app.post('/api/v1/repos/scan', { preHandler: [authMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const body = (req.body ?? {}) as RepoMetadataIngestBody & { repo?: string };
    if (!body.repo?.trim()) return reply.status(400).send({ error: 'repo is required' });

    const repoRows = await AppDataSource.query(
      `SELECT id, metadata FROM "${req.auth.orgId}_repos" WHERE name = $1 AND is_deleted = false LIMIT 1`,
      [body.repo.trim()],
    ) as Array<{ id: string; metadata: Record<string, unknown> | string | null }>;
    if (repoRows.length === 0) return reply.status(404).send({ error: 'Repo not found' });

    const currentMetadata = parseJsonField<Record<string, unknown>>(repoRows[0].metadata, {});
    const { metadata, summary } = buildRepoMetadataIngest(currentMetadata, {
      ...body,
      provider: body.provider ?? 'cli',
      event: body.event ?? 'repo-scan',
      mode: 'snapshot',
    });
    await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_repos"
          SET metadata = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(metadata), repoRows[0].id],
    );
    await AppDataSource.query(
      `INSERT INTO "${req.auth.orgId}_audit_logs" (user_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.auth.userId,
        'repo.scan.cli',
        'repo',
        repoRows[0].id,
        JSON.stringify(summary),
        req.ip ?? null,
      ],
    );
    return { repo_id: repoRows[0].id, metadata: summary };
  });

  // Get compiled rules
  app.get('/api/v1/repos/:repoId/compiled', { preHandler: [authMiddleware] }, async (req) => {
    const { repoId } = req.params as { repoId: string };
    const rows = await AppDataSource.query(
      `SELECT content, onboarding, version, compiled_at FROM "${req.auth.orgId}_compiled_rules"
       WHERE repo_id = $1 AND is_deleted = false ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as CompiledResponseRow[];
    if (rows.length === 0) return { compiled: false };
    return { compiled: true, ...rows[0], content: await enrichRulePack(req.auth.orgId, rows[0].content) };
  });

  // Inspect the lineage behind one compiled memory item.
  app.get('/api/v1/repos/:repoId/compiled/:ruleId/lineage', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { repoId, ruleId } = req.params as { repoId: string; ruleId: string };
    const rows = await AppDataSource.query(
      `SELECT content, version, compiled_at FROM "${req.auth.orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string; version: number; compiled_at: string }>;
    if (rows.length === 0) return reply.status(404).send({ error: 'Compiled rules not found' });

    const pack = parseRulePack(rows[0].content);
    const item = allItems(pack).find((rule) => rule.id === ruleId);
    if (!item) return reply.status(404).send({ error: 'Compiled rule not found' });

    const sourceIds = [...new Set(item.sources ?? [])];
    const likePatterns = sourceIds.map((id) => `%${id}%`);
    const sourceRows = sourceIds.length > 0
      ? await AppDataSource.query(
          `SELECT e.id,
                  e.title,
                  e.claim,
                  e.kind,
                  e.scope,
                  e.evidence,
                  e.confidence,
                  e.lifecycle,
                  e.provenance,
                  e.relationships,
                  e.policy,
                  e.validity,
                  e.created_at,
                  e.updated_at,
                  COALESCE(NULLIF(u.name, ''), u.email, e.author_id) AS author_name
             FROM "${req.auth.orgId}_experiences" e
             LEFT JOIN "${req.auth.orgId}_users" u
               ON u.id = e.author_id
              AND u.is_deleted = false
            WHERE e.repo_id = $1
              AND e.id = ANY($2)
            ORDER BY e.created_at DESC`,
          [repoId, sourceIds],
        ) as SourceExperienceRow[]
      : [];
    const feedbackRows = sourceIds.length > 0
      ? await AppDataSource.query(
          `SELECT id, compiled_rule_id, source_experience_ids, outcome, note, user_id, created_at
             FROM "${req.auth.orgId}_feedback_events"
            WHERE repo_id = $1
              AND (compiled_rule_id = $2 OR source_experience_ids::text LIKE ANY($3))
            ORDER BY created_at DESC
            LIMIT 50`,
          [repoId, ruleId, likePatterns],
        ) as EventRow[]
      : [];
    const reviewRows = sourceIds.length > 0
      ? await AppDataSource.query(
          `SELECT id, compiled_rule_id, review_item_reason, action, note, source_experience_ids, user_id, created_at
             FROM "${req.auth.orgId}_review_events"
            WHERE repo_id = $1
              AND (compiled_rule_id = $2 OR source_experience_ids::text LIKE ANY($3))
            ORDER BY created_at DESC
            LIMIT 50`,
          [repoId, ruleId, likePatterns],
        ) as EventRow[]
      : [];
    const trajectoryRows = sourceIds.length > 0
      ? await AppDataSource.query(
          `SELECT id, repo_id, user_id, task, outcome, summary, events, candidates, status, created_at, updated_at
             FROM "${req.auth.orgId}_trajectory_events"
            WHERE repo_id = $1
              AND candidates::text LIKE ANY($2)
            ORDER BY created_at DESC
            LIMIT 50`,
          [repoId, likePatterns],
        ) as TrajectoryLineageRow[]
      : [];

    const sourceSet = new Set(sourceIds);
    return {
      repo_id: repoId,
      rule_id: ruleId,
      version: rows[0].version,
      compiled_at: rows[0].compiled_at,
      item,
      sources: sourceRows.map(normalizeSourceExperience),
      feedback_events: feedbackRows.map(normalizeEvent),
      review_events: reviewRows.map(normalizeEvent),
      trajectories: trajectoryRows
        .map((row) => normalizeTrajectoryLineage(row, sourceSet))
        .filter((row) => row.candidates.length > 0),
    };
  });

  // Delete one compiled rule by deleting its source experiences, then recompile
  app.delete('/api/v1/repos/:repoId/compiled/:ruleId', { preHandler: [authMiddleware, requireRole('owner', 'admin'), accountWriteGuard, accountRecentReauthGuard] }, async (req, reply) => {
    const { repoId, ruleId } = req.params as { repoId: string; ruleId: string };
    const rows = await AppDataSource.query(
      `SELECT content FROM "${req.auth.orgId}_compiled_rules"
       WHERE repo_id = $1 AND is_deleted = false ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string }>;

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Compiled rules not found' });
    }

    const content = parseRulePack(rows[0].content);
    const targetRule = [...(content.rules ?? []), ...(content.exceptions ?? [])].find((rule) => rule.id === ruleId);

    if (!targetRule) {
      return reply.status(404).send({ error: 'Compiled rule not found' });
    }

    const sourceIds = [...new Set(targetRule.sources ?? [])];
    if (sourceIds.length === 0) {
      return reply.status(400).send({ error: 'Compiled rule has no source experiences' });
    }

    const deletedRows = await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_experiences"
          SET is_deleted = true,
              updated_at = NOW()
        WHERE repo_id = $1
          AND id = ANY($2)
          AND is_deleted = false
      RETURNING id`,
      [repoId, sourceIds],
    ) as Array<{ id: string }>;

    await compilerService.compileRepo(req.auth.orgId, repoId);
    await compilerService.compileOrgRules(req.auth.orgId);

    return { success: true, deleted_sources: deletedRows.length };
  });

  // Delete repo
  app.delete('/api/v1/repos/:repoId', { preHandler: [authMiddleware, requireRole('owner', 'admin'), accountWriteGuard, accountRecentReauthGuard] }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = (req.body ?? {}) as { confirm_name?: string };
    const rows = await AppDataSource.query(
      `SELECT name FROM "${req.auth.orgId}_repos" WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [repoId],
    ) as Array<{ name: string }>;
    if (rows.length === 0) return reply.status(404).send({ error: 'Repo not found' });

    const repoName = rows[0].name;
    if (!body.confirm_name?.trim()) return reply.status(400).send({ error: 'confirm_name is required' });
    if (body.confirm_name.trim() !== repoName) {
      return reply.status(400).send({ error: 'Repository name confirmation does not match' });
    }

    await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_repos" SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
      [repoId],
    );
    await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_experiences" SET is_deleted = true, updated_at = NOW() WHERE repo_id = $1 AND is_deleted = false`,
      [repoId],
    );
    await AppDataSource.query(
      `UPDATE "${req.auth.orgId}_compiled_rules" SET is_deleted = true WHERE repo_id = $1 AND is_deleted = false`,
      [repoId],
    );
    await compilerService.compileOrgRules(req.auth.orgId);

    return { success: true };
  });
}
