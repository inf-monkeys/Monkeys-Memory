import { describe, expect, it, vi } from 'vitest';

const resolveOrganization = vi.fn(async () => ({
  id: 'org_local',
  name: 'Local Workspace',
  role: 'owner' as const,
  user_id: 'user_local',
}));
const ensureDefaultOrganization = vi.fn(async () => ({
  id: 'org_local',
  name: 'Local Workspace',
  role: 'owner' as const,
  user_id: 'user_local',
}));

vi.mock('../../src/modules/auth/local-auth.service.js', () => ({
  LOCAL_ACCOUNT_ID: 'acct_local',
  localAuthService: {
    ensureDefaultOrganization,
    resolveOrganization,
  },
}));

const {
  accountAuthMiddleware,
  accountRecentReauthGuard,
  accountWriteGuard,
  authMiddleware,
} = await import('../../src/middleware/auth.middleware.js');

describe('local auth middleware', () => {
  it('does not require an authorization token for local account context', async () => {
    const req = { headers: {}, cookies: {} } as any;

    await accountAuthMiddleware(req);

    expect(ensureDefaultOrganization).toHaveBeenCalled();
    expect(req.account).toEqual({ accountId: 'acct_local' });
  });

  it('does not require CSRF or recent reauth for local writes', async () => {
    const req = { headers: {}, cookies: {}, account: { accountId: 'acct_local' } } as any;

    await expect(accountWriteGuard(req)).resolves.toBeUndefined();
    await expect(accountRecentReauthGuard(req)).resolves.toBeUndefined();
  });

  it('resolves owner auth context without a bearer token', async () => {
    const req = { headers: { 'x-org-id': 'org_local' }, cookies: {} } as any;

    await authMiddleware(req);

    expect(resolveOrganization).toHaveBeenCalledWith('org_local');
    expect(req.account).toEqual({ accountId: 'acct_local' });
    expect(req.auth).toEqual({
      orgId: 'org_local',
      userId: 'user_local',
      role: 'owner',
      accountId: 'acct_local',
    });
  });
});
