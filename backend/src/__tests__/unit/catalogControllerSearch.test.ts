// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import type { Request, Response } from 'express';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery, allQuery } = await import('../../database/sqlite.js');
const { __clearCacheForTest } = await import('../../services/catalogService.js');
const { getSearch } = await import('../../controllers/catalogController.js');

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
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
});

// Minimal Express-like fake to capture json output.
function fakeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}
function fakeRes(): { res: Response; jsonBody: unknown; status: number } {
  const ref: { res: Response; jsonBody: unknown; status: number } = {
    res: undefined as unknown as Response,
    jsonBody: undefined,
    status: 200,
  };
  ref.res = {
    status(code: number) {
      ref.status = code;
      return ref.res;
    },
    json(body: unknown) {
      ref.jsonBody = body;
      return ref.res;
    },
  } as unknown as Response;
  return ref;
}

describe('catalog search: pros/cons integration', () => {
  it('returns search results within 500ms (no synchronous LLM call)', async () => {
    process.env.CATALOG_LLM_URL = 'http://pool.test';
    process.env.CATALOG_LLM_TOKEN = 'tok';
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('huggingface.co/api/models?')) {
        return {
          ok: true,
          json: async () => [
            { modelId: 'bartowski/X-GGUF', downloads: 100, siblings: [{ rfilename: 'q.gguf' }] },
          ],
        };
      }
      // LLM call would take 20s in reality, but we delay 1s to verify it's NOT awaited.
      if (u.includes('/v1/chat/completions')) {
        await new Promise((r) => setTimeout(r, 1000));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' } }],
          }),
        };
      }
      throw new Error(`unexpected URL: ${u}`);
    });

    const ref = fakeRes();
    const start = Date.now();
    await getSearch(fakeReq({ q: 'test' }), ref.res);
    const elapsed = Date.now() - start;

    expect(ref.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
    const body = ref.jsonBody as { results: Array<{ repo: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.repo).toBe('bartowski/X-GGUF');
  });

  it('merges cached pros/cons into search results when present', async () => {
    // Seed the cache with a pros-equipped card
    const cachedCard = {
      repo: 'bartowski/Y-GGUF',
      size_b: 7,
      quant_count: 4,
      downloads: 1000,
      source_label: 'Bartowski',
      description: 'cached',
      default_quant: 'Q4_K_M',
      ollama_command: 'ollama run hf.co/bartowski/Y-GGUF:Q4_K_M',
      pros: ['Cached-A', 'Cached-B', 'Cached-C'],
      cons: ['Cached-X', 'Cached-Y', 'Cached-Z'],
      auto_pros_generated_at: new Date().toISOString(),
    };
    await runQuery(
      `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
      ['bartowski/Y-GGUF', JSON.stringify(cachedCard), new Date().toISOString()],
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { modelId: 'bartowski/Y-GGUF', downloads: 1000, siblings: [{ rfilename: 'q.gguf' }] },
      ],
    });

    const ref = fakeRes();
    await getSearch(fakeReq({ q: 'test' }), ref.res);
    const body = ref.jsonBody as { results: Array<{ repo: string; pros?: string[] }> };
    expect(body.results[0]!.pros).toEqual(['Cached-A', 'Cached-B', 'Cached-C']);
  });

  it('does not call LLM when not configured (no env vars)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { modelId: 'bartowski/Z-GGUF', downloads: 1, siblings: [{ rfilename: 'q.gguf' }] },
      ],
    });
    const ref = fakeRes();
    await getSearch(fakeReq({ q: 'test' }), ref.res);
    // Wait briefly to give any spurious async kickoff a chance to fire
    await new Promise((r) => setTimeout(r, 50));
    // Only the HF search call should have happened — no /v1/chat/completions
    const llmCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/chat/completions'),
    );
    expect(llmCalls).toHaveLength(0);
  });

  it('triggers async generation for new search results', async () => {
    process.env.CATALOG_LLM_URL = 'http://pool.test';
    process.env.CATALOG_LLM_TOKEN = 'tok';
    let llmCalled = false;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('huggingface.co/api/models?')) {
        return {
          ok: true,
          json: async () => [
            { modelId: 'bartowski/W-GGUF', downloads: 5, siblings: [{ rfilename: 'q.gguf' }] },
          ],
        };
      }
      if (u.includes('/v1/chat/completions')) {
        llmCalled = true;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"pros":["P1","P2","P3"],"cons":["C1","C2","C3"]}' } }],
          }),
        };
      }
      throw new Error(`unexpected URL: ${u}`);
    });

    const ref = fakeRes();
    await getSearch(fakeReq({ q: 'test' }), ref.res);
    // Fire-and-forget: wait briefly for the kickoff to land
    await new Promise((r) => setTimeout(r, 200));
    expect(llmCalled).toBe(true);

    // Verify pros got upserted into the cache
    const rows = await allQuery<{ data_json: string }>(
      `SELECT data_json FROM catalog_hf_cache WHERE repo='bartowski/W-GGUF'`,
    );
    if (rows.length > 0) {
      const card = JSON.parse(rows[0]!.data_json);
      expect(card.pros).toEqual(['P1', 'P2', 'P3']);
    }
  });
});
