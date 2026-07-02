import { afterEach, describe, expect, it, vi } from 'vitest';
import { QdrantMemoryVectorStore, type MemoryVectorRecord } from '../../../src/modules/vector-store/qdrant-store.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRecord(overrides: Partial<MemoryVectorRecord> = {}): MemoryVectorRecord {
  return {
    orgId: 'org_local',
    repoId: 'repo_1',
    compiledRuleId: 'compiled_1',
    compiledVersion: 7,
    itemId: 'rule_1',
    itemKind: 'rule',
    embeddingProvider: 'openai-compatible',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 3,
    embedding: [0.1, 0.2, 0.3],
    contentHash: 'hash_1',
    claim: 'Use the Qdrant vector store.',
    paths: ['src/**'],
    taskTypes: ['feature'],
    entities: ['class:RetrieveService'],
    policy: { visibility: 'repo', sensitivity: 'normal' },
    validity: { branches: ['main'], tags: ['v1.0.0'] },
    generatedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('QdrantMemoryVectorStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a model-specific collection and upserts memory points with payload filters', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: { error: 'not found' } }, 404))
      .mockImplementation(() => Promise.resolve(jsonResponse({ result: true })));
    vi.stubGlobal('fetch', fetchMock);

    const store = new QdrantMemoryVectorStore({
      enabled: true,
      provider: 'qdrant',
      url: 'https://qdrant.internal/',
      apiKey: 'qdrant_key',
      collectionPrefix: 'monkeys_memory_items',
      timeoutMs: 5000,
      searchLimit: 80,
    });

    await expect(store.upsertCompiledVectors([makeRecord()])).resolves.toEqual({
      collection: 'monkeys_memory_items_text_embedding_3_small_3_v1',
      pointCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qdrant.internal/collections/monkeys_memory_items_text_embedding_3_small_3_v1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://qdrant.internal/collections/monkeys_memory_items_text_embedding_3_small_3_v1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ vectors: { size: 3, distance: 'Cosine' } }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://qdrant.internal/collections/monkeys_memory_items_text_embedding_3_small_3_v1/points?wait=true',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'api-key': 'qdrant_key' }),
      }),
    );
    const upsertCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/points?wait=true'))!;
    const upsertBody = JSON.parse(upsertCall[1].body);
    expect(upsertBody.points[0]).toMatchObject({
      vector: [0.1, 0.2, 0.3],
      payload: {
        org_id: 'org_local',
        repo_id: 'repo_1',
        compiled_rule_id: 'compiled_1',
        compiled_version: 7,
        item_id: 'rule_1',
        item_kind: 'rule',
        embedding_model: 'text-embedding-3-small',
        embedding_dimensions: 3,
        is_deleted: false,
      },
    });
  });

  it('searches a collection using tenant, repo, version, and model filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      result: [
        { score: 0.91, payload: { item_id: 'rule_1' } },
        { score: 0, payload: { item_id: 'rule_2' } },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const store = new QdrantMemoryVectorStore({
      enabled: true,
      provider: 'qdrant',
      url: 'http://qdrant:6333',
      collectionPrefix: 'monkeys_memory_items',
      timeoutMs: 5000,
      searchLimit: 80,
    });

    await expect(store.search({
      orgId: 'org_local',
      repoId: 'repo_1',
      compiledRuleId: 'compiled_1',
      compiledVersion: 7,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 3,
      vector: [0.3, 0.2, 0.1],
      limit: 10,
    })).resolves.toEqual([{ itemId: 'rule_1', score: 0.91 }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.filter.must).toEqual(expect.arrayContaining([
      { key: 'org_id', match: { value: 'org_local' } },
      { key: 'repo_id', match: { value: 'repo_1' } },
      { key: 'compiled_rule_id', match: { value: 'compiled_1' } },
      { key: 'compiled_version', match: { value: 7 } },
      { key: 'embedding_model', match: { value: 'text-embedding-3-small' } },
      { key: 'embedding_dimensions', match: { value: 3 } },
      { key: 'is_deleted', match: { value: false } },
    ]));
  });
});
