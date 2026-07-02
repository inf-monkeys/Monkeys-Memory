import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEmbeddingAdapter, embedText } from '../../../src/modules/retrieve/embedding.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('embedding adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses OpenAI-compatible embeddings automatically when an API key is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = buildEmbeddingAdapter({
      provider: 'auto',
      apiKey: 'embed_key',
      model: 'text-embedding-3-small',
      dimensions: 8,
      baseUrl: 'https://embed.internal/v1/',
    });

    expect(adapter).toMatchObject({
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      dimensions: 8,
    });
    await expect(adapter!.embed('memory query')).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://embed.internal/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer embed_key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ model: 'text-embedding-3-small', input: 'memory query', dimensions: 8 }),
      }),
    );
  });

  it('falls back to deterministic local hash embeddings when no OpenAI key is configured', async () => {
    const adapter = buildEmbeddingAdapter({ provider: 'auto', dimensions: 16 });

    expect(adapter).toMatchObject({
      provider: 'local-hash',
      model: 'local-hash-16',
      dimensions: 16,
    });
    await expect(adapter!.embed('Validate adapter boundaries')).resolves.toEqual(
      embedText('Validate adapter boundaries', 16),
    );
  });

  it('does not mix local fallback vectors into a configured OpenAI model when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500)));
    const adapter = buildEmbeddingAdapter({
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      dimensions: 32,
      apiKey: 'embed_key',
    });

    await expect(adapter!.embed('fallback text')).rejects.toThrow('embedding request failed: 500');
  });

  it('can fail closed when fallback is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, 500)));
    const adapter = buildEmbeddingAdapter({
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      dimensions: 16,
      apiKey: 'embed_key',
      fallbackToLocal: false,
    });

    await expect(adapter!.embed('fallback text')).rejects.toThrow('embedding request failed: 500');
  });
});
