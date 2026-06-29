import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/env.js', () => ({
  env: {
    deployment: { mode: 'local' },
    cors: {
      allowedOrigins: [],
      consoleBaseUrl: 'http://localhost:8080',
      apiBaseUrl: 'http://localhost:3000',
    },
    redis: { host: 'localhost', port: 6379, password: undefined },
  },
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: {
    query: vi.fn(async () => []),
  },
}));

vi.mock('../../../src/modules/workspace/local-workspace.service.js', () => ({
  localWorkspaceService: {
    listOrganizations: vi.fn(async () => [{ id: 'org_local', name: 'Local Workspace', role: 'owner', user_id: 'user_local' }]),
    resolveOrganization: vi.fn(async () => ({ id: 'org_local', name: 'Local Workspace', role: 'owner', user_id: 'user_local' })),
  },
}));

const { buildApp } = await import('../../../src/app.js');

describe('local workspace routes', () => {
  it('keeps the local workspace available', async () => {
    const app = await buildApp();

    const orgs = await app.inject({
      method: 'GET',
      url: '/api/v1/orgs',
    });

    expect(orgs.statusCode).toBe(200);
    expect(orgs.json().organizations[0]).toMatchObject({
      id: 'org_local',
      role: 'owner',
    });

    await app.close();
  });

  it('does not mount hosted browser route families', async () => {
    const app = await buildApp();

    const routes = app.printRoutes();
    expect(routes).not.toContain('/api/v1/global-admin');
    expect(routes).not.toContain('/api/v1/cli/device');
    expect(routes).not.toContain('/api/v1/auth/');

    await app.close();
  });
});
