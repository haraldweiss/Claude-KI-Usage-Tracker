// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';
process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  insertEventIfNew,
} = await import('../../data/localUsageRepo.js');
const { encryptSecret } = await import('../../utils/secretCrypto.js');
const { syncProviderServiceEvents } = await import(
  '../../services/providerServiceSyncService.js'
);

let fetchMock: jest.Mock;

function makeEvent(id: number, ts: string) {
  return {
    id, created_at: ts, user_id: 'pu',
    provider_id: 'ollama', model: 'llama3.1:8b',
    input_tokens: 100, output_tokens: 50, cost_usd: 0,
    origin_app: null, status: 'success', error_message: null,
  };
}

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email) VALUES (201, 'sync-test@x.com')`,
  );
});

beforeEach(async () => {
  await upsertProviderServiceConfig(201, {
    service_url: 'http://test-service:8767',
    service_token_enc: encryptSecret('test-token'),
    provider_user_id: 'pu',
    enabled: 1,
  });
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM provider_service_events');
  await runQuery('DELETE FROM user_provider_service_config');
  jest.resetAllMocks();
});

describe('syncProviderServiceEvents', () => {
  it('pulls events in a single page and inserts them', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [makeEvent(1, '2026-05-01T12:00:00')],
        count: 1, next_since: '2026-05-01T12:00:00', has_more: false,
      }),
    });

    const result = await syncProviderServiceEvents(201);
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(1);

    const cfg = await getProviderServiceConfig(201);
    expect(cfg?.last_sync_cursor).toBe('2026-05-01T12:00:00');
    expect(cfg?.last_sync_error).toBeNull();
  });

  it('paginates while has_more is true', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [makeEvent(1, '2026-05-01T12:00:00'), makeEvent(2, '2026-05-01T12:01:00')],
          count: 2, next_since: '2026-05-01T12:01:00', has_more: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          events: [makeEvent(3, '2026-05-01T12:02:00')],
          count: 1, next_since: '2026-05-01T12:02:00', has_more: false,
        }),
      });

    const result = await syncProviderServiceEvents(201);
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — re-sync with same events inserts zero new', async () => {
    await insertEventIfNew(201, {
      remote_event_id: 1, remote_created_at: '2026-05-01T12:00:00',
      provider_id: 'ollama', model: 'm', input_tokens: 1, output_tokens: 1,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [makeEvent(1, '2026-05-01T12:00:00')],
        count: 1, next_since: '2026-05-01T12:00:00', has_more: false,
      }),
    });

    const result = await syncProviderServiceEvents(201);
    expect(result.newEvents).toBe(0);
  });

  it('records last_sync_error on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const result = await syncProviderServiceEvents(201);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);

    const cfg = await getProviderServiceConfig(201);
    expect(cfg?.last_sync_error).toMatch(/401/);
  });

  it('returns ok with 0 events when disabled', async () => {
    await runQuery(
      'UPDATE user_provider_service_config SET enabled = 0 WHERE user_id = ?',
      [201],
    );
    const result = await syncProviderServiceEvents(201);
    expect(result.ok).toBe(true);
    expect(result.newEvents).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends bearer token and user_id in request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [], count: 0, next_since: null, has_more: false }),
    });
    await syncProviderServiceEvents(201);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/usage/events');
    expect(String(url)).toContain('user_id=pu');
    expect((init as { headers: Record<string, string> }).headers.Authorization)
      .toBe('Bearer test-token');
  });
});
