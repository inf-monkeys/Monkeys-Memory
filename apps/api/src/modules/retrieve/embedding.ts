const DEFAULT_DIMENSIONS = 64;

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

export function embedText(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
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

function normalizeDimensions(value: unknown): number {
  const dimensions = Number(value ?? DEFAULT_DIMENSIONS);
  if (!Number.isFinite(dimensions) || dimensions < 8) return DEFAULT_DIMENSIONS;
  return Math.min(4096, Math.floor(dimensions));
}

export function buildEmbeddingAdapter(config: EmbeddingConfig = {}): EmbeddingAdapter | null {
  if (config.enabled === false) return null;
  const provider = config.provider ?? 'local-hash';
  const dimensions = normalizeDimensions(config.dimensions);
  const model = config.model ?? `${provider}-${dimensions}`;
  const localEmbed = (text: string) => embedText(text, dimensions);
  if (provider === 'local-hash') {
    return {
      provider,
      model,
      dimensions,
      embed: async (text: string) => localEmbed(text),
    };
  }
  if (provider === 'openai-compatible') {
    const apiKey = config.apiKey;
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const timeoutMs = Math.max(100, Math.min(Number(config.timeoutMs ?? 10_000), 60_000));
    const fallbackToLocal = config.fallbackToLocal !== false;
    return {
      provider,
      model,
      dimensions,
      embed: async (text: string) => {
        if (!apiKey) {
          if (fallbackToLocal) return localEmbed(text);
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
          if (fallbackToLocal) return localEmbed(text);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
    };
  }
  return {
    provider,
    model,
    dimensions,
    embed: async (text: string) => localEmbed(text),
  };
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

export const LOCAL_EMBEDDING_MODEL = `local-hash-${DEFAULT_DIMENSIONS}`;
