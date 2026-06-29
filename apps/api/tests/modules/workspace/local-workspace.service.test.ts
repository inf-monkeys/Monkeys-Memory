import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries: Array<{ sql: string; params?: unknown[] }> = [];

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT id, name, created_at') && sql.includes('LIMIT 1')) {
        return [{ id: 'org_local', name: 'Local Workspace', created_at: '2026-01-01T00:00:00.000Z' }];
      }
      if (sql.includes('SELECT id FROM "org_local_users" WHERE id')) {
        return [{ id: 'user_local' }];
      }
      return [];
    }),
  },
}));

const { localWorkspaceService } = await import('../../../src/modules/workspace/local-workspace.service.js');

describe('local workspace service', () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it('resolves a local owner user without hosted user tables', async () => {
    const organization = await localWorkspaceService.resolveOrganization();

    expect(organization).toEqual({
      id: 'org_local',
      name: 'Local Workspace',
      role: 'owner',
      user_id: 'user_local',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(queries.some((query) => query.sql.includes('accounts'))).toBe(false);
    expect(queries.some((query) => query.sql.includes('account_id'))).toBe(false);
  });

  it('rejects unsafe organization ids before interpolating table names', async () => {
    await expect(localWorkspaceService.resolveOrganization('org_bad;DROP')).rejects.toThrow('Invalid X-Org-Id header');
  });
});
