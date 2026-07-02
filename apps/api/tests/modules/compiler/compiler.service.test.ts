import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  upsertCompiledVectors: vi.fn(),
}));

vi.mock('../../../src/database/ormconfig.js', () => ({
  AppDataSource: { query: mocks.query },
}));

vi.mock('../../../src/config/env.js', () => ({
  env: {
    embeddings: {
      enabled: true,
      provider: 'local-hash',
      dimensions: 64,
    },
    vectorStore: {
      searchLimit: 80,
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
  logger: { info: mocks.info, warn: mocks.warn },
}));

vi.mock('../../../src/modules/vector-store/qdrant-store.js', () => ({
  memoryVectorStore: { upsertCompiledVectors: mocks.upsertCompiledVectors },
}));

const { CompilerService } = await import('../../../src/modules/compiler/compiler.service.js');

describe('CompilerService retired memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.upsertCompiledVectors.mockResolvedValue({ collection: 'monkeys_memory_items_local_hash_64_64_v1', pointCount: 0 });
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
    const rulePack = JSON.parse(insertArgs![1][2]);
    expect(rulePack.rules).toEqual([]);
    expect(rulePack.review_queue.items).toEqual([]);
    expect(rulePack.source_experience_count).toBe(0);
  });

  it('stores compiled memory vectors in Qdrant and records a ready vector manifest', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    mocks.upsertCompiledVectors.mockResolvedValueOnce({
      collection: 'monkeys_memory_items_local_hash_64_64_v1',
      pointCount: 1,
    });
    mocks.query
      .mockResolvedValueOnce([{ compile_config: {} }])
      .mockResolvedValueOnce([{ name: 'monkeys-memory', last_compiled_at: null, metadata: {} }])
      .mockResolvedValueOnce([
        {
          id: 'exp_1',
          repo_id: 'repo_1',
          author_id: 'user_local',
          title: 'Qdrant vectors',
          claim: 'Store memory embeddings in Qdrant instead of compiled JSON.',
          kind: 'rule',
          scope: { paths: ['src/modules/retrieve/**'], task_types: ['feature'], entities: ['class:RetrieveService'] },
          evidence: [{ type: 'test', ref: 'qdrant-store.test.ts' }],
          confidence: 0.8,
          status: 'active',
          source_type: 'manual',
          content_hash: 'hash_1',
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ next: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const service = new CompilerService();
    await service.compileRepo('org_local', 'repo_1');

    expect(mocks.upsertCompiledVectors).toHaveBeenCalledWith([
      expect.objectContaining({
        orgId: 'org_local',
        repoId: 'repo_1',
        compiledVersion: 4,
        itemKind: 'rule',
        itemId: expect.stringContaining('qdrant-vectors'),
        embeddingProvider: 'local-hash',
        embeddingModel: 'local-hash-64',
        embeddingDimensions: 64,
        embedding: expect.any(Array),
        paths: ['src/modules/retrieve/**'],
        taskTypes: ['feature'],
        entities: ['class:RetrieveService'],
      }),
    ]);
    expect(mocks.upsertCompiledVectors.mock.calls[0][0][0].compiledRuleId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(mocks.query.mock.calls.some(([sql, params]) =>
      String(sql).includes('INSERT INTO "org_local_vector_indexes"') &&
      params[3] === 'qdrant' &&
      params[5] === 'local-hash' &&
      params[6] === 'local-hash-64' &&
      params[9] === 'ready',
    )).toBe(true);
    expect(mocks.query.mock.calls.some(([sql]) =>
      String(sql).includes('UPDATE "org_local_compiled_rules"') &&
      String(sql).includes("jsonb_set(content, '{vector_index}'"),
    )).toBe(true);
  });
});
