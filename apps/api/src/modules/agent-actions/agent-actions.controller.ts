import type { FastifyInstance } from 'fastify';
import { getAuditQueue } from '../../jobs/queue.js';
import { localContextMiddleware } from '../../middleware/local-context.middleware.js';
import type { AgentActionResultRequest } from '../../shared/types.js';
import { agentActionsService } from './agent-actions.service.js';

export async function agentActionRoutes(app: FastifyInstance) {
  app.post('/api/v1/agent-actions/:actionId/result', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const { actionId } = req.params as { actionId: string };
    const body = (req.body ?? {}) as AgentActionResultRequest;
    if (body.status !== 'completed' && body.status !== 'failed') {
      return reply.status(400).send({ error: 'status must be completed or failed' });
    }

    const result = await agentActionsService.recordResult(req.workspace.orgId, req.workspace.userId, actionId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'agent_action.result',
        resource_type: 'agent_action',
        resource_id: actionId,
        metadata: { status: result.status, repo_id: result.repo_id },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return result;
  });
}
