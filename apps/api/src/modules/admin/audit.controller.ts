import type { FastifyInstance } from 'fastify';
import { localContextMiddleware, requireRole } from '../../middleware/local-context.middleware.js';
import { AppDataSource } from '../../database/ormconfig.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/v1/audit-logs', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req) => {
    const query = req.query as { user_id?: string; action?: string; start_time?: string; end_time?: string; limit?: string; offset?: string };
    const limit = parseInt(query.limit ?? '50');
    const offset = parseInt(query.offset ?? '0');

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (query.user_id) { where += ` AND a.user_id = $${params.length + 1}`; params.push(query.user_id); }
    if (query.action) { where += ` AND a.action = $${params.length + 1}`; params.push(query.action); }
    if (query.start_time) { where += ` AND a.created_at >= $${params.length + 1}`; params.push(query.start_time); }
    if (query.end_time) { where += ` AND a.created_at <= $${params.length + 1}`; params.push(query.end_time); }

    const orgId = req.workspace.orgId;
    const rows = await AppDataSource.query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM "${orgId}_audit_logs" a
       LEFT JOIN "${orgId}_users" u ON u.id = a.user_id
       ${where} ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return { logs: rows, limit, offset };
  });
}
