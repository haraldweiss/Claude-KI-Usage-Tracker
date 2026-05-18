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

const { refreshLatestUploads } = await import(
  '../../services/catalogCacheRefresh.js'
);
const { listLatestUploads } = await import('../../data/latestUploadsRepo.js');

describe('refreshLatestUploads', () => {
  it('picks top 6 across both quanters, sorted by lastModified DESC', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('author=bartowski') && url.includes('sort=lastModified')) {
        return {
          ok: true,
          json: async () => [
            { id: 'bartowski/A-GGUF', lastModified: '2026-05-18T12:00:00' },
            { id: 'bartowski/B-GGUF', lastModified: '2026-05-18T10:00:00' },
            { id: 'bartowski/C-GGUF', lastModified: '2026-05-18T08:00:00' },
            { id: 'bartowski/D-GGUF', lastModified: '2026-05-16T08:00:00' },
          ],
        };
      }
      if (url.includes('author=MaziyarPanahi') && url.includes('sort=lastModified')) {
        return {
          ok: true,
          json: async () => [
            { id: 'MaziyarPanahi/W-GGUF', lastModified: '2026-05-18T11:00:00' },
            { id: 'MaziyarPanahi/X-GGUF', lastModified: '2026-05-18T09:00:00' },
            { id: 'MaziyarPanahi/Y-GGUF', lastModified: '2026-05-17T09:00:00' },
            { id: 'MaziyarPanahi/Z-GGUF', lastModified: '2026-05-15T09:00:00' },
          ],
        };
      }
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });

    const r = await refreshLatestUploads();
    expect(r.failed).toBe(0);
    expect(r.refreshed).toBe(6);

    const rows = await listLatestUploads();
    expect(rows).toHaveLength(6);
    expect(rows.map((x) => x.repo)).toEqual([
      'bartowski/A-GGUF',
      'MaziyarPanahi/W-GGUF',
      'bartowski/B-GGUF',
      'MaziyarPanahi/X-GGUF',
      'bartowski/C-GGUF',
      'MaziyarPanahi/Y-GGUF',
    ]);
  });

  it('dedups duplicate repos across quanters', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('author=bartowski') && url.includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'shared/X-GGUF', lastModified: '2026-05-18T12:00:00' },
        ]};
      }
      if (url.includes('author=MaziyarPanahi') && url.includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'shared/X-GGUF', lastModified: '2026-05-17T12:00:00' },
        ]};
      }
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });

    await refreshLatestUploads();
    const rows = await listLatestUploads();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repo).toBe('shared/X-GGUF');
  });

  it('keeps going if one quanter fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('author=bartowski') && url.includes('sort=lastModified')) {
        return { ok: false, status: 500 };
      }
      if (url.includes('author=MaziyarPanahi') && url.includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'MaziyarPanahi/M1-GGUF', lastModified: '2026-05-18T12:00:00' },
          { id: 'MaziyarPanahi/M2-GGUF', lastModified: '2026-05-17T12:00:00' },
        ]};
      }
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });

    const r = await refreshLatestUploads();
    expect(r.errors.some((e) => e.repo === 'author:bartowski')).toBe(true);
    expect(r.refreshed).toBe(2);
    const rows = await listLatestUploads();
    expect(rows).toHaveLength(2);
  });
});
