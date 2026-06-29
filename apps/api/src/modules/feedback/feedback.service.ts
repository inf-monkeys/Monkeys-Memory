import { AppDataSource } from '../../database/ormconfig.js';
import { generateId } from '../../shared/utils.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';
import { compilerService } from '../compiler/compiler.service.js';
import type { AgentMemoryEvaluationRequest, CompiledRule, FeedbackRequest, MemoryFeedbackEvent, RulePack } from '../../shared/types.js';

const VALID_OUTCOMES = new Set<MemoryFeedbackEvent['outcome']>(['helpful', 'not-relevant', 'outdated', 'accepted', 'failed']);
const MAX_AGENT_EVALUATIONS = 50;

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

    return {
      id: eventId,
      status: 'recorded',
      rule_id: ruleId,
      source_experience_count: sourceIds.length,
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
      const metadata = {
        source: 'agent',
        adopted: evaluation.adopted ?? null,
        confidence,
        evidence,
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
      recorded.push({
        id: eventId,
        rule_id: evaluation.rule_id,
        outcome: evaluation.outcome,
        source_experience_count: sourceIds.length,
      });
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
