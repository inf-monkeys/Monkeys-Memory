import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  localContextMiddleware: vi.fn(),
  retrieve: vi.fn(),
  maybeLeaseActions: vi.fn(),
  add: vi.fn(),
}));

vi.mock('../../../src/middleware/local-context.middleware.js', () => ({
  localContextMiddleware: mocks.localContextMiddleware,
}));

vi.mock('../../../src/modules/retrieve/retrieve.service.js', () => ({
  retrieveService: { retrieve: mocks.retrieve },
}));

vi.mock('../../../src/modules/agent-actions/agent-actions.service.js', () => ({
  agentActionsService: { maybeLeaseActions: mocks.maybeLeaseActions },
}));

vi.mock('../../../src/jobs/queue.js', () => ({
  getAuditQueue: vi.fn(() => ({ add: mocks.add })),
}));

const { retrieveRoutes } = await import('../../../src/modules/retrieve/retrieve.controller.js');

function appMock() {
  const routes: Array<{ method: string; path: string; handler: Function }> = [];
  return {
    app: {
      post: (path: string, _opts: unknown, handler: Function) => routes.push({ method: 'POST', path, handler }),
    },
    routes,
  };
}

describe('retrieveRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.maybeLeaseActions.mockResolvedValue([]);
    mocks.add.mockResolvedValue(undefined);
  });

  it('audits all returned memory items, not just rules', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(145);
    mocks.retrieve.mockResolvedValue({
      rules: [{ id: 'rule_1' }],
      exceptions: [{ id: 'exception_1' }],
      org_rules: [{ id: 'org_rule_1' }],
    });

    const { app, routes } = appMock();
    await retrieveRoutes(app as never);
    const route = routes.find(item => item.path === '/api/v1/retrieve')!;

    const result = await route.handler({
      body: { repo: 'monkeys-memory', path: 'src/main.ts', task: 'feature' },
      workspace: { orgId: 'org_local', userId: 'user_local' },
      ip: '127.0.0.1',
    }, {});

    expect(result).toEqual({
      rules: [{ id: 'rule_1' }],
      exceptions: [{ id: 'exception_1' }],
      org_rules: [{ id: 'org_rule_1' }],
      agent_actions: [],
    });
    expect(mocks.add).toHaveBeenCalledWith('audit', {
      orgId: 'org_local',
      entry: expect.objectContaining({
        action: 'retrieve',
        metadata: expect.objectContaining({
          path: 'src/main.ts',
          task: 'feature',
          result_count: 3,
          latency_ms: 45,
        }),
      }),
    });
  });
});
