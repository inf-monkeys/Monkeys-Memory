import { AppDataSource } from '../../database/ormconfig.js';
import { env } from '../../config/env.js';
import { generateId } from '../../shared/utils.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { buildRepoMetadataIngest, parseJsonField } from '../admin/repo-metadata.js';
import { consistencyService } from '../consistency/consistency.service.js';
import type { AgentAction, AgentActionResultRequest, AgentCapabilities, RepoScanResult } from '../../shared/types.js';

type RepoRow = {
  id: string;
  name: string;
  metadata: Record<string, unknown> | string | null;
};

type ActionRow = {
  id: string;
  repo_id?: string | null;
  scope_type?: string | null;
  scope_key?: string | null;
  type: string;
  status: string;
  payload: Record<string, unknown> | string | null;
  lease_expires_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const REPO_SCAN_ACTION = 'repo_scan';

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function isFresh(value: unknown, freshnessHours: number): boolean {
  if (typeof value !== 'string') return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < freshnessHours * 60 * 60 * 1000;
}

function isActiveLease(row: ActionRow, now = Date.now()): boolean {
  const expiry = row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : 0;
  return row.status === 'leased' && Number.isFinite(expiry) && expiry > now;
}

function normalizeAction(row: ActionRow, repo?: RepoRow | null): AgentAction {
  const payload = parseJsonField<Record<string, unknown>>(row.payload, {});
  return {
    id: row.id,
    type: row.type,
    repo_id: repo?.id ?? row.repo_id ?? null,
    repo: repo?.name ?? null,
    scope_type: row.scope_type === 'installation' ? 'installation' : 'repo',
    scope_key: row.scope_key ?? repo?.id,
    status: 'leased',
    lease_expires_at: toIso(row.lease_expires_at),
    payload,
  };
}

export class AgentActionsService {
  async maybeLeaseActions(orgId: string, repoName: string, userId: string, capabilities?: AgentCapabilities): Promise<AgentAction[]> {
    void capabilities;
    return this.maybeLeaseRepoScan(orgId, repoName, userId);
  }

  async maybeLeaseRepoScan(orgId: string, repoName: string, userId: string): Promise<AgentAction[]> {
    const repo = await this.loadRepoByName(orgId, repoName);
    if (!repo) return [];
    if (!this.repoNeedsScan(repo)) return [];

    const existing = await this.loadLatestAction(orgId, repo.id, REPO_SCAN_ACTION);
    if (existing) {
      if (existing.status === 'completed' && existing.completed_at && isFresh(toIso(existing.completed_at), env.agentActions.repoScanFreshnessHours)) {
        return [];
      }
      if (isActiveLease(existing)) return [];
    }

    const action = existing && ['pending', 'leased', 'failed'].includes(existing.status)
      ? await this.reuseActionLease(orgId, existing.id, userId)
      : await this.createActionLease(orgId, repo, userId);

    return [normalizeAction(action, repo)];
  }

  async recordResult(orgId: string, userId: string, actionId: string, body: AgentActionResultRequest) {
    const rows = await AppDataSource.query(
      `SELECT a.id, a.repo_id, a.scope_type, a.scope_key, a.type, a.status, a.payload, a.lease_expires_at, a.created_at, r.name, r.metadata
         FROM "${orgId}_agent_actions" a
         LEFT JOIN "${orgId}_repos" r
           ON r.id = a.repo_id
          AND r.is_deleted = false
        WHERE a.id = $1
        LIMIT 1`,
      [actionId],
    ) as Array<ActionRow & RepoRow & { repo_id: string }>;

    const row = rows[0];
    if (!row) throw new NotFoundError('Agent action not found');
    if (row.status === 'completed') {
      return { id: actionId, status: 'completed', already_completed: true };
    }
    if (!isActiveLease(row)) throw new ForbiddenError('Agent action lease is not active');

    const success = body.status === 'completed';
    if (row.type !== REPO_SCAN_ACTION) throw new BadRequestError(`Unsupported agent action type: ${row.type}`);
    if (success && !body.result) throw new BadRequestError('result is required for completed repo_scan actions');
    const repoId = row.repo_id;
    if (!repoId) throw new BadRequestError('repo_scan action is missing repo_id');
    let metadataSummary: Record<string, unknown> | null = null;
    let consistencyReport: unknown = null;

    if (success) {
      const currentMetadata = parseJsonField<Record<string, unknown>>(row.metadata, {});
      const scan = body.result as RepoScanResult;
      const { metadata, summary } = buildRepoMetadataIngest(currentMetadata, {
        provider: 'agent',
        event: 'repo-scan',
        mode: 'snapshot',
        scan_mode: scan.scan_mode,
        branch: scan.branch ?? null,
        commit: scan.commit ?? null,
        known_paths: scan.known_paths,
        known_path_count: scan.known_path_count,
        known_path_sample: scan.known_path_sample,
        known_dirs: scan.known_dirs,
        changed_paths: scan.changed_paths,
        deleted_paths: scan.deleted_paths,
        renamed_paths: scan.renamed_paths,
        code_entities: scan.code_entities ?? scan.entity_definitions,
        code_entity_count: scan.code_entity_count,
        code_entity_sample: scan.code_entity_sample,
        repo_profile: scan.repo_profile,
        repo_brief: scan.repo_brief,
        agent_repo_guide: scan.agent_repo_guide,
      });
      metadataSummary = summary;

      await AppDataSource.query(
        `UPDATE "${orgId}_repos"
            SET metadata = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(metadata), repoId],
      );
      consistencyReport = await consistencyService.scanRepo(orgId, repoId);
    }

    const resultPayload = {
      status: body.status,
      result: body.result ?? null,
      error: body.error ?? null,
      metadata: metadataSummary,
      consistency: consistencyReport,
      reported_by: userId,
      reported_at: new Date().toISOString(),
    };

    await AppDataSource.query(
      `UPDATE "${orgId}_agent_actions"
          SET status = $1,
              result = $2,
              completed_at = CASE WHEN $1::varchar = 'completed' THEN NOW() ELSE completed_at END,
              updated_at = NOW()
        WHERE id = $3`,
      [success ? 'completed' : 'failed', JSON.stringify(resultPayload), actionId],
    );

    return {
      id: actionId,
      status: success ? 'completed' : 'failed',
      repo_id: repoId,
      metadata: metadataSummary,
      consistency: consistencyReport,
    };
  }

  private async loadRepoByName(orgId: string, repoName: string): Promise<RepoRow | null> {
    const rows = await AppDataSource.query(
      `SELECT id, name, metadata
         FROM "${orgId}_repos"
        WHERE name = $1
          AND allowlisted = true
          AND is_deleted = false
        LIMIT 1`,
      [repoName],
    ) as RepoRow[];
    return rows[0] ?? null;
  }

  private repoNeedsScan(repo: RepoRow): boolean {
    const metadata = parseJsonField<Record<string, unknown>>(repo.metadata, {});
    if (isFresh(metadata.paths_updated_at, env.agentActions.repoScanFreshnessHours)) return false;
    const consistency = parseJsonField<Record<string, unknown> | null>(metadata.consistency, null);
    if (isFresh(consistency?.scanned_at, env.agentActions.repoScanFreshnessHours)) return false;
    return true;
  }

  private async loadLatestAction(orgId: string, repoId: string, type: string): Promise<ActionRow | null> {
    const rows = await AppDataSource.query(
      `SELECT id, repo_id, scope_type, scope_key, type, status, payload, lease_expires_at, completed_at, created_at, updated_at
         FROM "${orgId}_agent_actions"
        WHERE repo_id = $1
          AND type = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [repoId, type],
    ) as ActionRow[];
    return rows[0] ?? null;
  }

  private async createActionLease(orgId: string, repo: RepoRow, userId: string): Promise<ActionRow> {
    const actionId = generateId('act');
    const payload = {
      operation: REPO_SCAN_ACTION,
      instructions: 'Scan the local repository after the main task and report a metadata snapshot.',
      schema_version: 1,
    };
    const rows = await AppDataSource.query(
      `INSERT INTO "${orgId}_agent_actions"
         (id, repo_id, scope_type, scope_key, type, status, payload, leased_by, lease_expires_at, created_at, updated_at)
       VALUES ($1, $2, 'repo', $7, $3, 'leased', $4, $5, NOW() + ($6 || ' seconds')::interval, NOW(), NOW())
       RETURNING id, repo_id, scope_type, scope_key, type, status, payload, lease_expires_at, completed_at, created_at, updated_at`,
      [actionId, repo.id, REPO_SCAN_ACTION, JSON.stringify(payload), userId, env.agentActions.leaseSeconds, repo.id],
    ) as ActionRow[];
    return rows[0];
  }

  private async reuseActionLease(orgId: string, actionId: string, userId: string): Promise<ActionRow> {
    const rows = await AppDataSource.query(
      `UPDATE "${orgId}_agent_actions"
          SET status = 'leased',
              leased_by = $1,
              lease_expires_at = NOW() + ($2 || ' seconds')::interval,
              updated_at = NOW()
        WHERE id = $3
        RETURNING id, repo_id, scope_type, scope_key, type, status, payload, lease_expires_at, completed_at, created_at, updated_at`,
      [userId, env.agentActions.leaseSeconds, actionId],
    ) as ActionRow[];
    return rows[0];
  }

}

export const agentActionsService = new AgentActionsService();
