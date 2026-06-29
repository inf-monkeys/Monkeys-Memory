import type { FastifyInstance } from 'fastify';
import { localContextMiddleware } from '../../middleware/local-context.middleware.js';
import { retrieveService } from './retrieve.service.js';
import { getAuditQueue } from '../../jobs/queue.js';
import type { RetrieveRequest } from '../../shared/types.js';
import { agentActionsService } from '../agent-actions/agent-actions.service.js';

export async function retrieveRoutes(app: FastifyInstance) {
  app.post('/api/v1/retrieve', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const body = req.body as RetrieveRequest;
    if (!body.repo) return reply.status(400).send({ error: 'repo is required' });
    const retrieveRequest: RetrieveRequest = { ...body, user_id: body.user_id ?? req.workspace.userId };

    const start = Date.now();
    const result = await retrieveService.retrieve(req.workspace.orgId, retrieveRequest);
    const agentActions = await agentActionsService.maybeLeaseActions(req.workspace.orgId, body.repo, req.workspace.userId, body.agent_capabilities);
    const latency = Date.now() - start;

    // Async audit
    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'retrieve',
        resource_type: 'repo',
        resource_id: body.repo,
        metadata: { path: body.path, task: body.task, branch: body.branch, tag: body.tag, commit: body.commit, user_id: retrieveRequest.user_id, team_id: body.team_id, template_id: body.template_id, include_sensitive: body.include_sensitive, result_count: result.rules.length, latency_ms: latency },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return { ...result, agent_actions: agentActions };
  });
}
