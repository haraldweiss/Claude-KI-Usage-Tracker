// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Set DATABASE_PATH BEFORE importing anything that touches sqlite.ts.
process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  listUsersWithProviderServiceConfig,
  insertEventIfNew,
  getLocalUsageSummary,
  updateSyncStatus,
} = await import('../../data/localUsageRepo.js');

beforeAll(async () => {
  await initDatabase();
  // seedInitialUser inserts user id=1 (anubclaw@gmail.com). Add two more users
  // for multi-user assertions.
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email) VALUES (101, 'a@x.com'), (102, 'b@x.com')`
  );
});

afterEach(async () => {
  await runQuery('DELETE FROM provider_service_events');
  await runQuery('DELETE FROM provider_service_user_ids');
  await runQuery('DELETE FROM user_provider_service_config');
});

describe('localUsageRepo', () => {
  it('upsertProviderServiceConfig inserts new and updates existing', async () => {
    await upsertProviderServiceConfig(101, {
      service_url: 'http://x', service_token_enc: 'enc1',
      enabled: 1,
    });
    let cfg = await getProviderServiceConfig(101);
    expect(cfg?.service_url).toBe('http://x');

    await upsertProviderServiceConfig(101, {
      service_url: 'http://y', service_token_enc: 'enc2',
      enabled: 1,
    });
    cfg = await getProviderServiceConfig(101);
    expect(cfg?.service_url).toBe('http://y');
    expect(cfg?.service_token_enc).toBe('enc2');
  });

  it('listUsersWithProviderServiceConfig returns enabled users only', async () => {
    await upsertProviderServiceConfig(101, {
      service_url: 'x', service_token_enc: 'e', enabled: 1,
    });
    await upsertProviderServiceConfig(102, {
      service_url: 'x', service_token_enc: 'e', enabled: 0,
    });
    const ids = (await listUsersWithProviderServiceConfig()).map((u) => u.user_id);
    expect(ids).toEqual([101]);
  });

  it('insertEventIfNew is idempotent on (user_id, remote_event_id)', async () => {
    const ev = {
      remote_event_id: 42, remote_created_at: '2026-05-01T12:00:00',
      provider_id: 'ollama', model: 'm', input_tokens: 10, output_tokens: 5,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    };
    expect(await insertEventIfNew(101, ev)).toBe(true);
    expect(await insertEventIfNew(101, ev)).toBe(false);
    expect(await insertEventIfNew(101, { ...ev, remote_event_id: 43 })).toBe(true);
  });

  it('getLocalUsageSummary aggregates tokens and counts by period', async () => {
    const now = new Date();
    const inMonth = new Date(now.getFullYear(), now.getMonth(), 15, 12).toISOString();
    await insertEventIfNew(101, {
      remote_event_id: 1, remote_created_at: inMonth,
      provider_id: 'ollama', model: 'llama3.1:8b',
      input_tokens: 100, output_tokens: 50,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    });
    await insertEventIfNew(101, {
      remote_event_id: 2, remote_created_at: inMonth,
      provider_id: 'ollama', model: 'llama3.1:8b',
      input_tokens: 200, output_tokens: 100,
      cost_usd: 0, origin_app: null, status: 'success', error_message: null,
    });
    const s = await getLocalUsageSummary(101, 'month');
    expect(s.calls).toBe(2);
    expect(s.inputTokens).toBe(300);
    expect(s.outputTokens).toBe(150);
    expect(s.totalTokens).toBe(450);
    expect(s.topModels[0]).toEqual({ model: 'llama3.1:8b', calls: 2 });
  });

  it('updateSyncStatus clears error on success', async () => {
    await upsertProviderServiceConfig(101, {
      service_url: 'x', service_token_enc: 'e', enabled: 1,
    });
    await updateSyncStatus(101, {
      last_sync_at: '2026-05-01T12:00:00',
      last_sync_cursor: '2026-05-01T12:00:00',
      last_sync_error: null,
    });
    const cfg = await getProviderServiceConfig(101);
    expect(cfg?.last_sync_at).toBe('2026-05-01T12:00:00');
    expect(cfg?.last_sync_error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sub-A.1: provider_service_user_ids CRUD
// ---------------------------------------------------------------------------

const {
  addProviderUserId,
  listProviderUserIds,
  getProviderUserIdRow,
  removeProviderUserId,
  setProviderUserIdEnabled,
  updateProviderUserIdLabel,
} = await import('../../data/localUsageRepo.js');

describe('provider_service_user_ids CRUD', () => {
  it('addProviderUserId returns the new row', async () => {
    const row = await addProviderUserId(101, 'uuid-A', 'Bewerbungstracker');
    expect(row.provider_user_id).toBe('uuid-A');
    expect(row.label).toBe('Bewerbungstracker');
    expect(row.enabled).toBe(1);
  });

  it('addProviderUserId throws on duplicate (user_id, provider_user_id)', async () => {
    await addProviderUserId(101, 'dup');
    await expect(addProviderUserId(101, 'dup')).rejects.toThrow();
  });

  it('listProviderUserIds is user-scoped', async () => {
    await addProviderUserId(101, 'a');
    await addProviderUserId(102, 'b');
    const list101 = await listProviderUserIds(101);
    expect(list101.map((r) => r.provider_user_id)).toEqual(['a']);
  });

  it('getProviderUserIdRow returns null for foreign user_id', async () => {
    const row = await addProviderUserId(101, 'x');
    const stolen = await getProviderUserIdRow(row.id, 102);
    expect(stolen).toBeNull();
  });

  it('removeProviderUserId scopes by user_id', async () => {
    const row = await addProviderUserId(101, 'y');
    expect(await removeProviderUserId(row.id, 102)).toBe(false);
    expect(await removeProviderUserId(row.id, 101)).toBe(true);
  });

  it('setProviderUserIdEnabled and updateProviderUserIdLabel persist', async () => {
    const row = await addProviderUserId(101, 'z', 'old');
    await setProviderUserIdEnabled(row.id, 101, false);
    await updateProviderUserIdLabel(row.id, 101, 'new');
    const fresh = await getProviderUserIdRow(row.id, 101);
    expect(fresh?.enabled).toBe(0);
    expect(fresh?.label).toBe('new');
  });
});

const {
  listAllActiveProviderUserIds,
  updateProviderUserIdSyncStatus,
} = await import('../../data/localUsageRepo.js');

describe('listAllActiveProviderUserIds', () => {
  it('filters by ID-enabled AND master-enabled', async () => {
    // user 101: master enabled, one row enabled, one disabled
    await upsertProviderServiceConfig(101, {
      service_url: 'x', service_token_enc: 'e', enabled: 1,
    });
    await addProviderUserId(101, 'active-1');
    const r2 = await addProviderUserId(101, 'disabled-2');
    await setProviderUserIdEnabled(r2.id, 101, false);

    // user 102: master disabled but ID enabled
    await upsertProviderServiceConfig(102, {
      service_url: 'x', service_token_enc: 'e', enabled: 0,
    });
    await addProviderUserId(102, 'master-off-3');

    const entries = await listAllActiveProviderUserIds();
    const ids = entries.map((e) => e.row.provider_user_id).sort();
    expect(ids).toEqual(['active-1']);
  });
});

describe('updateProviderUserIdSyncStatus', () => {
  it('writes cursor + clears error', async () => {
    await upsertProviderServiceConfig(101, {
      service_url: 'x', service_token_enc: 'e', enabled: 1,
    });
    const row = await addProviderUserId(101, 'sync-1');
    await updateProviderUserIdSyncStatus(row.id, {
      last_sync_at: '2026-05-01T00:00:00',
      last_sync_cursor: '2026-05-01T00:00:00',
      last_sync_error: null,
    });
    const fresh = await getProviderUserIdRow(row.id, 101);
    expect(fresh?.last_sync_cursor).toBe('2026-05-01T00:00:00');
    expect(fresh?.last_sync_error).toBeNull();
  });
});
