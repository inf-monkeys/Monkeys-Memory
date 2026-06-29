import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/env.js', () => ({
  env: {
    deployment: { mode: 'local' },
    auth: {
      allowedOrigins: [],
      webBaseUrl: 'http://localhost:8080',
    },
    redis: { host: 'localhost', port: 6379, password: undefined },
  },
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: {
    query: vi.fn(async () => []),
  },
}));

vi.mock('../../../src/modules/auth/local-auth.service.js', () => ({
  LOCAL_ACCOUNT_ID: 'acct_local',
  localAuthService: {
    ensureDefaultOrganization: vi.fn(async () => ({ id: 'org_local', name: 'Local Workspace', role: 'owner', user_id: 'user_local' })),
    listOrganizations: vi.fn(async () => [{ id: 'org_local', name: 'Local Workspace', role: 'owner', user_id: 'user_local' }]),
  },
}));

const { buildApp } = await import('../../../src/app.js');

describe('local auth routes', () => {
  it('does not mount account or global-admin login surfaces', async () => {
    const app = await buildApp();

    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'User', email: 'user@example.com', password: 'password123' },
    });
    expect(register.statusCode).toBe(404);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'user@example.com', password: 'password123' },
    });
    expect(login.statusCode).toBe(404);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    expect(me.statusCode).toBe(404);

    const globalAdminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/global-admin/login',
      payload: { username: 'admin', password: 'password123' },
    });
    expect(globalAdminLogin.statusCode).toBe(404);

    await app.close();
  });

  it('keeps local organization available without user login', async () => {
    const app = await buildApp();

    const orgs = await app.inject({
      method: 'GET',
      url: '/api/v1/orgs',
    });

    expect(orgs.statusCode).toBe(200);
    expect(orgs.json().organizations[0].role).toBe('owner');

    const cliDeviceStart = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/device/start',
      payload: { device_name: 'test-cli' },
    });
    expect(cliDeviceStart.statusCode).toBe(404);

    await app.close();
  });
});
