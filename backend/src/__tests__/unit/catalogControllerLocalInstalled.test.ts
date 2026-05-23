// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import type { Request, Response } from 'express';

jest.unstable_mockModule('../../utils/secretCrypto.js', () => ({
  decryptSecret: (_blob: string) => 'mock-token',
  encryptSecret: (s: string) => s,
}));

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { upsertLocalProsCons } = await import('../../data/localProsConsRepo.js');
const { getLocalInstalled } = await import('../../controllers/catalogController.js');

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR REPLACE INTO user_provider_service_config
       (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at)
     VALUES (1, 'http://provider.test', ?, 'puid-test', 1, ?, ?)`,
    ['enc-blob', new Date().toISOString(), new Date().toISOString()],
  );
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_local_pros_cons');
  jest.resetAllMocks();
});

function fakeReq(): Request {
  return { user: { id: 1 } } as unknown as Request;
}
function fakeRes(): { res: Response; jsonBody: unknown; status: number } {
  const ref: { res: Response; jsonBody: unknown; status: number } = {
    res: undefined as unknown as Response,
    jsonBody: undefined,
    status: 200,
  };
  ref.res = {
    status(code: number) { ref.status = code; return ref.res; },
    json(body: unknown) { ref.jsonBody = body; return ref.res; },
  } as unknown as Response;
  return ref;
}

describe('getLocalInstalled', () => {
  it('returns curated entry for known model name', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded: ['mistral-nemo:latest'] }),
    });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ name: string; family: string; pros: string[] }> };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]!.name).toBe('mistral-nemo:latest');
    expect(body.models[0]!.family).toBe('chat');
    expect(body.models[0]!.pros.length).toBe(3);
  });

  it('returns cached entry when curated misses but cache hits', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded: ['custom-unknown:latest'] }),
    });
    await upsertLocalProsCons(
      'custom-unknown:latest',
      ['cached p1', 'cached p2', 'cached p3'],
      ['cached c1', 'cached c2', 'cached c3'],
      'custom',
    );
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ name: string; pros: string[] }> };
    expect(body.models[0]!.pros[0]).toBe('cached p1');
  });

  it('returns card without pros/cons when both miss', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded: ['totally-new:latest'] }),
    });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ name: string; pros?: string[] }> };
    expect(body.models[0]!.name).toBe('totally-new:latest');
    expect(body.models[0]!.pros).toBeUndefined();
  });

  it('sorts by family: chat < code < embedding < custom', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        loaded: ['nomic-embed-text:latest', 'qwen3-coder:latest', 'mistral-nemo:latest', 'soc-analyst:latest'],
      }),
    });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ family: string }> };
    expect(body.models.map((m) => m.family)).toEqual(['chat', 'code', 'embedding', 'custom']);
  });

  it('returns empty array when provider service not configured', async () => {
    await runQuery('UPDATE user_provider_service_config SET enabled = 0 WHERE user_id = 1');
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    expect((r.jsonBody as { models: unknown[] }).models).toEqual([]);
    await runQuery('UPDATE user_provider_service_config SET enabled = 1 WHERE user_id = 1');
  });

  it('returns empty array when /models/status fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    expect((r.jsonBody as { models: unknown[] }).models).toEqual([]);
  });
});
