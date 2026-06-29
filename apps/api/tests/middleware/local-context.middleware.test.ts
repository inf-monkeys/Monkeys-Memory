import { describe, expect, it, vi } from 'vitest';

const resolveOrganization = vi.fn(async () => ({
  id: 'org_local',
  name: 'Local Workspace',
  role: 'owner' as const,
  user_id: 'user_local',
}));

vi.mock('../../src/modules/workspace/local-workspace.service.js', () => ({
  localWorkspaceService: {
    resolveOrganization,
  },
}));

const { localContextMiddleware, requireRole } = await import('../../src/middleware/local-context.middleware.js');

describe('local context middleware', () => {
  it('resolves the local owner workspace without tokens', async () => {
    const req = { headers: { 'x-org-id': 'org_local' } } as any;

    await localContextMiddleware(req);

    expect(resolveOrganization).toHaveBeenCalledWith('org_local');
    expect(req.workspace).toEqual({
      orgId: 'org_local',
      userId: 'user_local',
      role: 'owner',
    });
  });

  it('allows owner-only local routes', async () => {
    const req = { workspace: { orgId: 'org_local', userId: 'user_local', role: 'owner' } } as any;

    await expect(requireRole('owner')(req, {} as any)).resolves.toBeUndefined();
  });
});
