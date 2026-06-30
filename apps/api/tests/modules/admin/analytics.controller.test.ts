import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  localContextMiddleware: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
  query: vi.fn(),
}));

vi.mock('../../../src/middleware/local-context.middleware.js', () => ({
  localContextMiddleware: mocks.localContextMiddleware,
  requireRole: mocks.requireRole,
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: { query: mocks.query },
}));

const { analyticsRoutes } = await import('../../../src/modules/admin/analytics.controller.js');

function appMock() {
  const routes: Array<{ method: string; path: string; handler: Function }> = [];
  return {
    app: {
      get: (path: string, _opts: unknown, handler: Function) => routes.push({ method: 'GET', path, handler }),
    },
    routes,
  };
}

describe('analyticsRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports deterministic agent effectiveness from memory-evaluate events', async () => {
    mocks.query
      .mockResolvedValueOnce([{ count: '7' }])
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([{ metric_type: 'retrievals', total: '4' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ outcome: 'helpful', count: '1' }])
      .mockResolvedValueOnce([
        {
          outcome: 'helpful',
          metadata: {
            source: 'agent',
            adopted: true,
            evidence: ['npm test passed'],
            task: { outcome: 'success', tests_passed: true },
          },
        },
        {
          outcome: 'outdated',
          metadata: JSON.stringify({
            source: 'agent',
            adopted: false,
            correction: { experience_id: 'exp_new' },
            task: { outcome: 'success', build_passed: true },
          }),
        },
        {
          outcome: 'not-relevant',
          metadata: {
            source: 'agent',
            adopted: false,
            task: { outcome: 'partial' },
          },
        },
      ])
      .mockResolvedValueOnce([{ returned_memory_count: '9' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ redacted: '0', secret_adjacent: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { app, routes } = appMock();
    await analyticsRoutes(app as never);
    const route = routes.find(item => item.path === '/api/v1/analytics/overview')!;

    const result = await route.handler({ workspace: { orgId: 'org_local' } });

    expect(result.impact.agent_effectiveness).toMatchObject({
      score: 43,
      grade: 'emerging',
      data_source: 'agent_memory_evaluations',
      returned_memory_count: 9,
      evaluated_memory_count: 3,
      helpful_count: 1,
      outdated_count: 1,
      not_relevant_count: 1,
      adopted_count: 1,
      correction_count: 1,
      evidence_backed_count: 1,
      task_success_count: 2,
      verified_success_count: 2,
      useful_rate: 0.33,
      adoption_rate: 0.33,
      verified_success_rate: 0.67,
      evaluation_coverage_rate: 0.33,
    });
  });
});
