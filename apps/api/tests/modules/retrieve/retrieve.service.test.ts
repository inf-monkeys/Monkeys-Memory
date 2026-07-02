import { beforeEach, describe, expect, it, vi } from 'vitest';
import { embedText } from '../../../src/modules/retrieve/embedding.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  search: vi.fn(),
  warn: vi.fn(),
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
      runtimeRuleLimit: 2,
      onboardingRuleLimit: 10,
      fuzzyMergeThreshold: 0.7,
      confidenceDecayStartDays: 90,
      confidenceDecayRatePerMonth: 0.02,
      confidenceDecayMax: 0.2,
    },
  },
}));

vi.mock('../../../src/shared/logger.js', () => ({
  logger: { warn: mocks.warn, info: vi.fn() },
}));

vi.mock('../../../src/modules/vector-store/qdrant-store.js', () => ({
  memoryVectorStore: { search: mocks.search },
}));

const { retrieveService } = await import('../../../src/modules/retrieve/retrieve.service.js');

function rule(id: string, claim: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'rule',
    title: claim,
    claim,
    scope: { paths: ['src/modules/**'], task_types: ['feature'] },
    confidence: 'medium',
    confidence_score: 0.5,
    source_count: 1,
    evidence_count: 1,
    updated_at: '2026-07-03T00:00:00.000Z',
    sources: [`exp_${id}`],
    ...overrides,
  };
}

describe('RetrieveService vector store integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses ready Qdrant vector indexes for semantic similarity', async () => {
    mocks.search.mockResolvedValueOnce([{ itemId: 'rule_vector', score: 0.95 }]);
    mocks.query
      .mockResolvedValueOnce([{ id: 'repo_1', name: 'monkeys-memory', allowlisted: true, metadata: {} }])
      .mockResolvedValueOnce([{
        id: 'compiled_1',
        version: 3,
        content: {
          rules: [
            rule('rule_vector', 'Use Qdrant for vector memory lookup.'),
            rule('rule_plain', 'Keep unrelated configuration simple.'),
          ],
          exceptions: [],
        },
      }])
      .mockResolvedValueOnce([{
        compiled_rule_id: 'compiled_1',
        compiled_version: 3,
        embedding_model: 'local-hash-64',
        embedding_dimensions: 64,
      }])
      .mockResolvedValueOnce([]);

    const result = await retrieveService.retrieve('org_local', {
      repo: 'monkeys-memory',
      path: 'src/modules/retrieve/retrieve.service.ts',
      task: 'feature',
    });

    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org_local',
      repoId: 'repo_1',
      compiledRuleId: 'compiled_1',
      compiledVersion: 3,
      embeddingModel: 'local-hash-64',
      embeddingDimensions: 64,
      vector: expect.any(Array),
      limit: 80,
    }));
    expect(result.rules[0].id).toBe('rule_vector');
    expect(result.rules[0].explanation.why).toContain('semantic similarity 0.95');
  });

  it('falls back to legacy compiled JSON vectors when Qdrant is unavailable', async () => {
    mocks.search.mockRejectedValueOnce(new Error('qdrant unavailable'));
    mocks.query
      .mockResolvedValueOnce([{ id: 'repo_1', name: 'monkeys-memory', allowlisted: true, metadata: {} }])
      .mockResolvedValueOnce([{
        id: 'compiled_1',
        version: 3,
        content: {
          rules: [
            rule('rule_legacy', 'Use legacy JSON vector fallback.', {
              embedding: embedText('monkeys-memory src/modules/retrieve/retrieve.service.ts feature'),
              embedding_model: 'local-hash-64',
            }),
          ],
          exceptions: [],
          vector_index: {
            version: 1,
            provider: 'local-hash',
            dimensions: 64,
            items: [{
              id: 'rule_legacy',
              kind: 'rule',
              claim: 'Use legacy JSON vector fallback.',
              embedding_model: 'local-hash-64',
              embedding: embedText('monkeys-memory src/modules/retrieve/retrieve.service.ts feature'),
            }],
          },
        },
      }])
      .mockResolvedValueOnce([{
        compiled_rule_id: 'compiled_1',
        compiled_version: 3,
        embedding_model: 'local-hash-64',
        embedding_dimensions: 64,
      }])
      .mockResolvedValueOnce([]);

    const result = await retrieveService.retrieve('org_local', {
      repo: 'monkeys-memory',
      path: 'src/modules/retrieve/retrieve.service.ts',
      task: 'feature',
    });

    expect(mocks.warn).toHaveBeenCalledWith(
      'Qdrant vector search failed; falling back to compiled JSON vectors when available',
      expect.objectContaining({ orgId: 'org_local', repoId: 'repo_1' }),
    );
    expect(result.rules[0].id).toBe('rule_legacy');
    expect(result.rules[0].explanation.why.some((reason: string) => reason.includes('semantic similarity'))).toBe(true);
  });
});
