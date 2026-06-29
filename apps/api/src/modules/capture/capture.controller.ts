import type { FastifyInstance } from 'fastify';
import { localContextMiddleware } from '../../middleware/local-context.middleware.js';
import { captureService } from './capture.service.js';
import { getAuditQueue } from '../../jobs/queue.js';
import type { CaptureRequest, EvidenceItem } from '../../shared/types.js';
import { agentActionsService } from '../agent-actions/agent-actions.service.js';

export async function captureRoutes(app: FastifyInstance) {
  app.post('/api/v1/capture', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const body = req.body as CaptureRequest;
    const missingFields: string[] = [];
    if (!body.repo) missingFields.push('repo');
    if (!body.title) missingFields.push('title');
    if (!body.claim) missingFields.push('claim');
    if (!Array.isArray(body.scope?.paths) || body.scope.paths.length === 0) missingFields.push('scope.paths');

    if (missingFields.length > 0) {
      return reply.status(400).send({
        error: 'repo, title, claim, and scope.paths are required',
        missing_fields: missingFields,
      });
    }

    const result = await captureService.capture(req.workspace.orgId, req.workspace.userId, body);

    // Async audit
    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'capture',
        resource_type: 'experience',
        resource_id: result.id,
        metadata: { repo: body.repo, title: body.title },
        ip_address: req.ip,
      },
    }).catch(() => {});

    const agentActions = await agentActionsService.maybeLeaseActions(req.workspace.orgId, body.repo, req.workspace.userId, body.agent_capabilities);
    return reply.status(201).send({ ...result, agent_actions: agentActions });
  });

  app.post('/api/v1/capture/auto', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const body = req.body as { repo: string; commit_message: string; changed_files: string[]; diff_summary?: string };
    if (!body.repo || !body.commit_message || !body.changed_files) {
      return reply.status(400).send({ error: 'repo, commit_message, and changed_files are required' });
    }

    const result = await captureService.autoCapture(req.workspace.orgId, req.workspace.userId, body);

    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'capture',
        resource_type: 'experience',
        resource_id: result.id,
        metadata: { repo: body.repo, auto: true },
        ip_address: req.ip,
      },
    }).catch(() => {});

    const agentActions = await agentActionsService.maybeLeaseActions(req.workspace.orgId, body.repo, req.workspace.userId, undefined);
    return reply.status(201).send({ ...result, confidence: 0.5, agent_actions: agentActions });
  });
}
