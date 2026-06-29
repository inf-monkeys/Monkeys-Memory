import { AppDataSource } from '../../database/ormconfig.js';
import { generateId } from '../../shared/utils.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';
import { compilerService } from '../compiler/compiler.service.js';
import type { BulkReviewAssignRequest, BulkReviewResolveRequest, CompiledRule, ReviewAssignRequest, ReviewInboxItem, ReviewQueueItem, ReviewResolveRequest, RulePack, TrajectoryCandidateExperience } from '../../shared/types.js';

const VALID_ACTIONS = new Set<ReviewResolveRequest['action']>(['confirm', 'mark_stale', 'deprecate', 'dismiss', 'supersede']);

function parseRulePack(content: RulePack | string): RulePack & { review_queue?: { items?: ReviewQueueItem[] } } {
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

function parseCandidates(candidates: TrajectoryCandidateExperience[] | string): TrajectoryCandidateExperience[] {
  return typeof candidates === 'string' ? JSON.parse(candidates) as TrajectoryCandidateExperience[] : candidates;
}

type AssignmentRow = {
  compiled_rule_id: string;
  user_id: string;
  created_at: string;
  note: string | null;
  metadata: Record<string, unknown> | string | null;
};

function parseJsonField<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as T;
}

function normalizeRuleIds(ruleIds: string[] | undefined): string[] {
  return [...new Set((ruleIds ?? []).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
}

export class ReviewService {
  async listInbox(orgId: string, repoId?: string): Promise<{ items: ReviewInboxItem[] }> {
    const params: string[] = [];
    let repoFilter = '';
    if (repoId) {
      params.push(repoId);
      repoFilter = 'AND cr.repo_id = $1';
    }

    const rows = await AppDataSource.query(
      `SELECT cr.repo_id, r.name as repo_name, cr.content, cr.compiled_at
         FROM "${orgId}_compiled_rules" cr
         JOIN "${orgId}_repos" r ON r.id = cr.repo_id
        WHERE cr.rule_type = 'repo'
          AND cr.is_deleted = false
          AND r.is_deleted = false
          ${repoFilter}
        ORDER BY cr.compiled_at DESC`,
      params,
    ) as Array<{ repo_id: string; repo_name: string; content: RulePack | string; compiled_at: string }>;

    const seenRepos = new Set<string>();
    const items: ReviewInboxItem[] = [];
    for (const row of rows) {
      if (seenRepos.has(row.repo_id)) continue;
      seenRepos.add(row.repo_id);
      const pack = parseRulePack(row.content);
      const itemMap = new Map(allItems(pack).map(item => [item.id, item]));
      const assignmentMap = await this.loadAssignments(orgId, row.repo_id);
      for (const reviewItem of pack.review_queue?.items ?? []) {
        const rule = itemMap.get(reviewItem.id);
        const assignment = assignmentMap.get(reviewItem.id);
        items.push({
          ...reviewItem,
          repo_id: row.repo_id,
          repo_name: row.repo_name,
          compiled_at: row.compiled_at,
          sources: rule?.sources ?? [],
          lifecycle: rule?.lifecycle,
          quality_score: rule?.quality_score,
          assigned_to: assignment?.assigned_to ?? null,
          assigned_by: assignment?.assigned_by ?? null,
          assigned_at: assignment?.assigned_at ?? null,
          assignment_note: assignment?.assignment_note ?? null,
        });
      }
    }

    return { items };
  }

  async resolve(orgId: string, userId: string, repoId: string, ruleId: string, req: ReviewResolveRequest) {
    if (!VALID_ACTIONS.has(req.action)) {
      throw new BadRequestError('action must be confirm, mark_stale, deprecate, dismiss, or supersede');
    }

    const rows = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string }>;

    if (rows.length === 0) throw new NotFoundError('Compiled rules not found');

    const pack = parseRulePack(rows[0].content);
    const rule = allItems(pack).find(item => item.id === ruleId);
    if (!rule) throw new NotFoundError('Compiled rule not found');

    const reviewItem = (pack.review_queue?.items ?? []).find(item => item.id === ruleId);
    const sourceIds = [...new Set(rule.sources ?? [])];
    const note = req.note?.trim() ? req.note.trim().slice(0, 1000) : null;
    const eventId = generateId('rev');

    await AppDataSource.query(
      `INSERT INTO "${orgId}_review_events"
       (id, repo_id, compiled_rule_id, review_item_reason, action, note, source_experience_ids, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [eventId, repoId, ruleId, reviewItem?.reason ?? null, req.action, note, JSON.stringify(sourceIds), userId],
    );

    if (req.action !== 'dismiss' && sourceIds.length > 0) {
      const lifecycle = this.lifecyclePatch(req);
      const status = req.action === 'deprecate' ? 'deprecated' : 'active';
      await AppDataSource.query(
        `UPDATE "${orgId}_experiences"
            SET lifecycle = $1,
                status = $2,
                updated_at = NOW()
          WHERE repo_id = $3
            AND id = ANY($4)
            AND is_deleted = false`,
        [JSON.stringify(lifecycle), status, repoId, sourceIds],
      );
    }

    if (reviewItem?.reason === 'trajectory-candidate' && sourceIds.length > 0) {
      await this.updateTrajectoryReviewMetadata(orgId, sourceIds, userId, eventId, req, note);
    }

    await compilerService.compileRepo(orgId, repoId);
    await compilerService.compileOrgRules(orgId);

    return {
      id: eventId,
      status: 'resolved',
      action: req.action,
      rule_id: ruleId,
      source_experience_count: sourceIds.length,
    };
  }

  async resolveBulk(orgId: string, userId: string, repoId: string, req: BulkReviewResolveRequest) {
    if (!VALID_ACTIONS.has(req.action)) {
      throw new BadRequestError('action must be confirm, mark_stale, deprecate, dismiss, or supersede');
    }
    const ruleIds = normalizeRuleIds(req.rule_ids);
    if (ruleIds.length === 0) throw new BadRequestError('rule_ids is required');
    if (ruleIds.length > 50) throw new BadRequestError('rule_ids cannot contain more than 50 items');

    const rows = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string }>;

    if (rows.length === 0) throw new NotFoundError('Compiled rules not found');

    const pack = parseRulePack(rows[0].content);
    const itemMap = new Map(allItems(pack).map(item => [item.id, item]));
    const queueMap = new Map((pack.review_queue?.items ?? []).map(item => [item.id, item]));
    const missing = ruleIds.filter(id => !itemMap.has(id));
    if (missing.length > 0) throw new NotFoundError(`Compiled rules not found: ${missing.join(', ')}`);

    const note = req.note?.trim() ? req.note.trim().slice(0, 1000) : null;
    const resolved = [];
    const allSourceIds = new Set<string>();
    const trajectoryUpdates: Array<{ sourceIds: string[]; eventId: string }> = [];

    for (const ruleId of ruleIds) {
      const rule = itemMap.get(ruleId)!;
      const reviewItem = queueMap.get(ruleId);
      const sourceIds = [...new Set(rule.sources ?? [])];
      const eventId = generateId('rev');
      await AppDataSource.query(
        `INSERT INTO "${orgId}_review_events"
         (id, repo_id, compiled_rule_id, review_item_reason, action, note, source_experience_ids, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [eventId, repoId, ruleId, reviewItem?.reason ?? null, req.action, note, JSON.stringify(sourceIds), userId],
      );
      for (const sourceId of sourceIds) allSourceIds.add(sourceId);
      if (reviewItem?.reason === 'trajectory-candidate' && sourceIds.length > 0) {
        trajectoryUpdates.push({ sourceIds, eventId });
      }
      resolved.push({
        id: eventId,
        rule_id: ruleId,
        source_experience_count: sourceIds.length,
      });
    }

    if (req.action !== 'dismiss' && allSourceIds.size > 0) {
      const lifecycle = this.lifecyclePatch(req);
      const status = req.action === 'deprecate' ? 'deprecated' : 'active';
      await AppDataSource.query(
        `UPDATE "${orgId}_experiences"
            SET lifecycle = $1,
                status = $2,
                updated_at = NOW()
          WHERE repo_id = $3
            AND id = ANY($4)
            AND is_deleted = false`,
        [JSON.stringify(lifecycle), status, repoId, [...allSourceIds]],
      );
    }

    for (const update of trajectoryUpdates) {
      await this.updateTrajectoryReviewMetadata(orgId, update.sourceIds, userId, update.eventId, req, note);
    }

    await compilerService.compileRepo(orgId, repoId);
    await compilerService.compileOrgRules(orgId);

    return {
      status: 'resolved',
      action: req.action,
      resolved_count: resolved.length,
      source_experience_count: allSourceIds.size,
      items: resolved,
    };
  }

  async assign(orgId: string, userId: string, repoId: string, ruleId: string, req: ReviewAssignRequest) {
    const result = await this.assignBulk(orgId, userId, repoId, {
      ...req,
      rule_ids: [ruleId],
    });
    return result.items[0];
  }

  async assignBulk(orgId: string, userId: string, repoId: string, req: BulkReviewAssignRequest) {
    const assignedTo = req.assigned_to?.trim();
    if (!assignedTo) throw new BadRequestError('assigned_to is required');
    const ruleIds = normalizeRuleIds(req.rule_ids);
    if (ruleIds.length === 0) throw new BadRequestError('rule_ids is required');
    if (ruleIds.length > 50) throw new BadRequestError('rule_ids cannot contain more than 50 items');

    const rows = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string }>;
    if (rows.length === 0) throw new NotFoundError('Compiled rules not found');

    const pack = parseRulePack(rows[0].content);
    const itemMap = new Map(allItems(pack).map(item => [item.id, item]));
    const queueMap = new Map((pack.review_queue?.items ?? []).map(item => [item.id, item]));
    const missing = ruleIds.filter(id => !itemMap.has(id));
    if (missing.length > 0) throw new NotFoundError(`Compiled rules not found: ${missing.join(', ')}`);

    const note = req.note?.trim() ? req.note.trim().slice(0, 1000) : null;
    const items = [];
    for (const ruleId of ruleIds) {
      const rule = itemMap.get(ruleId)!;
      const reviewItem = queueMap.get(ruleId);
      const sourceIds = [...new Set(rule.sources ?? [])];
      const eventId = generateId('rev');
      await AppDataSource.query(
        `INSERT INTO "${orgId}_review_events"
         (id, repo_id, compiled_rule_id, review_item_reason, action, note, source_experience_ids, metadata, user_id, created_at)
         VALUES ($1, $2, $3, $4, 'assign', $5, $6, $7, $8, NOW())`,
        [
          eventId,
          repoId,
          ruleId,
          reviewItem?.reason ?? null,
          note,
          JSON.stringify(sourceIds),
          JSON.stringify({ assigned_to: assignedTo }),
          userId,
        ],
      );
      items.push({
        id: eventId,
        rule_id: ruleId,
        assigned_to: assignedTo,
      });
    }

    return {
      status: 'assigned',
      assigned_to: assignedTo,
      assigned_count: items.length,
      items,
    };
  }

  private lifecyclePatch(req: ReviewResolveRequest) {
    const now = new Date().toISOString();
    if (req.action === 'confirm') return { state: 'confirmed', reason: req.note ?? 'review:confirmed', updated_at: now };
    if (req.action === 'mark_stale') return { state: 'stale', reason: req.note ?? 'review:stale', updated_at: now };
    if (req.action === 'deprecate') return { state: 'deprecated', reason: req.note ?? 'review:deprecated', updated_at: now };
    if (req.action === 'supersede') return { state: 'superseded', reason: req.note ?? 'review:superseded', superseded_by: req.superseded_by ?? null, updated_at: now };
    return { state: 'active', reason: req.note ?? 'review:dismissed', updated_at: now };
  }

  private async updateTrajectoryReviewMetadata(
    orgId: string,
    sourceIds: string[],
    userId: string,
    eventId: string,
    req: ReviewResolveRequest,
    note: string | null,
  ) {
    const sourceSet = new Set(sourceIds);
    const rows = await AppDataSource.query(
      `SELECT id, candidates
         FROM "${orgId}_trajectory_events"
        WHERE candidates::text LIKE ANY($1)`,
      [sourceIds.map(id => `%${id}%`)],
    ) as Array<{ id: string; candidates: TrajectoryCandidateExperience[] | string }>;

    const reviewedAt = new Date().toISOString();
    for (const row of rows) {
      const candidates = parseCandidates(row.candidates);
      let changed = false;
      const nextCandidates = candidates.map((candidate) => {
        if (!candidate.created_experience_id || !sourceSet.has(candidate.created_experience_id)) return candidate;
        changed = true;
        return {
          ...candidate,
          review_action: req.action,
          reviewed_by: userId,
          reviewed_at: reviewedAt,
          review_event_id: eventId,
          review_note: note,
        };
      });
      if (!changed) continue;
      await AppDataSource.query(
        `UPDATE "${orgId}_trajectory_events"
            SET candidates = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(nextCandidates), row.id],
      );
    }
  }

  private async loadAssignments(orgId: string, repoId: string) {
    const rows = await AppDataSource.query(
      `SELECT DISTINCT ON (compiled_rule_id)
              compiled_rule_id,
              user_id,
              created_at,
              note,
              metadata
         FROM "${orgId}_review_events"
        WHERE repo_id = $1
          AND action = 'assign'
        ORDER BY compiled_rule_id, created_at DESC`,
      [repoId],
    ) as AssignmentRow[];

    const assignments = new Map<string, {
      assigned_to: string | null;
      assigned_by: string;
      assigned_at: string;
      assignment_note: string | null;
    }>();
    for (const row of rows) {
      const metadata = parseJsonField<Record<string, unknown>>(row.metadata, {});
      assignments.set(row.compiled_rule_id, {
        assigned_to: typeof metadata.assigned_to === 'string' ? metadata.assigned_to : null,
        assigned_by: row.user_id,
        assigned_at: row.created_at,
        assignment_note: row.note,
      });
    }
    return assignments;
  }
}

export const reviewService = new ReviewService();
