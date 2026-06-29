import type { FastifyInstance } from 'fastify';
import { localContextMiddleware, requireRole } from '../../middleware/local-context.middleware.js';
import { getAuditQueue } from '../../jobs/queue.js';
import { reviewService } from './review.service.js';
import type { BulkReviewAssignRequest, BulkReviewResolveRequest, ReviewAssignRequest, ReviewResolveRequest } from '../../shared/types.js';

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/api/v1/review-inbox', { preHandler: [localContextMiddleware] }, async (req) => {
    const query = req.query as { repo_id?: string };
    return reviewService.listInbox(req.workspace.orgId, query.repo_id);
  });

  app.post('/api/v1/repos/:repoId/review/:ruleId/resolve', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { repoId, ruleId } = req.params as { repoId: string; ruleId: string };
    const body = req.body as ReviewResolveRequest;
    if (!body.action) return reply.status(400).send({ error: 'action is required' });

    const result = await reviewService.resolve(req.workspace.orgId, req.workspace.userId, repoId, ruleId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'review.resolve',
        resource_type: 'compiled_rule',
        resource_id: ruleId,
        metadata: { repo_id: repoId, review_action: body.action },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(result);
  });

  app.post('/api/v1/repos/:repoId/review/bulk-resolve', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = req.body as BulkReviewResolveRequest;
    if (!body.action) return reply.status(400).send({ error: 'action is required' });
    if (!Array.isArray(body.rule_ids) || body.rule_ids.length === 0) return reply.status(400).send({ error: 'rule_ids is required' });

    const result = await reviewService.resolveBulk(req.workspace.orgId, req.workspace.userId, repoId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'review.bulk_resolve',
        resource_type: 'repo',
        resource_id: repoId,
        metadata: { review_action: body.action, rule_ids: body.rule_ids, resolved_count: result.resolved_count },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(result);
  });

  app.post('/api/v1/repos/:repoId/review/:ruleId/assign', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { repoId, ruleId } = req.params as { repoId: string; ruleId: string };
    const body = req.body as ReviewAssignRequest;
    if (!body.assigned_to) return reply.status(400).send({ error: 'assigned_to is required' });

    const result = await reviewService.assign(req.workspace.orgId, req.workspace.userId, repoId, ruleId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'review.assign',
        resource_type: 'compiled_rule',
        resource_id: ruleId,
        metadata: { repo_id: repoId, assigned_to: body.assigned_to },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(result);
  });

  app.post('/api/v1/repos/:repoId/review/bulk-assign', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const body = req.body as BulkReviewAssignRequest;
    if (!body.assigned_to) return reply.status(400).send({ error: 'assigned_to is required' });
    if (!Array.isArray(body.rule_ids) || body.rule_ids.length === 0) return reply.status(400).send({ error: 'rule_ids is required' });

    const result = await reviewService.assignBulk(req.workspace.orgId, req.workspace.userId, repoId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'review.bulk_assign',
        resource_type: 'repo',
        resource_id: repoId,
        metadata: { assigned_to: body.assigned_to, rule_ids: body.rule_ids, assigned_count: result.assigned_count },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(result);
  });
}
