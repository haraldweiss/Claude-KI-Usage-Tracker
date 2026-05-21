// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/secretCrypto.js', () => ({
  decryptSecret: (_blob: string) => 'mock-token',
  encryptSecret: (s: string) => s,
}));

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { upsertModelProsCons } = await import('../../data/modelProsConsRepo.js');
const { recommendModel } = await import('../../services/modelRecommendationService.js');

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email) VALUES (42, 'reco-test@x.com')`,
  );
  await runQuery(
    `INSERT OR REPLACE INTO pricing (model, input_price, output_price, tier, status, last_updated)
     VALUES
       ('Claude Haiku 4.5', 0.8, 4, 'haiku', 'active', ?),
       ('Claude Sonnet 4.6', 3, 15, 'sonnet', 'active', ?),
       ('Claude Opus 4.7', 15, 75, 'opus', 'active', ?)`,
    [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()],
  );
  await runQuery(
    `INSERT OR REPLACE INTO user_provider_service_config
       (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at)
     VALUES (42, 'http://provider.test', ?, ?, 1, ?, ?)`,
    ['enc-blob', 'puid-reco', new Date().toISOString(), new Date().toISOString()],
  );
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM model_pros_cons');
  await runQuery('DELETE FROM catalog_local_pros_cons');
  jest.resetAllMocks();
});

describe('recommendModel with catalog integration', () => {
  it('attaches pros/cons to recommended Claude model when cached', async () => {
    await upsertModelProsCons(
      'Claude Sonnet 4.6',
      ['cached p1', 'cached p2', 'cached p3'],
      ['cached c1', 'cached c2', 'cached c3'],
    );
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ loaded: [] }) });
    const r = await recommendModel('refactor this code', {}, 42);
    expect(r.recommended).toBeDefined();
    if (r.recommended === 'Claude Sonnet 4.6') {
      expect(r.pros).toEqual(['cached p1', 'cached p2', 'cached p3']);
    }
    const sonnetAlt = r.alternatives?.find((a) => a.model === 'Claude Sonnet 4.6');
    if (sonnetAlt) {
      expect(sonnetAlt.pros).toEqual(['cached p1', 'cached p2', 'cached p3']);
    }
  });

  it('returns empty localAlternatives when provider service has no models', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ loaded: [] }) });
    const r = await recommendModel('summarize this text', {}, 42);
    expect(r.localAlternatives).toEqual([]);
  });

  it('filters localAlternatives to family matching task keywords (code task → code family)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        loaded: ['mistral-nemo:latest', 'qwen3-coder:latest', 'nomic-embed-text:latest'],
      }),
    });
    const r = await recommendModel('debug this async function', {}, 42);
    expect(r.localAlternatives).toBeDefined();
    expect(r.localAlternatives!.length).toBeGreaterThan(0);
    for (const alt of r.localAlternatives!) {
      expect(alt.family).toBe('code');
    }
    expect(r.localAlternatives![0]!.ollama_command).toBe('ollama run qwen3-coder:latest');
  });

  it('returns chat-family local alternatives for chat-ish task', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        loaded: ['mistral-nemo:latest', 'qwen3-coder:latest'],
      }),
    });
    const r = await recommendModel('summarize this paragraph', {}, 42);
    const families = r.localAlternatives!.map((a) => a.family);
    expect(families).toContain('chat');
    expect(families).not.toContain('code');
  });

  it('does not fail when userId is missing', async () => {
    const r = await recommendModel('any task', {});
    expect(r.recommended).toBeDefined();
    expect(r.localAlternatives).toEqual([]);
  });
});
