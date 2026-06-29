import type { FastifyInstance } from 'fastify';
import { localContextMiddleware } from '../../middleware/local-context.middleware.js';
import { getAuditQueue } from '../../jobs/queue.js';
import { feedbackService } from './feedback.service.js';
import type { AgentMemoryEvaluationRequest, FeedbackRequest } from '../../shared/types.js';

export async function feedbackRoutes(app: FastifyInstance) {
  app.post('/api/v1/repos/:repoId/compiled/:ruleId/feedback', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const { repoId, ruleId } = req.params as { repoId: string; ruleId: string };
    const body = req.body as FeedbackRequest;
    if (!body.outcome) return reply.status(400).send({ error: 'outcome is required' });

    const result = await feedbackService.addFeedback(req.workspace.orgId, req.workspace.userId, repoId, ruleId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'feedback',
        resource_type: 'compiled_rule',
        resource_id: ruleId,
        metadata: { repo_id: repoId, outcome: body.outcome },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(201).send(result);
  });

  app.post('/api/v1/agent/memory-evaluations', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const body = req.body as AgentMemoryEvaluationRequest;
    if (!body.repo) return reply.status(400).send({ error: 'repo is required' });
    if (!Array.isArray(body.evaluations) || body.evaluations.length === 0) {
      return reply.status(400).send({ error: 'evaluations is required' });
    }

    const result = await feedbackService.addAgentEvaluation(req.workspace.orgId, req.workspace.userId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'agent.memory_evaluate',
        resource_type: 'repo',
        resource_id: body.repo,
        metadata: {
          repo_id: result.repo_id,
          recorded_count: result.recorded_count,
          task_outcome: body.task?.outcome ?? null,
          tests_passed: body.task?.tests_passed ?? null,
          build_passed: body.task?.build_passed ?? null,
          lint_passed: body.task?.lint_passed ?? null,
        },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(201).send(result);
  });
}
