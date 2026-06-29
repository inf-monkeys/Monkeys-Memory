import type { FastifyInstance } from 'fastify';
import { localContextMiddleware, requireRole } from '../../middleware/local-context.middleware.js';
import { getAuditQueue } from '../../jobs/queue.js';
import { trajectoryService } from './trajectory.service.js';
import type { AgentTrajectoryRequest } from '../../shared/types.js';

export async function trajectoryRoutes(app: FastifyInstance) {
  app.post('/api/v1/trajectories', { preHandler: [localContextMiddleware] }, async (req, reply) => {
    const body = req.body as AgentTrajectoryRequest;
    if (!body.repo) return reply.status(400).send({ error: 'repo is required' });

    const result = await trajectoryService.ingest(req.workspace.orgId, req.workspace.userId, body);
    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'trajectory.ingest',
        resource_type: 'trajectory',
        resource_id: result.id,
        metadata: { repo: body.repo, candidate_count: result.candidate_count, outcome: body.outcome },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(201).send(result);
  });

  app.get('/api/v1/trajectory-candidates', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req) => {
    const query = req.query as { repo_id?: string; status?: 'pending' | 'resolved' | 'all' };
    const status = ['pending', 'resolved', 'all'].includes(query.status ?? '') ? query.status : 'pending';
    return trajectoryService.listCandidates(req.workspace.orgId, query.repo_id, status);
  });

  app.post('/api/v1/trajectories/:trajectoryId/candidates/:candidateId/resolve', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { trajectoryId, candidateId } = req.params as { trajectoryId: string; candidateId: string };
    const body = req.body as { action?: 'approve' | 'dismiss' };
    if (body.action !== 'approve' && body.action !== 'dismiss') {
      return reply.status(400).send({ error: 'action must be approve or dismiss' });
    }

    const result = await trajectoryService.resolveCandidate(req.workspace.orgId, req.workspace.userId, trajectoryId, candidateId, body.action);
    getAuditQueue().add('audit', {
      orgId: req.workspace.orgId,
      entry: {
        user_id: req.workspace.userId,
        action: 'trajectory.resolve',
        resource_type: 'trajectory',
        resource_id: trajectoryId,
        metadata: { candidate_id: candidateId, action: body.action, created_experience_id: result.created_experience_id },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(result);
  });
}
