import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import type { MemoryKind, MemoryPolicy, MemoryValidity } from '../../shared/types.js';

type QdrantConfig = typeof env.vectorStore;

const defaultConfig: QdrantConfig = {
  enabled: true,
  provider: 'qdrant',
  url: 'http://localhost:6333',
  apiKey: undefined,
  collectionPrefix: 'monkeys_memory_items',
  timeoutMs: 10_000,
  searchLimit: 80,
};

export type MemoryVectorRecord = {
  orgId: string;
  repoId: string;
  compiledRuleId: string;
  compiledVersion: number;
  itemId: string;
  itemKind: MemoryKind;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embedding: number[];
  contentHash: string;
  claim: string;
  paths: string[];
  taskTypes: string[];
  entities: string[];
  policy?: MemoryPolicy;
  validity?: MemoryValidity;
  generatedAt: string;
};

export type MemoryVectorSearchInput = {
  orgId: string;
  repoId: string;
  compiledRuleId: string;
  compiledVersion: number;
  embeddingModel: string;
  embeddingDimensions: number;
  vector: number[];
  limit?: number;
};

export type MemoryVectorSearchResult = {
  itemId: string;
  score: number;
};

type QdrantPayload = {
  org_id: string;
  repo_id: string;
  compiled_rule_id: string;
  compiled_version: number;
  item_id: string;
  item_kind: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  content_hash: string;
  claim: string;
  paths: string[];
  task_types: string[];
  entities: string[];
  visibility?: string;
  sensitivity?: string;
  user_id?: string | null;
  team_id?: string | null;
  template_id?: string | null;
  branches?: string[];
  tags?: string[];
  is_deleted: boolean;
  generated_at: string;
};

type QdrantPoint = {
  id: string;
  vector: number[];
  payload: QdrantPayload;
};

type QdrantSearchResponse = {
  result?: Array<{
    score?: number;
    payload?: Partial<QdrantPayload>;
  }>;
};

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function sanitizeCollectionPart(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'default';
}

function stablePointId(record: MemoryVectorRecord): string {
  const hash = crypto
    .createHash('sha256')
    .update([
      record.orgId,
      record.repoId,
      String(record.compiledVersion),
      record.itemId,
      record.embeddingModel,
      String(record.embeddingDimensions),
    ].join('\0'))
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

function filterMust(input: MemoryVectorSearchInput) {
  return [
    { key: 'org_id', match: { value: input.orgId } },
    { key: 'repo_id', match: { value: input.repoId } },
    { key: 'compiled_rule_id', match: { value: input.compiledRuleId } },
    { key: 'compiled_version', match: { value: input.compiledVersion } },
    { key: 'embedding_model', match: { value: input.embeddingModel } },
    { key: 'embedding_dimensions', match: { value: input.embeddingDimensions } },
    { key: 'is_deleted', match: { value: false } },
  ];
}

function collectionName(config: QdrantConfig, embeddingModel: string, dimensions: number): string {
  return [
    sanitizeCollectionPart(config.collectionPrefix),
    sanitizeCollectionPart(embeddingModel),
    String(dimensions),
    'v1',
  ].join('_');
}

export class QdrantMemoryVectorStore {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  private readonly config: QdrantConfig;

  constructor(config: Partial<QdrantConfig> | undefined = env.vectorStore) {
    this.config = { ...defaultConfig, ...(config ?? {}) };
    this.baseUrl = normalizeUrl(this.config.url);
    this.timeoutMs = Math.max(100, Math.min(Number(this.config.timeoutMs ?? 10_000), 60_000));
  }

  isEnabled(): boolean {
    return this.config.enabled !== false && this.config.provider === 'qdrant';
  }

  async upsertCompiledVectors(records: MemoryVectorRecord[]): Promise<{ collection: string; pointCount: number } | null> {
    if (!this.isEnabled() || records.length === 0) return null;
    const first = records[0];
    if (records.some(record => record.embeddingModel !== first.embeddingModel || record.embeddingDimensions !== first.embeddingDimensions)) {
      throw new Error('Qdrant upsert requires one embedding model and dimension per batch');
    }

    const collection = collectionName(this.config, first.embeddingModel, first.embeddingDimensions);
    await this.ensureCollection(collection, first.embeddingDimensions);
    await this.ensurePayloadIndexes(collection);

    const points: QdrantPoint[] = records.map(record => ({
      id: stablePointId(record),
      vector: record.embedding,
      payload: {
        org_id: record.orgId,
        repo_id: record.repoId,
        compiled_rule_id: record.compiledRuleId,
        compiled_version: record.compiledVersion,
        item_id: record.itemId,
        item_kind: record.itemKind,
        embedding_provider: record.embeddingProvider,
        embedding_model: record.embeddingModel,
        embedding_dimensions: record.embeddingDimensions,
        content_hash: record.contentHash,
        claim: record.claim,
        paths: record.paths,
        task_types: record.taskTypes,
        entities: record.entities,
        visibility: record.policy?.visibility,
        sensitivity: record.policy?.sensitivity,
        user_id: record.policy?.user_id,
        team_id: record.policy?.team_id,
        template_id: record.policy?.template_id,
        branches: record.validity?.branches ?? [],
        tags: record.validity?.tags ?? [],
        is_deleted: false,
        generated_at: record.generatedAt,
      },
    }));

    await this.request(`/collections/${collection}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    });

    return { collection, pointCount: points.length };
  }

  async search(input: MemoryVectorSearchInput): Promise<MemoryVectorSearchResult[]> {
    if (!this.isEnabled() || input.vector.length === 0) return [];
    const collection = collectionName(this.config, input.embeddingModel, input.embeddingDimensions);
    const body = await this.request<QdrantSearchResponse>(`/collections/${collection}/points/search`, {
      method: 'POST',
      body: JSON.stringify({
        vector: input.vector,
        limit: Math.max(1, Math.min(input.limit ?? this.config.searchLimit, 200)),
        with_payload: ['item_id'],
        with_vector: false,
        filter: { must: filterMust(input) },
      }),
    });

    return (body?.result ?? [])
      .map(point => ({
        itemId: typeof point.payload?.item_id === 'string' ? point.payload.item_id : '',
        score: Number(point.score ?? 0),
      }))
      .filter(result => result.itemId && Number.isFinite(result.score) && result.score > 0);
  }

  private async ensureCollection(collection: string, dimensions: number): Promise<void> {
    const existing = await this.request(`/collections/${collection}`, { method: 'GET', allow404: true });
    if (existing) return;
    await this.request(`/collections/${collection}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size: dimensions,
          distance: 'Cosine',
        },
      }),
    });
  }

  private async ensurePayloadIndexes(collection: string): Promise<void> {
    const indexes = [
      ['org_id', 'keyword'],
      ['repo_id', 'keyword'],
      ['compiled_rule_id', 'keyword'],
      ['compiled_version', 'integer'],
      ['item_kind', 'keyword'],
      ['embedding_model', 'keyword'],
      ['embedding_dimensions', 'integer'],
      ['is_deleted', 'bool'],
      ['visibility', 'keyword'],
      ['team_id', 'keyword'],
      ['user_id', 'keyword'],
      ['template_id', 'keyword'],
    ] as const;

    for (const [fieldName, fieldSchema] of indexes) {
      await this.request(`/collections/${collection}/index`, {
        method: 'PUT',
        body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
      });
    }
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    options: RequestInit & { allow404?: boolean } = {},
  ): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { 'api-key': this.config.apiKey } : {}),
          ...(options.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (response.status === 404 && options.allow404) return null;
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Qdrant request failed: ${response.status}${text ? ` ${text}` : ''}`);
      }
      if (response.status === 204) return null;
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const memoryVectorStore = new QdrantMemoryVectorStore();
