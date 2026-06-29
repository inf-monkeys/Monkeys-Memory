import type { FastifyInstance } from 'fastify';
import { localContextMiddleware, requireRole } from '../../middleware/local-context.middleware.js';
import { AppDataSource } from '../../database/ormconfig.js';
import { generateId, normalizeEmail } from '../../shared/utils.js';

export async function memberRoutes(app: FastifyInstance) {
  // List members (with experience count)
  app.get('/api/v1/members', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req) => {
    const orgId = req.workspace.orgId;
    const rows = await AppDataSource.query(
      `SELECT u.id, u.email, u.name, u.role, u.created_at,
              COALESCE(e.cnt, 0)::int AS experience_count
       FROM "${orgId}_users" u
       LEFT JOIN (
         SELECT author_id, COUNT(*) AS cnt
         FROM "${orgId}_experiences"
         WHERE status = 'active'
         GROUP BY author_id
       ) e ON e.author_id = u.id
       WHERE u.is_deleted = false`,
    );
    return { members: rows };
  });

  // Add a local member by email.
  app.post('/api/v1/members', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const body = req.body as { email: string; name?: string; role?: string };
    if (!body.email) return reply.status(400).send({ error: 'email is required' });

    const email = normalizeEmail(body.email);
    const existing = await AppDataSource.query(
      `SELECT id FROM "${req.workspace.orgId}_users" WHERE email = $1 AND is_deleted = false LIMIT 1`,
      [email],
    );
    if (existing.length > 0) return reply.status(409).send({ error: 'This email is already in the organization' });

    const role = body.role === 'admin' ? 'admin' : 'member';
    const name = body.name?.trim() || email.split('@')[0];
    const userId = generateId('user');
    await AppDataSource.query(
      `INSERT INTO "${req.workspace.orgId}_users" (id, email, name, role)
       VALUES ($1, $2, $3, $4)`,
      [userId, email, name, role],
    );

    return reply.status(201).send({ user_id: userId, email, name, role });
  });

  // Delete member (soft)
  app.delete('/api/v1/members/:userId', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const orgId = req.workspace.orgId;

    if (userId === req.workspace.userId) {
      return reply.status(400).send({ error: 'Cannot remove yourself' });
    }

    const target = await AppDataSource.query(
      `SELECT role FROM "${orgId}_users" WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [userId],
    );
    if (target.length === 0) return reply.status(404).send({ error: 'Member not found' });
    if (target[0].role === 'owner') return reply.status(403).send({ error: 'Cannot remove the owner' });

    await AppDataSource.query(
      `UPDATE "${orgId}_users" SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    return { success: true };
  });

  // Update member role
  app.patch('/api/v1/members/:userId/role', { preHandler: [localContextMiddleware, requireRole('owner', 'admin')] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = req.body as { role: string };
    const orgId = req.workspace.orgId;

    if (!body.role || !['admin', 'member'].includes(body.role)) {
      return reply.status(400).send({ error: 'role must be "admin" or "member"' });
    }

    if (userId === req.workspace.userId) {
      return reply.status(400).send({ error: 'Cannot change your own role' });
    }

    const target = await AppDataSource.query(
      `SELECT role FROM "${orgId}_users" WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [userId],
    );
    if (target.length === 0) return reply.status(404).send({ error: 'Member not found' });
    if (target[0].role === 'owner') return reply.status(403).send({ error: 'Cannot change the owner role' });

    await AppDataSource.query(
      `UPDATE "${orgId}_users" SET role = $1, updated_at = NOW() WHERE id = $2`,
      [body.role, userId],
    );

    return { success: true, role: body.role };
  });
}
