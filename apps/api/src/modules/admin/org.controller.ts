import type { FastifyInstance } from 'fastify';
import { accountAuthMiddleware, authMiddleware, requireRole } from '../../middleware/auth.middleware.js';
import { AppDataSource } from '../../database/ormconfig.js';
import { localAuthService } from '../auth/local-auth.service.js';

const PLUGIN_KINDS = new Set(['quality', 'semantic', 'policy', 'export', 'custom']);

function normalizeCompileConfig(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };
  if (Array.isArray(input.plugins)) {
    normalized.plugins = input.plugins
      .filter((plugin): plugin is Record<string, unknown> => Boolean(plugin) && typeof plugin === 'object')
      .map((plugin) => ({
        id: typeof plugin.id === 'string' && plugin.id.trim() ? plugin.id.trim() : 'custom',
        enabled: plugin.enabled !== false,
        kind: PLUGIN_KINDS.has(String(plugin.kind)) ? plugin.kind : 'custom',
        mode: plugin.mode === 'webhook' ? 'webhook' : 'managed',
        endpoint: typeof plugin.endpoint === 'string' && plugin.endpoint.trim() ? plugin.endpoint.trim() : null,
      }))
      .slice(0, 12);
  }
  return normalized;
}

export async function orgRoutes(app: FastifyInstance) {
  app.get('/api/v1/orgs', { preHandler: [accountAuthMiddleware] }, async () => {
    return { organizations: await localAuthService.listOrganizations() };
  });

  app.post('/api/v1/orgs', { preHandler: [accountAuthMiddleware] }, async (req, reply) => {
    const body = req.body as { name: string };
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name is required' });

    const result = await localAuthService.createOrganization(body.name);
    return reply.status(201).send(result);
  });

  // Get org info
  app.get('/api/v1/admin/orgs/:orgId', { preHandler: [authMiddleware] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.auth.orgId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    const rows = await AppDataSource.query(
      `SELECT id, name, plan, status, max_repos, max_members, max_experiences, compile_config, created_at FROM orgs WHERE id = $1`,
      [orgId],
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Org not found' });
    return rows[0];
  });

  // Update org settings
  app.patch('/api/v1/admin/orgs/:orgId', { preHandler: [authMiddleware, requireRole('owner')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.auth.orgId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    const body = req.body as { name?: string; compile_config?: Record<string, unknown> };
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return reply.status(400).send({ error: 'name is required' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }

    if (body.compile_config) {
      params.push(JSON.stringify(normalizeCompileConfig(body.compile_config)));
      sets.push(`compile_config = $${params.length}`);
    }

    if (params.length === 0) {
      return reply.status(400).send({ error: 'Nothing to update' });
    }

    params.push(orgId);
    await AppDataSource.query(
      `UPDATE orgs SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    return { success: true };
  });

  app.delete('/api/v1/admin/orgs/:orgId', { preHandler: [authMiddleware, requireRole('owner')] }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.auth.orgId !== orgId) return reply.status(403).send({ error: 'Forbidden' });

    const body = (req.body ?? {}) as { confirm_name?: string };
    const rows = await AppDataSource.query(
      `SELECT name FROM orgs WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [orgId],
    ) as Array<{ name: string }>;

    if (rows.length === 0) return reply.status(404).send({ error: 'Org not found' });
    if (!body.confirm_name?.trim()) return reply.status(400).send({ error: 'confirm_name is required' });
    if (body.confirm_name.trim() !== rows[0].name) {
      return reply.status(400).send({ error: 'Organization name confirmation does not match' });
    }

    await AppDataSource.query(
      `UPDATE orgs SET is_deleted = true, status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [orgId],
    );

    return { success: true };
  });
}
