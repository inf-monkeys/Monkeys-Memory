import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { localContextMiddleware, requireRole } from '../../middleware/local-context.middleware.js';
import { AppDataSource } from '../../database/ormconfig.js';
import type { CompiledRule, ReviewQueueItem, RulePack } from '../../shared/types.js';

type CompiledRow = {
  repo_id: string | null;
  repo_name?: string | null;
  rule_type: 'repo' | 'org';
  content: RulePack | string;
  compiled_at: string;
  repo_metadata?: Record<string, unknown> | string | null;
};

type TrajectoryRow = {
  status: string;
  candidates: string | Array<{
    status?: string;
    confidence?: number;
    created_experience_id?: string | null;
    review_action?: string | null;
  }>;
};

type MetricDetailRow = {
  metric_type: string;
  count: string;
  details: string | Record<string, unknown> | null;
};

type QueryErrorLike = {
  code?: string;
  message?: string;
  driverError?: {
    code?: string;
    message?: string;
  };
};

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? '0'), 10) || 0;
}

function clampDays(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '30'), 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(365, parsed));
}

function anonymize(value: unknown): string {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16);
}

function parseRulePack(content: RulePack | string): RulePack & { entity_index?: { entities?: Record<string, unknown> }; review_queue?: { items?: ReviewQueueItem[] } } {
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

function parseCandidates(candidates: TrajectoryRow['candidates']): Array<{ status?: string; confidence?: number; created_experience_id?: string | null; review_action?: string | null }> {
  return typeof candidates === 'string' ? JSON.parse(candidates) : candidates;
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const queryError = error as QueryErrorLike;
  const code = queryError.code ?? queryError.driverError?.code;
  const message = queryError.message ?? queryError.driverError?.message ?? '';
  return code === '42P01' || (message.includes('_trajectory_events') && message.includes('does not exist'));
}

async function getTrajectoryRows(orgId: string, sinceTimestamp: string): Promise<TrajectoryRow[]> {
  try {
    return await AppDataSource.query(
      `SELECT status, candidates
         FROM "${orgId}_trajectory_events"
        WHERE created_at >= $1`,
      [sinceTimestamp],
    ) as TrajectoryRow[];
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

function parseMetricDetails(details: MetricDetailRow['details']): Record<string, unknown> {
  if (!details) return {};
  return typeof details === 'string' ? JSON.parse(details) as Record<string, unknown> : details;
}

function parseJsonField<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as T;
}

function consistencyFindingCount(metadata: CompiledRow['repo_metadata']): number {
  const parsed = parseJsonField<Record<string, unknown>>(metadata, {});
  const consistency = parseJsonField<Record<string, unknown> | null>(parsed.consistency as Record<string, unknown> | string | null | undefined, null);
  return Number(consistency?.finding_count ?? 0) || 0;
}

function relationshipCounts(item: CompiledRule): Record<string, number> {
  return Object.entries(item.relationships ?? {}).reduce((acc: Record<string, number>, [key, values]) => {
    acc[key] = Array.isArray(values) ? values.length : 0;
    return acc;
  }, {});
}

function evaluationItem(orgId: string, repoId: string, item: CompiledRule) {
  const sensitivity = item.policy?.sensitivity ?? 'normal';
  return {
    item_key: anonymize(`${orgId}:${repoId}:${item.id}`),
    kind: item.kind,
    confidence: item.confidence,
    confidence_score: item.confidence_score ?? null,
    quality_score: item.quality_score ?? null,
    lifecycle_state: item.lifecycle?.state ?? 'active',
    source_count: item.source_count ?? 0,
    evidence_count: item.evidence_count ?? 0,
    scope_path_count: item.scope?.paths?.length ?? 0,
    task_type_count: item.scope?.task_types?.length ?? 0,
    entity_count: item.scope?.entities?.length ?? 0,
    has_sensitive_policy: Boolean(sensitivity && sensitivity !== 'normal'),
    redaction_category_count: item.policy?.redaction_categories?.length ?? 0,
    relationship_counts: relationshipCounts(item),
  };
}

function redactionCategoryCounts(items: CompiledRule[]): Record<string, number> {
  return items.reduce((acc: Record<string, number>, item) => {
    for (const category of item.policy?.redaction_categories ?? []) {
      acc[category] = (acc[category] ?? 0) + 1;
    }
    return acc;
  }, {});
}

function semanticRelationSummary(pack: ReturnType<typeof parseRulePack>) {
  const relations = pack.semantic_relations ?? [];
  const byRelation = relations.reduce((acc: Record<string, number>, relation) => {
    acc[relation.relation] = (acc[relation.relation] ?? 0) + 1;
    return acc;
  }, {});
  const reviewable = relations.filter(relation => ['contradicts', 'supersedes', 'superseded_by', 'duplicates'].includes(relation.relation));
  const averageConfidence = relations.length === 0
    ? 0
    : Number((relations.reduce((sum, relation) => sum + relation.confidence, 0) / relations.length).toFixed(2));
  return {
    total: relations.length,
    by_relation: byRelation,
    reviewable_count: reviewable.length,
    average_confidence: averageConfidence,
  };
}

function scenarioHints(args: {
  items: CompiledRule[];
  reviewItems: ReviewQueueItem[];
  consistencyFindings: number;
  entityCount: number;
  taskTypeCount: number;
  semanticRelations: ReturnType<typeof semanticRelationSummary>;
}): Record<string, boolean> {
  const crossUserItems = args.items.filter(item => (item.provenance?.authors ?? []).length > 1 || (item.source_count ?? 0) > 1).length;
  const sensitiveItems = args.items.filter(item => item.policy?.sensitivity && item.policy.sensitivity !== 'normal').length;
  const staleItems = args.items.filter(item => ['stale', 'contested', 'deprecated'].includes(item.lifecycle?.state ?? '')).length;
  const proceduralItems = args.items.filter(item => ['procedure', 'checklist'].includes(item.kind)).length;
  return {
    has_cold_start_signal: args.items.length <= 2 || args.entityCount <= 1,
    has_cross_user_signal: crossUserItems > 0,
    has_procedural_memory: proceduralItems > 0,
    has_policy_sensitive_memory: sensitiveItems > 0,
    has_consistency_drift: args.consistencyFindings > 0,
    has_review_pressure: args.reviewItems.length > 0 || staleItems > 0,
    has_semantic_relations: args.semanticRelations.total > 0,
    has_task_diversity: args.taskTypeCount >= 2,
  };
}

function emptyAggregateCounters() {
  return {
    repo_count: 0,
    item_count: 0,
    rule_count: 0,
    exception_count: 0,
    procedure_count: 0,
    entity_count: 0,
    task_type_count: 0,
    review_item_count: 0,
    consistency_finding_count: 0,
    sensitive_item_count: 0,
    redaction_category_count: 0,
    semantic_relation_count: 0,
    semantic_reviewable_relation_count: 0,
  };
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/v1/analytics/overview', { preHandler: [localContextMiddleware] }, async (req) => {
    const expCount = await AppDataSource.query(
      `SELECT COUNT(*) as count FROM "${req.workspace.orgId}_experiences" WHERE status = 'active' AND is_deleted = false`,
    );
    const repoCount = await AppDataSource.query(
      `SELECT COUNT(*) as count FROM "${req.workspace.orgId}_repos" WHERE is_deleted = false`,
    );
    const memberCount = await AppDataSource.query(
      `SELECT COUNT(*) as count FROM "${req.workspace.orgId}_users" WHERE is_deleted = false`,
    );

    const today = new Date().toISOString().slice(0, 10);
    const metrics = await AppDataSource.query(
      `SELECT metric_type, SUM(count) as total FROM "${req.workspace.orgId}_usage_metrics"
       WHERE date >= $1 GROUP BY metric_type`,
      [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)],
    );
    const metricDetails = await AppDataSource.query(
      `SELECT metric_type, count, details
         FROM "${req.workspace.orgId}_usage_metrics"
        WHERE date >= $1
          AND metric_type IN ('compile_latency_ms', 'compile_sync_delay_ms')`,
      [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)],
    ) as MetricDetailRow[];
    const feedbackRows = await AppDataSource.query(
      `SELECT outcome, COUNT(*) as count
         FROM "${req.workspace.orgId}_feedback_events"
        WHERE created_at >= $1
        GROUP BY outcome`,
      [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()],
    ) as Array<{ outcome: string; count: string }>;
    const reviewRows = await AppDataSource.query(
      `SELECT action, review_item_reason, COUNT(*) as count
         FROM "${req.workspace.orgId}_review_events"
        WHERE created_at >= $1
        GROUP BY action, review_item_reason`,
      [new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()],
    ) as Array<{ action: string; review_item_reason: string | null; count: string }>;
    const redactionRows = await AppDataSource.query(
      `SELECT
          COUNT(*) FILTER (WHERE policy ->> 'redaction_status' = 'redacted') as redacted,
          COUNT(*) FILTER (WHERE policy ->> 'sensitivity' = 'secret-adjacent') as secret_adjacent
         FROM "${req.workspace.orgId}_experiences"
        WHERE is_deleted = false`,
    ) as Array<{ redacted: string; secret_adjacent: string }>;
    const compiledRows = await AppDataSource.query(
      `SELECT cr.repo_id, r.name as repo_name, r.metadata as repo_metadata, cr.rule_type, cr.content, cr.compiled_at
         FROM "${req.workspace.orgId}_compiled_rules" cr
         LEFT JOIN "${req.workspace.orgId}_repos" r ON r.id = cr.repo_id
        WHERE cr.is_deleted = false
          AND (r.is_deleted = false OR cr.repo_id IS NULL)
        ORDER BY cr.rule_type, cr.repo_id, cr.version DESC`,
    ) as CompiledRow[];
    const trajectoryRows = await getTrajectoryRows(req.workspace.orgId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    const latestRepoPacks = new Map<string, CompiledRow & { pack: ReturnType<typeof parseRulePack> }>();
    let latestOrgPack: ReturnType<typeof parseRulePack> | null = null;
    for (const row of compiledRows) {
      const pack = parseRulePack(row.content);
      if (row.rule_type === 'org') {
        latestOrgPack ??= pack;
        continue;
      }
      if (row.repo_id && !latestRepoPacks.has(row.repo_id)) latestRepoPacks.set(row.repo_id, { ...row, pack });
    }

    const feedback = feedbackRows.reduce((acc: Record<string, number>, row) => {
      acc[row.outcome] = toInt(row.count);
      return acc;
    }, {});
    const reviewActions = reviewRows.reduce((acc: Record<string, number>, row) => {
      acc[row.action] = (acc[row.action] ?? 0) + toInt(row.count);
      return acc;
    }, {});
    const reviewReasons = reviewRows.reduce((acc: Record<string, number>, row) => {
      const reason = row.review_item_reason ?? 'unknown';
      acc[reason] = (acc[reason] ?? 0) + toInt(row.count);
      return acc;
    }, {});
    const metricSummary = metricDetails.reduce((acc: Record<string, { count: number; total_ms: number; max_ms: number; avg_ms: number }>, row) => {
      const details = parseMetricDetails(row.details);
      const count = toInt(row.count);
      const totalMs = Number(details.total_ms ?? details.last_ms ?? 0) || 0;
      const maxMs = Number(details.max_ms ?? details.last_ms ?? 0) || 0;
      const current = acc[row.metric_type] ?? { count: 0, total_ms: 0, max_ms: 0, avg_ms: 0 };
      current.count += count;
      current.total_ms += totalMs;
      current.max_ms = Math.max(current.max_ms, maxMs);
      current.avg_ms = current.count > 0 ? Math.round(current.total_ms / current.count) : 0;
      acc[row.metric_type] = current;
      return acc;
    }, {});

    const coverageRepos = [];
    const topEntityCounts = new Map<string, { entity: string; rules: number; repos: Set<string> }>();
    let totalReviewItems = 0;
    let totalSensitiveItems = 0;
    let totalQuality = 0;
    let qualityCount = 0;
    let totalGovernanceCost = 0;
    let totalReuseScore = 0;
    for (const [repoId, row] of latestRepoPacks) {
      const pack = row.pack;
      const items = allItems(pack);
      const reviewItems = pack.review_queue?.items ?? [];
      const byPath = items.reduce((acc: Record<string, number>, item) => {
        for (const scopePath of item.scope.paths ?? ['**']) acc[scopePath] = (acc[scopePath] ?? 0) + 1;
        return acc;
      }, {});
      const entityNames = Object.keys(pack.entity_index?.entities ?? {});
      const taskTypes = new Set(items.flatMap(item => item.scope.task_types ?? []));
      const staleCount = items.filter(item => item.lifecycle?.state === 'stale' || item.lifecycle?.state === 'contested').length;
      const sensitiveCount = items.filter(item => item.policy?.sensitivity && item.policy.sensitivity !== 'normal').length;
      const driftCount = consistencyFindingCount(row.repo_metadata);
      const zeroEvidenceCount = items.filter(item => (item.evidence_count ?? 0) === 0).length;
      const confirmedCount = items.filter(item => item.lifecycle?.state === 'confirmed').length;
      const sourceSupport = items.reduce((sum, item) => sum + (item.source_count ?? 0), 0);
      const crossUserCount = items.filter(item => (item.provenance?.authors ?? []).length > 1).length;
      const highQualityCount = items.filter(item => (item.quality_score ?? 0) >= 0.75).length;
      const reuseScore = sourceSupport + crossUserCount * 2 + highQualityCount + confirmedCount * 2;
      const governanceCost = reviewItems.length + sensitiveCount + zeroEvidenceCount + driftCount;
      const avgQuality = items.length > 0
        ? items.reduce((sum, item) => sum + (item.quality_score ?? 0.7), 0) / items.length
        : 0;
      const reviewPressure = items.length > 0 ? reviewItems.length / items.length : 0;
      const coverageScore = Math.max(0, Math.min(100, Math.round(
        (avgQuality * 52) +
        (Math.min(entityNames.length, 12) / 12 * 22) +
        (Math.min(taskTypes.size, 6) / 6 * 16) -
        (reviewPressure * 18) -
        (Math.min(driftCount, 8) / 8 * 12),
      )));

      totalReviewItems += reviewItems.length;
      totalReviewItems += driftCount;
      totalSensitiveItems += sensitiveCount;
      totalQuality += avgQuality * items.length;
      qualityCount += items.length;
      totalReuseScore += reuseScore;
      totalGovernanceCost += governanceCost;

      for (const item of items) {
        for (const entity of item.scope.entities ?? []) {
          const entry = topEntityCounts.get(entity) ?? { entity, rules: 0, repos: new Set<string>() };
          entry.rules += 1;
          entry.repos.add(row.repo_name ?? repoId);
          topEntityCounts.set(entity, entry);
        }
      }

      coverageRepos.push({
        repo_id: repoId,
        repo_name: row.repo_name ?? pack.repo_name,
        source_experience_count: pack.source_experience_count ?? 0,
        rule_count: pack.rules?.length ?? 0,
        procedure_count: (pack.procedures?.length ?? 0) + (pack.checklists?.length ?? 0),
        entity_count: entityNames.length,
        task_type_count: taskTypes.size,
        review_item_count: reviewItems.length,
        consistency_finding_count: driftCount,
        stale_or_contested_count: staleCount,
        sensitive_count: sensitiveCount,
        zero_evidence_count: zeroEvidenceCount,
        reuse_score: reuseScore,
        governance_cost: governanceCost,
        quality_score: Number(avgQuality.toFixed(2)),
        coverage_score: coverageScore,
        thin_paths: Object.entries(byPath)
          .filter(([, count]) => count <= 1)
          .map(([scopePath, count]) => ({ path: scopePath, count }))
          .sort((left, right) => left.count - right.count || left.path.localeCompare(right.path))
          .slice(0, 8),
      });
    }

    coverageRepos.sort((a, b) => a.coverage_score - b.coverage_score || b.review_item_count - a.review_item_count);

    const topEntities = [...topEntityCounts.values()]
      .sort((a, b) => b.rules - a.rules || b.repos.size - a.repos.size || a.entity.localeCompare(b.entity))
      .slice(0, 8)
      .map(entry => ({ entity: entry.entity, rule_count: entry.rules, repo_count: entry.repos.size }));

    const confirmedReviews = (reviewActions.confirm ?? 0) + (feedback.helpful ?? 0) + (feedback.accepted ?? 0);
    const stalePrevented = (reviewActions.mark_stale ?? 0) + (reviewActions.deprecate ?? 0) + (feedback.outdated ?? 0);
    let trajectoryPending = 0;
    let trajectoryApproved = 0;
    let trajectoryDismissed = 0;
    let trajectoryCreatedExperiences = 0;
    let trajectoryConfidenceTotal = 0;
    let trajectoryConfidenceCount = 0;
    const trajectoryReviewActions: Record<string, number> = {};
    for (const row of trajectoryRows) {
      for (const candidate of parseCandidates(row.candidates)) {
        if (candidate.status === 'approved') trajectoryApproved += 1;
        else if (candidate.status === 'dismissed') trajectoryDismissed += 1;
        else trajectoryPending += 1;
        if (candidate.created_experience_id) trajectoryCreatedExperiences += 1;
        if (candidate.review_action) {
          trajectoryReviewActions[candidate.review_action] = (trajectoryReviewActions[candidate.review_action] ?? 0) + 1;
        }
        if (typeof candidate.confidence === 'number') {
          trajectoryConfidenceTotal += candidate.confidence;
          trajectoryConfidenceCount += 1;
        }
      }
    }
    const trajectoryResolved = trajectoryApproved + trajectoryDismissed;
    const trajectoryTotal = trajectoryPending + trajectoryResolved;

    return {
      experience_count: parseInt(expCount[0].count),
      repo_count: parseInt(repoCount[0].count),
      member_count: parseInt(memberCount[0].count),
      last_30_days: metrics.reduce((acc: Record<string, number>, m: { metric_type: string; total: string }) => {
        acc[m.metric_type] = parseInt(m.total);
        return acc;
      }, {}),
      impact: {
        feedback,
        review_actions: reviewActions,
        review_reasons: reviewReasons,
        confirmed_or_helpful: confirmedReviews,
        stale_prevented: stalePrevented,
        org_reuse_rules: latestOrgPack?.rules?.length ?? 0,
        redacted_experiences: toInt(redactionRows[0]?.redacted),
        secret_adjacent_experiences: toInt(redactionRows[0]?.secret_adjacent),
        open_review_items: totalReviewItems,
        trajectory_candidates: trajectoryTotal,
        trajectory_pending: trajectoryPending,
        trajectory_approved: trajectoryApproved,
        trajectory_dismissed: trajectoryDismissed,
        trajectory_created_experiences: trajectoryCreatedExperiences,
        trajectory_conversion_rate: trajectoryResolved > 0 ? Number((trajectoryApproved / trajectoryResolved).toFixed(2)) : 0,
        trajectory_avg_confidence: trajectoryConfidenceCount > 0 ? Number((trajectoryConfidenceTotal / trajectoryConfidenceCount).toFixed(2)) : 0,
        trajectory_review_actions: trajectoryReviewActions,
        trajectory_reviewed: Object.values(trajectoryReviewActions).reduce((sum, count) => sum + count, 0),
        trajectory_review_confirmed: trajectoryReviewActions.confirm ?? 0,
        trajectory_review_stale: trajectoryReviewActions.mark_stale ?? 0,
        trajectory_review_deprecated: trajectoryReviewActions.deprecate ?? 0,
        trajectory_review_dismissed: trajectoryReviewActions.dismiss ?? 0,
        compile_latency_ms: metricSummary.compile_latency_ms ?? { count: 0, total_ms: 0, max_ms: 0, avg_ms: 0 },
        compile_sync_delay_ms: metricSummary.compile_sync_delay_ms ?? { count: 0, total_ms: 0, max_ms: 0, avg_ms: 0 },
        reuse_score: totalReuseScore,
        governance_cost: totalGovernanceCost,
        net_reuse_value: totalReuseScore - totalGovernanceCost,
      },
      coverage: {
        avg_quality_score: qualityCount > 0 ? Number((totalQuality / qualityCount).toFixed(2)) : 0,
        sensitive_rule_count: totalSensitiveItems,
        repo_count_with_compiled_memory: latestRepoPacks.size,
        repos: coverageRepos,
        top_entities: topEntities,
      },
    };
  });

  app.get('/api/v1/analytics/evaluation-export', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req) => {
    const query = req.query as { days?: string };
    const days = clampDays(query.days);
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sinceTimestamp = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const metrics = await AppDataSource.query(
      `SELECT metric_type, SUM(count) as total
         FROM "${req.workspace.orgId}_usage_metrics"
        WHERE date >= $1
        GROUP BY metric_type`,
      [sinceDate],
    ) as Array<{ metric_type: string; total: string }>;
    const feedbackRows = await AppDataSource.query(
      `SELECT outcome, COUNT(*) as count
         FROM "${req.workspace.orgId}_feedback_events"
        WHERE created_at >= $1
        GROUP BY outcome`,
      [sinceTimestamp],
    ) as Array<{ outcome: string; count: string }>;
    const reviewRows = await AppDataSource.query(
      `SELECT action, review_item_reason, COUNT(*) as count
         FROM "${req.workspace.orgId}_review_events"
        WHERE created_at >= $1
        GROUP BY action, review_item_reason`,
      [sinceTimestamp],
    ) as Array<{ action: string; review_item_reason: string | null; count: string }>;
    const compiledRows = await AppDataSource.query(
      `SELECT cr.repo_id, r.name as repo_name, r.metadata as repo_metadata, cr.rule_type, cr.content, cr.compiled_at
         FROM "${req.workspace.orgId}_compiled_rules" cr
         LEFT JOIN "${req.workspace.orgId}_repos" r ON r.id = cr.repo_id
        WHERE cr.is_deleted = false
          AND cr.rule_type = 'repo'
          AND r.is_deleted = false
        ORDER BY cr.repo_id, cr.version DESC`,
    ) as CompiledRow[];
    const trajectoryRows = await getTrajectoryRows(req.workspace.orgId, sinceTimestamp);

    const latestRepoRows = new Map<string, CompiledRow & { pack: ReturnType<typeof parseRulePack> }>();
    for (const row of compiledRows) {
      if (!row.repo_id || latestRepoRows.has(row.repo_id)) continue;
      latestRepoRows.set(row.repo_id, { ...row, pack: parseRulePack(row.content) });
    }

    let trajectoryCandidateCount = 0;
    let trajectoryCreatedExperienceCount = 0;
    const trajectoryStatusCounts: Record<string, number> = {};
    for (const row of trajectoryRows) {
      for (const candidate of parseCandidates(row.candidates)) {
        const status = candidate.status ?? 'pending';
        trajectoryStatusCounts[status] = (trajectoryStatusCounts[status] ?? 0) + 1;
        trajectoryCandidateCount += 1;
        if (candidate.created_experience_id) trajectoryCreatedExperienceCount += 1;
      }
    }

    const aggregates = emptyAggregateCounters();
    const scenarioCounts: Record<string, number> = {};
    const repos = [...latestRepoRows.entries()].map(([repoId, row]) => {
      const pack = row.pack;
      const items = allItems(pack);
      const reviewItems = pack.review_queue?.items ?? [];
      const entityNames = Object.keys(pack.entity_index?.entities ?? {});
      const taskTypes = new Set(items.flatMap(item => item.scope.task_types ?? []));
      const consistencyFindings = consistencyFindingCount(row.repo_metadata);
      const semanticRelations = semanticRelationSummary(pack);
      const redactionCounts = redactionCategoryCounts(items);
      const sensitiveCount = items.filter(item => item.policy?.sensitivity && item.policy.sensitivity !== 'normal').length;
      const hints = scenarioHints({
        items,
        reviewItems,
        consistencyFindings,
        entityCount: entityNames.length,
        taskTypeCount: taskTypes.size,
        semanticRelations,
      });
      aggregates.repo_count += 1;
      aggregates.item_count += items.length;
      aggregates.rule_count += pack.rules?.length ?? 0;
      aggregates.exception_count += pack.exceptions?.length ?? 0;
      aggregates.procedure_count += (pack.procedures?.length ?? 0) + (pack.checklists?.length ?? 0);
      aggregates.entity_count += entityNames.length;
      aggregates.task_type_count += taskTypes.size;
      aggregates.review_item_count += reviewItems.length;
      aggregates.consistency_finding_count += consistencyFindings;
      aggregates.sensitive_item_count += sensitiveCount;
      aggregates.redaction_category_count += Object.values(redactionCounts).reduce((sum, count) => sum + count, 0);
      aggregates.semantic_relation_count += semanticRelations.total;
      aggregates.semantic_reviewable_relation_count += semanticRelations.reviewable_count;
      for (const [key, enabled] of Object.entries(hints)) {
        if (enabled) scenarioCounts[key] = (scenarioCounts[key] ?? 0) + 1;
      }
      return {
        repo_key: anonymize(`${req.workspace.orgId}:${repoId}`),
        compiled_at: row.compiled_at,
        source_experience_count: pack.source_experience_count ?? 0,
        item_count: items.length,
        rule_count: pack.rules?.length ?? 0,
        exception_count: pack.exceptions?.length ?? 0,
        procedure_count: (pack.procedures?.length ?? 0) + (pack.checklists?.length ?? 0),
        entity_count: entityNames.length,
        task_type_count: taskTypes.size,
        review_item_count: reviewItems.length,
        consistency_finding_count: consistencyFindings,
        semantic_relations: semanticRelations,
        redaction_category_counts: redactionCounts,
        scenario_hints: hints,
        items: items.map(item => evaluationItem(req.workspace.orgId, repoId, item)),
      };
    });

    return {
      schema_version: 'monkeys-memory-evaluation-export/v2',
      version: 2,
      generated_at: new Date().toISOString(),
      window_days: days,
      evaluation_profile: {
        artifact_type: 'privacy_preserving_operational_trace',
        label_strategy: 'weak_operational_labels',
        supported_conditions: ['compiled_memory', 'policy_filtered', 'trajectory_candidates', 'semantic_relations'],
        excluded_conditions: ['raw_claim_text_replay', 'human_usefulness_labels'],
        notes: [
          'Derived from compiled artifacts and event streams.',
          'No separate analytics fact table is required.',
        ],
      },
      privacy: {
        anonymized: true,
        excluded_fields: ['org_id', 'repo_name', 'user_id', 'claim', 'title', 'path_values', 'entity_names', 'evidence_refs'],
      },
      aggregates,
      scenario_counts: scenarioCounts,
      metrics: metrics.reduce((acc: Record<string, number>, row) => {
        acc[row.metric_type] = toInt(row.total);
        return acc;
      }, {}),
      feedback: feedbackRows.reduce((acc: Record<string, number>, row) => {
        acc[row.outcome] = toInt(row.count);
        return acc;
      }, {}),
      review: reviewRows.map(row => ({
        action: row.action,
        reason: row.review_item_reason ?? 'unknown',
        count: toInt(row.count),
      })),
      trajectories: {
        candidate_count: trajectoryCandidateCount,
        created_experience_count: trajectoryCreatedExperienceCount,
        status_counts: trajectoryStatusCounts,
      },
      repos,
    };
  });
}
