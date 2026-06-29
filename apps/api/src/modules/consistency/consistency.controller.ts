import type { FastifyInstance } from 'fastify';
import { getAuditQueue, getConsistencyQueue } from '../../jobs/queue.js';
import { authMiddleware, requireRole } from '../../middleware/auth.middleware.js';
import { consistencyService } from './consistency.service.js';

export async function consistencyRoutes(app: FastifyInstance) {
  app.get('/api/v1/repos/:repoId/consistency', { preHandler: [authMiddleware] }, async (req) => {
    const { repoId } = req.params as { repoId: string };
    const latest = await consistencyService.latestReport(req.auth.orgId, repoId);
    return latest ?? { repo_id: repoId, scanned: false, finding_count: 0, findings: [] };
  });

  app.post('/api/v1/repos/:repoId/consistency/scan', { preHandler: [authMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { repoId } = req.params as { repoId: string };
    const query = (req.query ?? {}) as { async?: string };
    if (query.async === 'true') {
      const job = await getConsistencyQueue().add('scan-repo', {
        orgId: req.auth.orgId,
        repoId,
      }, {
        removeOnComplete: 100,
        removeOnFail: 200,
      });

      getAuditQueue().add('audit', {
        orgId: req.auth.orgId,
        entry: {
          user_id: req.auth.userId,
          action: 'consistency.scan.queued',
          resource_type: 'repo',
          resource_id: repoId,
          metadata: { job_id: job.id },
          ip_address: req.ip,
        },
      }).catch(() => {});

      return reply.status(202).send({ queued: true, job_id: job.id, repo_id: repoId });
    }

    const report = await consistencyService.scanRepo(req.auth.orgId, repoId);

    getAuditQueue().add('audit', {
      orgId: req.auth.orgId,
      entry: {
        user_id: req.auth.userId,
        action: 'consistency.scan',
        resource_type: 'repo',
        resource_id: repoId,
        metadata: { finding_count: report.finding_count, reasons: report.findings.map(finding => finding.reason) },
        ip_address: req.ip,
      },
    }).catch(() => {});

    return reply.status(200).send(report);
  });
}
