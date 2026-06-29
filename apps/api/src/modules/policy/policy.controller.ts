import type { FastifyInstance } from 'fastify';
import { localContextMiddleware, requireRole } from '../../middleware/local-context.middleware.js';
import { getAuditQueue } from '../../jobs/queue.js';
import { policyService } from './policy.service.js';
import type { RetrieveRequest } from '../../shared/types.js';

export async function policyRoutes(app: FastifyInstance) {
  app.get('/api/v1/policy/overview', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req) => {
    return policyService.overview(req.workspace.orgId);
  });

  app.post('/api/v1/policy/simulate-retrieve', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const body = req.body as RetrieveRequest;
    if (!body.repo) return reply.status(400).send({ error: 'repo is required' });

    const simulateRequest: RetrieveRequest = { ...body, user_id: body.user_id ?? req.workspace.userId };
    const result = await policyService.simulateRetrieve(req.workspace.orgId, simulateRequest);
    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'policy.simulate',
        resource_type: 'repo',
        resource_id: body.repo,
        metadata: { path: body.path, task: body.task, branch: body.branch, tag: body.tag, commit: body.commit, user_id: simulateRequest.user_id, team_id: body.team_id, template_id: body.template_id, include_sensitive: body.include_sensitive, hidden: result.summary.hidden },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(result);
  });
}
