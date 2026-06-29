import { AppDataSource } from '../../database/ormconfig.js';
import { clamp, generateId, inferTaskType, uniqueSorted } from '../../shared/utils.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';
import type { AgentTrajectoryRequest, TrajectoryCandidateExperience } from '../../shared/types.js';
import { captureService } from '../capture/capture.service.js';

type TrajectoryRow = {
  id: string;
  repo_id: string;
  repo_name?: string;
  user_id: string;
  task: string | null;
  outcome: string;
  summary: string | null;
  events: Record<string, unknown> | string;
  candidates: TrajectoryCandidateExperience[] | string;
  status: string;
  created_at: string;
};

function parseJsonField<T>(value: T | string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  return typeof value === 'string' ? JSON.parse(value) as T : value;
}

function scopePaths(files: string[]): string[] {
  const paths = files
    .filter(Boolean)
    .map((file) => {
      const dir = file.split('/').slice(0, -1).join('/');
      return dir ? `${dir}/**` : '**';
    });
  return uniqueSorted(paths.length > 0 ? paths : ['**']);
}

function candidateTitle(outcome: AgentTrajectoryRequest['outcome'], failed: number): string {
  if (failed > 0) return 'Agent trajectory test failure';
  if (outcome === 'success') return 'Agent trajectory successful change';
  return 'Agent trajectory candidate';
}

function candidateClaim(req: AgentTrajectoryRequest, task: string): string {
  const edited = (req.files_edited ?? []).slice(0, 3).join(', ') || 'the touched files';
  const failed = req.tests?.failed ?? 0;
  if (failed > 0) {
    return `When working on ${edited}, preserve the failing-test context before changing ${task} behavior.`;
  }
  if (req.summary?.trim()) {
    return req.summary.trim().slice(0, 220);
  }
  return `Successful ${task} work edited ${edited}; reuse this path and test context for similar tasks.`;
}

function buildConfidenceHistory(req: AgentTrajectoryRequest) {
  const failed = req.tests?.failed ?? 0;
  const passed = req.tests?.passed ?? 0;
  const edited = req.files_edited?.length ?? 0;
  const commandCount = req.commands?.length ?? 0;
  const outcomeBase = req.outcome === 'success' ? 0.66 : req.outcome === 'partial' ? 0.54 : 0.46;
  const testSignal = passed > 0 ? 0.08 : failed > 0 ? -0.08 : 0;
  const editSignal = Math.min(edited, 4) * 0.02;
  const commandSignal = Math.min(commandCount, 3) * 0.015;
  let score = outcomeBase;
  const history = [{
    stage: 'outcome',
    delta: Number(outcomeBase.toFixed(3)),
    score: Number(score.toFixed(2)),
    reason: `Base confidence from ${req.outcome ?? 'unknown'} trajectory outcome.`,
  }];
  for (const item of [
    { stage: 'tests', delta: testSignal, reason: passed > 0 ? `${passed} passing tests strengthen the candidate.` : failed > 0 ? `${failed} failing tests reduce confidence.` : 'No test signal recorded.' },
    { stage: 'edits', delta: editSignal, reason: `${edited} edited file${edited === 1 ? '' : 's'} connect the candidate to code scope.` },
    { stage: 'commands', delta: commandSignal, reason: `${commandCount} command${commandCount === 1 ? '' : 's'} provide execution evidence.` },
  ]) {
    score = clamp(score + item.delta, 0.25, 0.9);
    history.push({
      stage: item.stage,
      delta: Number(item.delta.toFixed(3)),
      score: Number(score.toFixed(2)),
      reason: item.reason,
    });
  }
  return history;
}

function buildCandidates(req: AgentTrajectoryRequest, trajectoryId: string): TrajectoryCandidateExperience[] {
  const task = req.task ? inferTaskType(req.task) : inferTaskType(req.summary ?? '');
  const failed = req.tests?.failed ?? 0;
  const editedFiles = req.files_edited ?? [];
  const evidence = [
    { type: 'trajectory', ref: trajectoryId },
    ...(req.commands ?? []).slice(0, 3).map((command, index) => ({ type: 'command', ref: `${index + 1}: ${command.slice(0, 120)}` })),
  ];
  const confidenceHistory = buildConfidenceHistory(req);
  const confidence = confidenceHistory.at(-1)?.score ?? 0.5;

  return [{
    id: generateId('cand'),
    title: candidateTitle(req.outcome, failed),
    claim: candidateClaim(req, task),
    kind: failed > 0 ? 'exception' : 'rule',
    scope: {
      paths: scopePaths(editedFiles),
      task_types: [task],
    },
    evidence,
    confidence,
    confidence_history: confidenceHistory,
    status: 'pending',
    rationale: failed > 0
      ? 'Generated from failed test signals in an agent trajectory.'
      : 'Generated from a successful agent trajectory with edited files.',
    created_experience_id: null,
    resolved_by: null,
    resolved_at: null,
  }];
}

function normalizeTrajectory(row: TrajectoryRow) {
  return {
    ...row,
    events: parseJsonField(row.events, {}),
    candidates: parseJsonField(row.candidates, []),
  };
}

export class TrajectoryService {
  async ingest(orgId: string, userId: string, req: AgentTrajectoryRequest) {
    const repos = await AppDataSource.query(
      `SELECT id, name FROM "${orgId}_repos" WHERE name = $1 AND is_deleted = false LIMIT 1`,
      [req.repo],
    ) as Array<{ id: string; name: string }>;
    if (repos.length === 0) throw new BadRequestError(`Repository "${req.repo}" is not registered`);

    const trajectoryId = generateId('traj');
    const task = req.task ? inferTaskType(req.task) : inferTaskType(req.summary ?? '');
    const outcome = req.outcome ?? ((req.tests?.failed ?? 0) > 0 ? 'failed' : 'success');
    const events = {
      files_read: req.files_read ?? [],
      files_edited: req.files_edited ?? [],
      commands: req.commands ?? [],
      tests: req.tests ?? {},
    };
    const candidates = buildCandidates({ ...req, outcome, task }, trajectoryId);

    await AppDataSource.query(
      `INSERT INTO "${orgId}_trajectory_events"
       (id, repo_id, user_id, task, outcome, summary, events, candidates, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), NOW())`,
      [trajectoryId, repos[0].id, userId, task, outcome, req.summary ?? null, JSON.stringify(events), JSON.stringify(candidates)],
    );

    return {
      id: trajectoryId,
      repo_id: repos[0].id,
      repo_name: repos[0].name,
      status: 'pending',
      candidate_count: candidates.length,
      candidates,
    };
  }

  async listCandidates(orgId: string, repoId?: string, status: 'pending' | 'resolved' | 'all' = 'pending') {
    const params: string[] = [];
    const filters: string[] = ['r.is_deleted = false'];
    if (repoId) {
      params.push(repoId);
      filters.push(`t.repo_id = $${params.length}`);
    }
    if (status !== 'all') {
      params.push(status);
      filters.push(`t.status = $${params.length}`);
    }
    const rows = await AppDataSource.query(
      `SELECT t.*, r.name as repo_name
         FROM "${orgId}_trajectory_events" t
         JOIN "${orgId}_repos" r ON r.id = t.repo_id
        WHERE ${filters.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT 50`,
      params,
    ) as TrajectoryRow[];

    return { items: rows.map(normalizeTrajectory) };
  }

  async resolveCandidate(orgId: string, userId: string, trajectoryId: string, candidateId: string, action: 'approve' | 'dismiss') {
    const rows = await AppDataSource.query(
      `SELECT t.*, r.name as repo_name
         FROM "${orgId}_trajectory_events" t
         JOIN "${orgId}_repos" r ON r.id = t.repo_id
        WHERE t.id = $1
        LIMIT 1`,
      [trajectoryId],
    ) as TrajectoryRow[];
    if (rows.length === 0) throw new NotFoundError('Trajectory not found');

    const row = normalizeTrajectory(rows[0]);
    const candidate = row.candidates.find(item => item.id === candidateId);
    if (!candidate) throw new NotFoundError('Trajectory candidate not found');
    if (candidate.status !== 'pending') throw new BadRequestError('Trajectory candidate is already resolved');

    let createdExperienceId: string | null = null;
    if (action === 'approve') {
      const result = await captureService.capture(orgId, userId, {
        repo: row.repo_name ?? '',
        title: candidate.title,
        claim: candidate.claim,
        kind: candidate.kind,
        scope: candidate.scope,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        lifecycle: { state: 'candidate', reason: 'trajectory:approved', updated_at: new Date().toISOString() },
        provenance: { source_type: 'trajectory', session: trajectoryId, author: userId },
      });
      createdExperienceId = result.id;
    }

    const nextCandidates = row.candidates.map(item => item.id === candidateId
      ? {
          ...item,
          status: action === 'approve' ? 'approved' as const : 'dismissed' as const,
          created_experience_id: createdExperienceId,
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
        }
      : item);
    const status = nextCandidates.some(item => item.status === 'pending') ? 'pending' : 'resolved';

    await AppDataSource.query(
      `UPDATE "${orgId}_trajectory_events"
          SET candidates = $1,
              status = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [JSON.stringify(nextCandidates), status, trajectoryId],
    );

    return {
      id: trajectoryId,
      candidate_id: candidateId,
      action,
      status,
      created_experience_id: createdExperienceId,
    };
  }
}

export const trajectoryService = new TrajectoryService();
