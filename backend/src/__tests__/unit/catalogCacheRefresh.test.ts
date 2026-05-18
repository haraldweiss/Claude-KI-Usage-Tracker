// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { __clearCacheForTest } = await import('../../services/catalogService.js');
const { refreshCuratedHfCache, isCacheEmpty } = await import(
  '../../services/catalogCacheRefresh.js'
);

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
});

beforeEach(() => {
  __clearCacheForTest();
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_hf_cache');
  jest.resetAllMocks();
});

function extractRepoFromUrl(url: string): string {
  const m = url.match(/api\/models\/(.+)$/);
  if (!m) return 'unknown/unknown';
  return decodeURIComponent(m[1]!).replace(/%2F/gi, '/');
}

describe('refreshCuratedHfCache', () => {
  it('refreshes all curated models successfully', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        modelId: extractRepoFromUrl(url),
        downloads: 100,
        siblings: [{ rfilename: 'q4.gguf' }],
      }),
    }));
    const r = await refreshCuratedHfCache();
    expect(r.refreshed).toBeGreaterThanOrEqual(8);
    expect(r.failed).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('records last_error for individual failures, keeps going', async () => {
    let i = 0;
    fetchMock.mockImplementation(async (url: string) => {
      i++;
      if (i === 3) return { ok: false, status: 500 };
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });
    const r = await refreshCuratedHfCache();
    expect(r.failed).toBe(1);
    expect(r.refreshed).toBeGreaterThanOrEqual(7);
    expect(r.errors).toHaveLength(1);
  });

  it('treats HF 404 as a recoverable per-row failure', async () => {
    let i = 0;
    fetchMock.mockImplementation(async (url: string) => {
      i++;
      if (i === 1) return { ok: false, status: 404 };
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });
    const r = await refreshCuratedHfCache();
    expect(r.failed).toBe(1);
    expect(r.errors[0]?.error).toMatch(/404/);
  });
});

describe('isCacheEmpty', () => {
  it('returns true when no rows exist', async () => {
    expect(await isCacheEmpty()).toBe(true);
  });

  it('returns false once any curated repo is cached', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        modelId: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
        downloads: 100, siblings: [{ rfilename: 'q4.gguf' }],
      }),
    });
    await refreshCuratedHfCache();
    expect(await isCacheEmpty()).toBe(false);
  });
});
