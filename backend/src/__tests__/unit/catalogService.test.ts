// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const {
  fetchModelMetadata,
  searchModels,
  isInstalled,
  ollamaCommandFor,
  __clearCacheForTest,
} = await import('../../services/catalogService.js');

let fetchMock: jest.Mock;

beforeEach(() => {
  __clearCacheForTest();
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('ollamaCommandFor', () => {
  it('appends the default quant tag', () => {
    expect(ollamaCommandFor('bartowski/X-GGUF', 'Q4_K_M'))
      .toBe('ollama run hf.co/bartowski/X-GGUF:Q4_K_M');
  });
});

describe('isInstalled', () => {
  it('matches with -GGUF stripped, lowercased, by startsWith', () => {
    const installed = ['qwen2.5-coder-7b-instruct:q4_k_m'];
    expect(isInstalled(installed, 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(true);
  });

  it('matches the full hf.co path', () => {
    const installed = ['hf.co/bartowski/qwen2.5-coder-7b-instruct-gguf:q4_k_m'];
    expect(isInstalled(installed, 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(true);
  });

  it('does not match unrelated models', () => {
    const installed = ['llama3:8b'];
    expect(isInstalled(installed, 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(false);
  });
});

describe('fetchModelMetadata', () => {
  it('returns a mapped ModelCard on successful HF response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        modelId: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
        downloads: 23000,
        siblings: [
          { rfilename: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf' },
          { rfilename: 'Qwen2.5-Coder-7B-Instruct-Q8_0.gguf' },
          { rfilename: 'README.md' },
        ],
        description: 'A coding LLM by Qwen team.',
      }),
    });

    const card = await fetchModelMetadata('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', 'Q4_K_M');
    expect(card?.repo).toBe('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF');
    expect(card?.downloads).toBe(23000);
    expect(card?.quant_count).toBe(2);
    expect(card?.source_label).toBe('Bartowski');
    expect(card?.default_quant).toBe('Q4_K_M');
    expect(card?.ollama_command).toBe('ollama run hf.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M');
    expect(card?.size_b).toBe(7);
    expect(card?.description).toContain('coding LLM');
  });

  it('handles 404 by returning null', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const card = await fetchModelMetadata('bartowski/Vanished-GGUF', 'Q4_K_M');
    expect(card).toBeNull();
  });

  it('uses cache on second call within TTL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ modelId: 'r', downloads: 1, siblings: [] }),
    });
    await fetchModelMetadata('r', 'Q4_K_M');
    await fetchModelMetadata('r', 'Q4_K_M');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache on HF error if cache exists', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ modelId: 'r', downloads: 1, siblings: [] }),
    });
    await fetchModelMetadata('r', 'Q4_K_M');
    __clearCacheForTest({ keepStale: true });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const card = await fetchModelMetadata('r', 'Q4_K_M');
    expect(card).not.toBeNull();
    expect(card!.stale).toBe(true);
  });
});

describe('searchModels', () => {
  it('returns mapped ModelCards from HF search', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { modelId: 'bartowski/A-GGUF', downloads: 100, siblings: [{ rfilename: 'a-Q4.gguf' }] },
        { modelId: 'bartowski/B-GGUF', downloads: 50, siblings: [{ rfilename: 'b-Q4.gguf' }] },
      ],
    });
    const r = await searchModels('coder', 50);
    expect(r.results).toHaveLength(2);
    expect(r.results[0].repo).toBe('bartowski/A-GGUF');
  });
});

const { fetchLatestUploads } = await import('../../services/catalogService.js');

describe('fetchLatestUploads', () => {
  it('queries HF with author + sort=lastModified', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'bartowski/A-GGUF', lastModified: '2026-05-17T10:00:00' },
        { id: 'bartowski/B-GGUF', lastModified: '2026-05-16T10:00:00' },
      ],
    });
    const r = await fetchLatestUploads('bartowski', 10);
    expect(r).toHaveLength(2);
    expect(r[0]?.id).toBe('bartowski/A-GGUF');
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('author=bartowski');
    expect(String(url)).toContain('sort=lastModified');
    expect(String(url)).toContain('direction=-1');
    expect(String(url)).toContain('limit=10');
  });

  it('throws on HF error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchLatestUploads('bartowski')).rejects.toThrow(/HF 500/);
  });
});
