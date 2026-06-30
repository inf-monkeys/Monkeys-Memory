import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: { query: mocks.query },
}));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    embeddings: {
      enabled: false,
      provider: 'local-hash',
      dimensions: 64,
    },
    defaultCompileConfig: {
      runtimeRuleLimit: 5,
      onboardingRuleLimit: 10,
      fuzzyMergeThreshold: 0.7,
      confidenceDecayStartDays: 90,
      confidenceDecayRatePerMonth: 0.02,
      confidenceDecayMax: 0.2,
    },
  },
}));

vi.mock('../../../src/shared/logger.js', () => ({
  logger: { info: mocks.info },
}));

const { CompilerService } = await import('../../../src/modules/compiler/compiler.service.js');

describe('CompilerService retired memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('removes outdated feedback sources from the runtime rule pack during compile', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));
    mocks.query
      .mockResolvedValueOnce([{ compile_config: {} }])
      .mockResolvedValueOnce([{ name: 'monkeys-memory', last_compiled_at: '2026-03-01T00:00:00.000Z' }])
      .mockResolvedValueOnce([
        {
          id: 'exp_1',
          repo_id: 'repo_1',
          author_id: 'user_local',
          title: 'Adapter validation',
          claim: 'Always validate adapter before process',
          kind: 'rule',
          scope: { paths: ['src/adapter/**'], task_types: ['fix'] },
          evidence: [],
          confidence: 0.8,
          status: 'active',
          source_type: 'manual',
          content_hash: 'hash_1',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          outcome: 'outdated',
          source_experience_ids: ['exp_1'],
          created_at: '2026-03-28T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([{ next: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const service = new CompilerService();
    await service.compileRepo('org_local', 'repo_1');

    const insertArgs = mocks.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO "org_local_compiled_rules"'));
    const rulePack = JSON.parse(insertArgs![1][1]);
    expect(rulePack.rules).toEqual([]);
    expect(rulePack.review_queue.items).toEqual([]);
    expect(rulePack.source_experience_count).toBe(0);
  });
});
