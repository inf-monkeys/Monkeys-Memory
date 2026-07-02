const DEFAULT_LOCAL_DIMENSIONS = 64;
const DEFAULT_OPENAI_DIMENSIONS = 1536;
const DEFAULT_OPENAI_MODEL = 'text-embedding-3-small';

export type EmbeddingConfig = {
  enabled?: boolean;
  provider?: string;
  model?: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fallbackToLocal?: boolean;
};

export type EmbeddingAdapter = {
  provider: string;
  model: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
};

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.$:/-]+/)
    .filter(token => token.length > 1);
}

function hashToken(token: string, dimensions: number): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % dimensions;
}

export function embedText(text: string, dimensions = DEFAULT_LOCAL_DIMENSIONS): number[] {
  const vector = Array(dimensions).fill(0);
  for (const token of tokenize(text)) {
    vector[hashToken(token, dimensions)] += 1;
  }
  const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  return norm === 0 ? vector : vector.map(value => Number((value / norm).toFixed(6)));
}

function normalizeBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : 'https://api.openai.com/v1';
  return raw.replace(/\/+$/, '');
}

function normalizeDimensions(value: unknown, fallback: number): number {
  const dimensions = Number(value ?? fallback);
  if (!Number.isFinite(dimensions) || dimensions < 8) return fallback;
  return Math.min(4096, Math.floor(dimensions));
}

function buildLocalAdapter(dimensions = DEFAULT_LOCAL_DIMENSIONS, model?: string): EmbeddingAdapter {
  const normalizedDimensions = normalizeDimensions(dimensions, DEFAULT_LOCAL_DIMENSIONS);
  return {
    provider: 'local-hash',
    model: model ?? `local-hash-${normalizedDimensions}`,
    dimensions: normalizedDimensions,
    embed: async (text: string) => embedText(text, normalizedDimensions),
  };
}

export function buildEmbeddingAdapter(config: EmbeddingConfig = {}): EmbeddingAdapter | null {
  if (config.enabled === false) return null;
  const provider = config.provider ?? 'auto';
  const apiKey = config.apiKey;
  if (provider === 'auto' && !apiKey) {
    return buildLocalAdapter(config.dimensions);
  }
  const shouldUseOpenAi = provider === 'auto'
    ? Boolean(apiKey)
    : provider === 'openai-compatible' || provider === 'openai';

  if (provider === 'local-hash') {
    return buildLocalAdapter(config.dimensions, config.model);
  }

  if (shouldUseOpenAi) {
    const dimensions = normalizeDimensions(config.dimensions, DEFAULT_OPENAI_DIMENSIONS);
    const model = config.model ?? DEFAULT_OPENAI_MODEL;
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const timeoutMs = Math.max(100, Math.min(Number(config.timeoutMs ?? 10_000), 60_000));
    if (!apiKey && config.fallbackToLocal !== false) return buildLocalAdapter(dimensions, `local-hash-${dimensions}`);
    return {
      provider: 'openai-compatible',
      model,
      dimensions,
      embed: async (text: string) => {
        if (!apiKey) {
          throw new Error('embeddings.apiKey is required for openai-compatible provider');
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ model, input: text, dimensions }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`embedding request failed: ${response.status}`);
          const body = await response.json() as EmbeddingResponse;
          const embedding = body.data?.[0]?.embedding;
          if (!Array.isArray(embedding) || embedding.length === 0) throw new Error('embedding response missing data[0].embedding');
          return embedding.map(value => Number(value) || 0);
        } catch (error) {
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  }

  return buildLocalAdapter(config.dimensions, config.model);
}

export function cosineSimilarity(left?: number[], right?: number[]): number {
  if (!left?.length || !right?.length) return 0;
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += left[i] * right[i];
    normA += left[i] * left[i];
    normB += right[i] * right[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const LOCAL_EMBEDDING_MODEL = `local-hash-${DEFAULT_LOCAL_DIMENSIONS}`;
