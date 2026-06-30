import { AppDataSource } from '../../database/ormconfig.js';
import { generateId } from '../../shared/utils.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';
import { captureService } from '../capture/capture.service.js';
import { compilerService } from '../compiler/compiler.service.js';
import type { AgentMemoryEvaluationRequest, CaptureRequest, CompiledRule, FeedbackRequest, MemoryFeedbackEvent, RulePack } from '../../shared/types.js';

const VALID_OUTCOMES = new Set<MemoryFeedbackEvent['outcome']>(['helpful', 'not-relevant', 'outdated', 'accepted', 'failed']);
const MAX_AGENT_EVALUATIONS = 50;
const AUTO_REPAIR_OUTCOMES = new Set<MemoryFeedbackEvent['outcome']>(['outdated', 'failed']);

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

function sanitizeNote(note: string | null | undefined): string | null {
  return note?.trim() ? note.trim().slice(0, 1000) : null;
}

function normalizeRuleIds(ruleIds: string[]): string[] {
  return [...new Set(ruleIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
}

function clampConfidence(confidence: number | null | undefined): number | null {
  return typeof confidence === 'number' && Number.isFinite(confidence)
    ? Number(Math.max(0, Math.min(1, confidence)).toFixed(2))
    : null;
}

function uniqueStrings(values: unknown): string[] {
  const list = Array.isArray(values) ? values : typeof values === 'string' ? values.split(',') : [];
  return [...new Set(list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))];
}

function validMemoryKind(value: unknown): value is CaptureRequest['kind'] {
  return ['rule', 'exception', 'procedure', 'checklist', 'note'].includes(String(value));
}

function lifecyclePatch(outcome: MemoryFeedbackEvent['outcome'], note: string | null, replacementId: string | null) {
  const now = new Date().toISOString();
  if (replacementId) {
    return {
      state: 'superseded',
      reason: note ?? `agent:${outcome}:corrected`,
      superseded_by: replacementId,
      updated_at: now,
    };
  }
  return {
    state: 'deprecated',
    reason: note ?? `agent:${outcome}`,
    updated_at: now,
  };
}

function buildCorrectionCapture(
  repo: string,
  userId: string,
  rule: CompiledRule,
  evaluation: AgentMemoryEvaluationRequest['evaluations'][number],
  sourceIds: string[],
): CaptureRequest | null {
  const correction = evaluation.correction;
  if (!correction?.claim?.trim()) return null;
  if (correction.kind && !validMemoryKind(correction.kind)) {
    throw new BadRequestError('correction.kind must be rule, exception, procedure, checklist, or note');
  }

  const title = correction.title?.trim()
    || (rule.title ? `Correction: ${rule.title}`.slice(0, 120) : 'Corrected memory');
  const paths = uniqueStrings(correction.scope?.paths ?? rule.scope.paths);
  const taskTypes = uniqueStrings(correction.scope?.task_types ?? rule.scope.task_types);
  const entities = uniqueStrings(correction.scope?.entities ?? rule.scope.entities);
  if (paths.length === 0) throw new BadRequestError('correction.scope.paths is required when the original rule has no paths');

  return {
    repo,
    title,
    claim: correction.claim.trim(),
    kind: correction.kind ?? rule.kind,
    scope: {
      paths,
      task_types: taskTypes,
      ...(entities.length > 0 ? { entities } : {}),
    },
    evidence: correction.evidence ?? [],
    confidence: clampConfidence(correction.confidence) ?? clampConfidence(evaluation.confidence) ?? Math.min(0.85, Math.max(0.65, rule.confidence_score)),
    lifecycle: { state: 'active', reason: 'agent:correction', updated_at: new Date().toISOString() },
    provenance: {
      source_type: 'agent',
      author: userId,
      evidence_refs: uniqueStrings(evaluation.evidence),
    },
    relationships: {
      supersedes: sourceIds,
    },
    policy: correction.policy ?? rule.policy,
    validity: correction.validity ?? rule.validity,
  };
}

async function updateSourceExperiences(
  orgId: string,
  repoId: string,
  sourceIds: string[],
  lifecycle: ReturnType<typeof lifecyclePatch>,
  replacementId: string | null,
) {
  if (sourceIds.length === 0) return;
  const supersededBy = JSON.stringify(replacementId ? [replacementId] : []);
  await AppDataSource.query(
    `UPDATE "${orgId}_experiences"
        SET lifecycle = $1,
            status = 'deprecated',
            relationships = CASE
              WHEN $2::jsonb = '[]'::jsonb THEN COALESCE(relationships, '{}'::jsonb)
              ELSE jsonb_set(
                COALESCE(relationships, '{}'::jsonb),
                '{superseded_by}',
                COALESCE(relationships -> 'superseded_by', '[]'::jsonb) || $2::jsonb,
                true
              )
            END,
            updated_at = NOW()
      WHERE repo_id = $3
        AND id = ANY($4)
        AND is_deleted = false`,
    [
      JSON.stringify(lifecycle),
      supersededBy,
      repoId,
      sourceIds,
    ],
  );
}

export class FeedbackService {
  async addFeedback(orgId: string, userId: string, repoId: string, ruleId: string, req: FeedbackRequest) {
    if (!VALID_OUTCOMES.has(req.outcome)) {
      throw new BadRequestError('outcome must be helpful, not-relevant, outdated, accepted, or failed');
    }

    const compiledRows = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string }>;

    if (compiledRows.length === 0) {
      throw new NotFoundError('Compiled rules not found');
    }

    const pack = parseRulePack(compiledRows[0].content);
    const rule = allItems(pack).find(item => item.id === ruleId);
    if (!rule) {
      throw new NotFoundError('Compiled rule not found');
    }

    const eventId = generateId('fb');
    const sourceIds = [...new Set(rule.sources ?? [])];
    const note = sanitizeNote(req.note);

    await AppDataSource.query(
      `INSERT INTO "${orgId}_feedback_events"
       (id, repo_id, compiled_rule_id, source_experience_ids, outcome, note, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [eventId, repoId, ruleId, JSON.stringify(sourceIds), req.outcome, note, userId],
    );

    if (AUTO_REPAIR_OUTCOMES.has(req.outcome)) {
      await updateSourceExperiences(orgId, repoId, sourceIds, lifecyclePatch(req.outcome, note, null), null);
      await compilerService.compileRepo(orgId, repoId);
      await compilerService.compileOrgRules(orgId);
    }

    return {
      id: eventId,
      status: 'recorded',
      rule_id: ruleId,
      source_experience_count: sourceIds.length,
      ...(AUTO_REPAIR_OUTCOMES.has(req.outcome) ? { repair_action: 'deprecated' } : {}),
    };
  }

  async addAgentEvaluation(orgId: string, userId: string, req: AgentMemoryEvaluationRequest) {
    const repo = req.repo?.trim();
    if (!repo) throw new BadRequestError('repo is required');
    if (!Array.isArray(req.evaluations) || req.evaluations.length === 0) {
      throw new BadRequestError('evaluations is required');
    }
    if (req.evaluations.length > MAX_AGENT_EVALUATIONS) {
      throw new BadRequestError(`evaluations cannot contain more than ${MAX_AGENT_EVALUATIONS} items`);
    }

    const repos = await AppDataSource.query(
      `SELECT id FROM "${orgId}_repos" WHERE name = $1 AND is_deleted = false LIMIT 1`,
      [repo],
    ) as Array<{ id: string }>;
    if (repos.length === 0) throw new NotFoundError('Repository not found');
    const repoId = repos[0].id;

    const compiledRows = await AppDataSource.query(
      `SELECT content FROM "${orgId}_compiled_rules"
       WHERE repo_id = $1 AND rule_type = 'repo' AND is_deleted = false
       ORDER BY version DESC LIMIT 1`,
      [repoId],
    ) as Array<{ content: RulePack | string }>;
    if (compiledRows.length === 0) throw new NotFoundError('Compiled rules not found');

    const pack = parseRulePack(compiledRows[0].content);
    const itemMap = new Map(allItems(pack).map(item => [item.id, item]));
    const requestedRuleIds = normalizeRuleIds(req.evaluations.map(item => item.rule_id));
    if (requestedRuleIds.length !== req.evaluations.length) {
      throw new BadRequestError('each evaluation requires a unique rule_id');
    }

    const missing = requestedRuleIds.filter(ruleId => !itemMap.has(ruleId));
    if (missing.length > 0) throw new NotFoundError(`Compiled rules not found: ${missing.join(', ')}`);

    const recorded = [];
    const sourceUpdates = [];
    for (const evaluation of req.evaluations) {
      if (!VALID_OUTCOMES.has(evaluation.outcome)) {
        throw new BadRequestError('outcome must be helpful, not-relevant, outdated, accepted, or failed');
      }
      const rule = itemMap.get(evaluation.rule_id)!;
      const sourceIds = [...new Set(rule.sources ?? [])];
      const eventId = generateId('fb');
      const evidence = Array.isArray(evaluation.evidence)
        ? evaluation.evidence.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 5)
        : [];
      const confidence = clampConfidence(evaluation.confidence);
      const note = sanitizeNote([
        '[agent]',
        evaluation.adopted === true ? 'adopted' : evaluation.adopted === false ? 'not adopted' : null,
        confidence != null ? `confidence=${confidence.toFixed(2)}` : null,
        sanitizeNote(evaluation.note),
        evidence.length > 0 ? `evidence: ${evidence.join('; ')}` : null,
        req.task?.summary ? `task: ${req.task.summary}` : null,
        req.task?.outcome ? `task_outcome=${req.task.outcome}` : null,
      ].filter(Boolean).join(' | '));
      const correctionCapture = AUTO_REPAIR_OUTCOMES.has(evaluation.outcome)
        ? buildCorrectionCapture(repo, userId, rule, evaluation, sourceIds)
        : null;
      const correctionResult = correctionCapture
        ? await captureService.capture(orgId, userId, correctionCapture)
        : null;
      const metadata = {
        source: 'agent',
        adopted: evaluation.adopted ?? null,
        confidence,
        evidence,
        correction: correctionResult
          ? {
              experience_id: correctionResult.id,
              source_experience_ids: sourceIds,
            }
          : null,
        task: {
          summary: req.task?.summary ?? null,
          outcome: req.task?.outcome ?? null,
          tests_passed: req.task?.tests_passed ?? null,
          build_passed: req.task?.build_passed ?? null,
          lint_passed: req.task?.lint_passed ?? null,
          duration_ms: req.task?.duration_ms ?? null,
          commands_run: req.task?.commands_run ?? null,
          files_changed: req.task?.files_changed ?? null,
        },
      };

      await AppDataSource.query(
        `INSERT INTO "${orgId}_feedback_events"
         (id, repo_id, compiled_rule_id, source_experience_ids, outcome, note, metadata, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [eventId, repoId, evaluation.rule_id, JSON.stringify(sourceIds), evaluation.outcome, note, JSON.stringify(metadata), userId],
      );
      if (AUTO_REPAIR_OUTCOMES.has(evaluation.outcome) && sourceIds.length > 0) {
        sourceUpdates.push({
          sourceIds,
          lifecycle: lifecyclePatch(evaluation.outcome, sanitizeNote(evaluation.note), correctionResult?.id ?? null),
          replacementId: correctionResult?.id ?? null,
        });
      }
      recorded.push({
        id: eventId,
        rule_id: evaluation.rule_id,
        outcome: evaluation.outcome,
        source_experience_count: sourceIds.length,
        correction_experience_id: correctionResult?.id ?? null,
      });
    }

    for (const update of sourceUpdates) {
      await updateSourceExperiences(orgId, repoId, update.sourceIds, update.lifecycle, update.replacementId);
    }

    await compilerService.compileRepo(orgId, repoId);
    await compilerService.compileOrgRules(orgId);

    return {
      status: 'recorded',
      repo_id: repoId,
      recorded_count: recorded.length,
      items: recorded,
    };
  }
}

export const feedbackService = new FeedbackService();
