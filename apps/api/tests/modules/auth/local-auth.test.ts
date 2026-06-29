import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries: Array<{ sql: string; params?: unknown[] }> = [];

vi.mock('../../../src/config/env.js', () => ({
  env: {
    deployment: { mode: 'local' },
    auth: { allowedOrigins: [] },
    redis: { host: 'localhost', port: 6379, password: undefined },
  },
}));

vi.mock('../../../src/modules/auth/account-audit.service.js', () => ({
  enqueueAccountAudit: vi.fn(),
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT id, name, created_at') && sql.includes('LIMIT 1')) {
        return [{ id: 'org_local', name: 'Local Workspace', created_at: '2026-01-01T00:00:00.000Z' }];
      }
      if (sql.includes('SELECT id FROM "org_local_users" WHERE account_id')) {
        return [{ id: 'user_local' }];
      }
      return [];
    }),
  },
}));

const { accountAuthMiddleware, accountRecentReauthGuard, accountWriteGuard, authMiddleware } = await import('../../../src/middleware/auth.middleware.js');

describe('local deployment auth', () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it('allows account-level requests without a bearer token', async () => {
    const req = { headers: {}, cookies: {} } as any;

    await accountAuthMiddleware(req);

    expect(req.account).toEqual({ accountId: 'acct_local' });
    await expect(accountWriteGuard(req)).resolves.toBeUndefined();
    await expect(accountRecentReauthGuard(req)).resolves.toBeUndefined();
  });

  it('injects a local owner auth context without Authorization', async () => {
    const req = { headers: {}, cookies: {} } as any;

    await authMiddleware(req);

    expect(req.account).toEqual({ accountId: 'acct_local' });
    expect(req.auth).toEqual({
      orgId: 'org_local',
      userId: 'user_local',
      role: 'owner',
      accountId: 'acct_local',
    });
  });

  it('rejects unsafe local organization ids before interpolating tenant table names', async () => {
    const req = { headers: { 'x-org-id': 'org_bad;DROP' }, cookies: {} } as any;

    await expect(authMiddleware(req)).rejects.toThrow('Invalid X-Org-Id header');
  });
});
