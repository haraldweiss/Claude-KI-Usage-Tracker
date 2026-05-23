# Multi-Source Tracking (Sub-Projekt A.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the local-LLM tracking from one configured `provider_user_id` per tracker-user to N. Settings UI gets a list with add/remove/label/enabled per ID; overview card renders one mini-card per `origin_app` (fallback: `provider_user_id`).

**Architecture:** New table `provider_service_user_ids` (1:N with users). Connection-config (URL/token/master-enabled) stays in `user_provider_service_config`. Per-ID cursor/error tracking. Sync iterates over all active IDs of a tracker-user. Card aggregates events by `COALESCE(origin_app, 'user:'||provider_user_id)`.

**Tech Stack:** Node.js/TypeScript + node-sqlite3 + Jest (backend), React + TypeScript + Vite (frontend).

**Spec:** [docs/superpowers/specs/2026-05-17-multi-source-tracking-design.md](../specs/2026-05-17-multi-source-tracking-design.md)

---

## Phase 1 — Backend Schema + Migration

### Task 1: Add `provider_service_user_ids` table + migration

**Files:**
- Modify: `backend/src/database/sqlite.ts` (additive, inside `initDatabase()`)

- [ ] **Step 1.1: Read current sqlite.ts to find the right insertion point**

Open `backend/src/database/sqlite.ts`. Find the existing block that creates `provider_service_events` (added in Sub-A). The new table block goes immediately AFTER it but BEFORE `resolve()` at the bottom of `initDatabase()`.

- [ ] **Step 1.2: Insert table creation block**

Append after the existing `idx_pse_provider` index creation (immediately before `resolve();`):

```typescript
// Sub-A.1: 1:N — multiple provider_user_ids per tracker-user. Replaces the
// single column user_provider_service_config.provider_user_id (kept for one
// release as rollback safety net). Each row tracks its own sync cursor so a
// failing/slow ID doesn't poison another ID's incremental state.
await new Promise<void>((res, rej) => {
  database.run(
    `CREATE TABLE IF NOT EXISTS provider_service_user_ids (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_user_id  TEXT NOT NULL,
      label             TEXT,
      enabled           INTEGER NOT NULL DEFAULT 1,
      last_sync_at      TEXT,
      last_sync_cursor  TEXT,
      last_sync_error   TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      UNIQUE (user_id, provider_user_id)
    )`,
    (tErr: Error | null) => (tErr ? rej(tErr) : res())
  );
});
await new Promise<void>((res, rej) => {
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_psuid_user_enabled ON provider_service_user_ids(user_id, enabled)',
    (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
  );
});

// Migration: copy existing provider_user_id from user_provider_service_config
// into the new table. Idempotent via NOT EXISTS so reruns are safe.
await new Promise<void>((res, rej) => {
  database.run(
    `INSERT INTO provider_service_user_ids
       (user_id, provider_user_id, label, enabled, last_sync_at, last_sync_cursor, last_sync_error, created_at, updated_at)
     SELECT
       upsc.user_id, upsc.provider_user_id, NULL, upsc.enabled,
       upsc.last_sync_at, upsc.last_sync_cursor, upsc.last_sync_error,
       upsc.created_at, upsc.updated_at
     FROM user_provider_service_config upsc
     WHERE upsc.provider_user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM provider_service_user_ids psuid
         WHERE psuid.user_id = upsc.user_id
           AND psuid.provider_user_id = upsc.provider_user_id
       )`,
    (mErr: Error | null) => (mErr ? rej(mErr) : res())
  );
});
```

- [ ] **Step 1.3: Run all backend tests — they must still pass**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npm test 2>&1 | tail -10
```

Expected: no regression. The pre-existing single auth-flow failure remains as-is (unrelated).

- [ ] **Step 1.4: Manual: verify migration works on a fresh DB**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
rm -f /tmp/migration-smoke.sqlite
node --input-type=module -e "
process.env.DATABASE_PATH = '/tmp/migration-smoke.sqlite';
const { initDatabase, runQuery, allQuery } = await import('./dist/database/sqlite.js');
await initDatabase();
// Insert a fake user + sub-A-style config (single provider_user_id)
await runQuery('INSERT OR IGNORE INTO users (id, email) VALUES (99, ?)', ['mig@x.com']);
await runQuery(\`
  INSERT INTO user_provider_service_config
    (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at, last_sync_cursor)
  VALUES (99, 'http://x', 'enc', 'legacy-id', 1, datetime('now'), datetime('now'), '2026-01-01T00:00:00')
\`);
// Re-init to trigger migration
await initDatabase();
const rows = await allQuery('SELECT user_id, provider_user_id, last_sync_cursor FROM provider_service_user_ids WHERE user_id = 99');
console.log('migrated rows:', JSON.stringify(rows));
" 2>&1
rm -f /tmp/migration-smoke.sqlite
```

Expected output contains: `migrated rows: [{"user_id":99,"provider_user_id":"legacy-id","last_sync_cursor":"2026-01-01T00:00:00"}]`

Note: requires `dist/` to be built first (`npx tsc`). If you prefer, write a tiny test instead — but this is faster as a one-shot.

- [ ] **Step 1.5: Commit**

```
git add backend/src/database/sqlite.ts
git commit -m "feat(db): add provider_service_user_ids table + auto-migrate from old column"
```

---

## Phase 2 — Backend Repo

### Task 2: `localUsageRepo` — types + user-ids CRUD

**Files:**
- Modify: `backend/src/data/localUsageRepo.ts`

- [ ] **Step 2.1: Add new types at the top of the file (after existing interfaces)**

Add these after the existing `SyncStatusUpdate` interface:

```typescript
export interface ProviderUserIdRow {
  id: number;
  user_id: number;
  provider_user_id: string;
  label: string | null;
  enabled: number;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  last_sync_error: string | null;
}
```

- [ ] **Step 2.2: Add CRUD helpers at the bottom of the file**

```typescript
export async function addProviderUserId(
  userId: number, providerUserId: string, label: string | null = null,
): Promise<ProviderUserIdRow> {
  const now = new Date().toISOString();
  const res = await runQuery(
    `INSERT INTO provider_service_user_ids
       (user_id, provider_user_id, label, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [userId, providerUserId, label, now, now],
  );
  const row = await getQuery<ProviderUserIdRow>(
    'SELECT * FROM provider_service_user_ids WHERE id = ?',
    [res.lastID],
  );
  if (!row) throw new Error('insert failed');
  return row;
}

export async function listProviderUserIds(
  userId: number,
): Promise<ProviderUserIdRow[]> {
  return allQuery<ProviderUserIdRow>(
    'SELECT * FROM provider_service_user_ids WHERE user_id = ? ORDER BY id ASC',
    [userId],
  );
}

export async function getProviderUserIdRow(
  rowId: number, userId: number,
): Promise<ProviderUserIdRow | null> {
  const row = await getQuery<ProviderUserIdRow>(
    'SELECT * FROM provider_service_user_ids WHERE id = ? AND user_id = ?',
    [rowId, userId],
  );
  return row ?? null;
}

export async function removeProviderUserId(
  rowId: number, userId: number,
): Promise<boolean> {
  const res = await runQuery(
    'DELETE FROM provider_service_user_ids WHERE id = ? AND user_id = ?',
    [rowId, userId],
  );
  return res.changes > 0;
}

export async function setProviderUserIdEnabled(
  rowId: number, userId: number, enabled: boolean,
): Promise<boolean> {
  const res = await runQuery(
    'UPDATE provider_service_user_ids SET enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [enabled ? 1 : 0, new Date().toISOString(), rowId, userId],
  );
  return res.changes > 0;
}

export async function updateProviderUserIdLabel(
  rowId: number, userId: number, label: string | null,
): Promise<boolean> {
  const res = await runQuery(
    'UPDATE provider_service_user_ids SET label = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [label, new Date().toISOString(), rowId, userId],
  );
  return res.changes > 0;
}
```

- [ ] **Step 2.3: Add tests to the existing test file**

Open `backend/src/__tests__/unit/localUsageRepo.test.ts` and add after the existing `describe('localUsageRepo', ...)` closing brace:

```typescript
import {
  addProviderUserId,
  listProviderUserIds,
  getProviderUserIdRow,
  removeProviderUserId,
  setProviderUserIdEnabled,
  updateProviderUserIdLabel,
} from '../../data/localUsageRepo.js';

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
```

- [ ] **Step 2.4: Run tests**

```
cd backend && npm test -- localUsageRepo
```

Expected: all tests pass (existing 5 + new 6).

- [ ] **Step 2.5: Commit**

```
git add backend/src/data/localUsageRepo.ts backend/src/__tests__/unit/localUsageRepo.test.ts
git commit -m "feat(repo): add provider_service_user_ids CRUD helpers"
```

---

### Task 3: `localUsageRepo` — replace `listUsersWithProviderServiceConfig` + add per-row sync-status helper

**Files:**
- Modify: `backend/src/data/localUsageRepo.ts`

- [ ] **Step 3.1: Add new functions at the bottom**

```typescript
export interface ActiveProviderUserIdEntry {
  user_id: number;          // tracker user id
  row: ProviderUserIdRow;
}

export async function listAllActiveProviderUserIds(): Promise<ActiveProviderUserIdEntry[]> {
  // Joins with user_provider_service_config so master-disabled entries are skipped.
  const rows = await allQuery<ProviderUserIdRow & { master_enabled: number }>(
    `SELECT psuid.*, upsc.enabled AS master_enabled
       FROM provider_service_user_ids psuid
       JOIN user_provider_service_config upsc
         ON upsc.user_id = psuid.user_id
      WHERE psuid.enabled = 1 AND upsc.enabled = 1`,
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    row: {
      id: r.id,
      user_id: r.user_id,
      provider_user_id: r.provider_user_id,
      label: r.label,
      enabled: r.enabled,
      last_sync_at: r.last_sync_at,
      last_sync_cursor: r.last_sync_cursor,
      last_sync_error: r.last_sync_error,
    },
  }));
}

export async function updateProviderUserIdSyncStatus(
  rowId: number, update: SyncStatusUpdate,
): Promise<void> {
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [new Date().toISOString()];
  if (update.last_sync_at !== undefined) {
    sets.push('last_sync_at = ?');
    params.push(update.last_sync_at);
  }
  if (update.last_sync_cursor !== undefined) {
    sets.push('last_sync_cursor = ?');
    params.push(update.last_sync_cursor);
  }
  if (update.last_sync_error !== undefined) {
    sets.push('last_sync_error = ?');
    params.push(update.last_sync_error);
  }
  params.push(rowId);
  await runQuery(
    `UPDATE provider_service_user_ids SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
}
```

- [ ] **Step 3.2: Add tests in `localUsageRepo.test.ts`**

In a new `describe('listAllActiveProviderUserIds', ...)` block:

```typescript
import {
  listAllActiveProviderUserIds,
  updateProviderUserIdSyncStatus,
} from '../../data/localUsageRepo.js';

describe('listAllActiveProviderUserIds', () => {
  it('filters by ID-enabled AND master-enabled', async () => {
    // user 101: master enabled, one row enabled, one disabled
    await upsertProviderServiceConfig(101, {
      service_url: 'x', service_token_enc: 'e', provider_user_id: 'unused-legacy', enabled: 1,
    });
    const r1 = await addProviderUserId(101, 'active-1');
    const r2 = await addProviderUserId(101, 'disabled-2');
    await setProviderUserIdEnabled(r2.id, 101, false);

    // user 102: master disabled but ID enabled
    await upsertProviderServiceConfig(102, {
      service_url: 'x', service_token_enc: 'e', provider_user_id: 'unused', enabled: 0,
    });
    await addProviderUserId(102, 'master-off-3');

    const entries = await listAllActiveProviderUserIds();
    const ids = entries.map((e) => e.row.provider_user_id).sort();
    expect(ids).toEqual(['active-1']);  // only user 101's enabled row
  });
});

describe('updateProviderUserIdSyncStatus', () => {
  it('writes cursor + clears error', async () => {
    await upsertProviderServiceConfig(101, {
      service_url: 'x', service_token_enc: 'e', provider_user_id: 'legacy', enabled: 1,
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
```

Note: `upsertProviderServiceConfig` already requires `provider_user_id` in its input (Sub-A signature). We leave that requirement for now — Task 4 will drop it. The tests pass a dummy value `'unused-legacy'` because the field is non-null in the table.

- [ ] **Step 3.3: Run tests**

```
cd backend && npm test -- localUsageRepo
```

Expected: all pass.

- [ ] **Step 3.4: Commit**

```
git add backend/src/data/localUsageRepo.ts backend/src/__tests__/unit/localUsageRepo.test.ts
git commit -m "feat(repo): add listAllActiveProviderUserIds + per-row sync status update"
```

---

### Task 4: `localUsageRepo` — drop `provider_user_id` from connection-config input

**Files:**
- Modify: `backend/src/data/localUsageRepo.ts`

- [ ] **Step 4.1: Modify `ProviderServiceConfigInput`**

Find the existing interface:

```typescript
export interface ProviderServiceConfigInput {
  service_url: string;
  service_token_enc: string;
  provider_user_id: string;
  enabled: number;
}
```

Replace with:

```typescript
export interface ProviderServiceConfigInput {
  service_url: string;
  service_token_enc: string;
  enabled: number;
}
```

- [ ] **Step 4.2: Modify `upsertProviderServiceConfig`**

The current implementation includes `provider_user_id` in the INSERT. Replace the function body so it omits that field. Since the DB column is non-null (`provider_user_id TEXT NOT NULL`), we keep writing **an empty string** for backward compatibility with the old column (which will be dropped in a later release).

```typescript
export async function upsertProviderServiceConfig(
  userId: number, input: ProviderServiceConfigInput,
): Promise<void> {
  const now = new Date().toISOString();
  await runQuery(
    `INSERT INTO user_provider_service_config
       (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       service_url = excluded.service_url,
       service_token_enc = excluded.service_token_enc,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [userId, input.service_url, input.service_token_enc, input.enabled, now, now],
  );
}
```

(Note: the `ON CONFLICT … DO UPDATE` no longer touches `provider_user_id`, so the legacy value of existing rows stays put as a rollback safety net.)

- [ ] **Step 4.3: Fix any tests that pass `provider_user_id`**

Existing tests in `localUsageRepo.test.ts` pass `provider_user_id` in upsert input. Update them to drop that field (TypeScript will flag them). Use replace_all-style sed or manually:

```
grep -n "provider_user_id:" backend/src/__tests__/unit/localUsageRepo.test.ts
```

For each line in `upsertProviderServiceConfig(...)`-calls, remove the `provider_user_id: '...'` entry.

For other repos that depend on the type, only `providerServiceSyncService.test.ts` calls `upsertProviderServiceConfig` (with the dummy value `'pu'`) — update that one too.

- [ ] **Step 4.4: TypeScript check**

```
cd backend && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors (or only the pre-existing ones unrelated to our changes).

- [ ] **Step 4.5: Run tests**

```
cd backend && npm test
```

Expected: all pass except the one pre-existing failure.

- [ ] **Step 4.6: Commit**

```
git add backend/src/data/localUsageRepo.ts backend/src/__tests__/unit/localUsageRepo.test.ts backend/src/__tests__/unit/providerServiceSyncService.test.ts
git commit -m "refactor(repo): drop provider_user_id from connection-config input"
```

---

### Task 5: `localUsageRepo` — `getLocalUsageSummary` new shape with `perSource`

**Files:**
- Modify: `backend/src/data/localUsageRepo.ts`

- [ ] **Step 5.1: Replace the `LocalUsageSummary` interface**

Find:

```typescript
export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModels: Array<{ model: string; calls: number }>;
}
```

Replace with:

```typescript
export interface SourceSummary {
  source: string;          // 'origin_app' value OR 'user:<provider_user_id>' fallback
  label: string | null;    // if source is 'user:...', the label from provider_service_user_ids
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModel: { model: string; calls: number } | null;
}

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  total: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgTokensPerCall: number;
    topModels: Array<{ model: string; calls: number }>;
  };
  perSource: SourceSummary[];
}
```

- [ ] **Step 5.2: Rewrite `getLocalUsageSummary`**

Replace the existing function with:

```typescript
export async function getLocalUsageSummary(
  userId: number, period: 'day' | 'week' | 'month',
): Promise<LocalUsageSummary> {
  const since = periodSinceISO(period);

  // 1. Total aggregates (one row)
  const agg = await getQuery<{
    calls: number; inputTokens: number; outputTokens: number;
  }>(
    `SELECT
       COUNT(*) AS calls,
       COALESCE(SUM(input_tokens), 0) AS inputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens
     FROM provider_service_events
     WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'`,
    [userId, since],
  );
  const calls = agg?.calls ?? 0;
  const inputTokens = agg?.inputTokens ?? 0;
  const outputTokens = agg?.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  const avgTokensPerCall = calls > 0 ? Math.round(totalTokens / calls) : 0;

  // 2. Top-3 overall models
  const topModels = await allQuery<{ model: string; calls: number }>(
    `SELECT model, COUNT(*) AS calls
     FROM provider_service_events
     WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'
     GROUP BY model ORDER BY calls DESC LIMIT 3`,
    [userId, since],
  );

  // 3. Per-source aggregation. Source key: origin_app OR 'user:<provider_user_id>' fallback.
  // Use SQL subquery to compute totalTokens for sorting + top-model.
  const sourceRows = await allQuery<{
    source: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
  }>(
    `SELECT
       COALESCE(origin_app, 'user:' || provider_user_id) AS source,
       COUNT(*) AS calls,
       COALESCE(SUM(input_tokens), 0) AS inputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens
     FROM provider_service_events
     WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'
     GROUP BY COALESCE(origin_app, 'user:' || provider_user_id)
     ORDER BY (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) DESC`,
    [userId, since],
  );

  // 4. For each source, fetch its top model (single SQL per source kept simple — N is small)
  // Also look up labels for sources of form 'user:<provider_user_id>'.
  const labelLookup = await allQuery<{ provider_user_id: string; label: string | null }>(
    'SELECT provider_user_id, label FROM provider_service_user_ids WHERE user_id = ?',
    [userId],
  );
  const labelMap = new Map(labelLookup.map((r) => [r.provider_user_id, r.label]));

  const perSource: SourceSummary[] = await Promise.all(
    sourceRows.map(async (s) => {
      const isUserFallback = s.source.startsWith('user:');
      const providerUserId = isUserFallback ? s.source.slice(5) : null;
      const top = await getQuery<{ model: string; calls: number }>(
        `SELECT model, COUNT(*) AS calls
         FROM provider_service_events
         WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'
           AND COALESCE(origin_app, 'user:' || provider_user_id) = ?
         GROUP BY model ORDER BY calls DESC LIMIT 1`,
        [userId, since, s.source],
      );
      const tot = s.inputTokens + s.outputTokens;
      return {
        source: s.source,
        label: providerUserId ? (labelMap.get(providerUserId) ?? null) : null,
        calls: s.calls,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        totalTokens: tot,
        avgTokensPerCall: s.calls > 0 ? Math.round(tot / s.calls) : 0,
        topModel: top ?? null,
      };
    }),
  );

  return {
    period,
    total: { calls, inputTokens, outputTokens, totalTokens, avgTokensPerCall, topModels },
    perSource,
  };
}
```

- [ ] **Step 5.3: Update existing test for `getLocalUsageSummary`**

In `backend/src/__tests__/unit/localUsageRepo.test.ts`, find the existing test:

```typescript
it('getLocalUsageSummary aggregates tokens and counts by period', async () => {
```

Replace it to use the new shape:

```typescript
it('getLocalUsageSummary aggregates by total and perSource', async () => {
  const now = new Date();
  const inMonth = new Date(now.getFullYear(), now.getMonth(), 15, 12).toISOString();
  // Event A: origin_app='bewerbungstracker'
  await insertEventIfNew(101, {
    remote_event_id: 1, remote_created_at: inMonth,
    provider_id: 'ollama', model: 'llama3.1:8b',
    input_tokens: 100, output_tokens: 50, cost_usd: 0,
    origin_app: 'bewerbungstracker', status: 'success', error_message: null,
  });
  // Event B: origin_app=null → fallback bucket 'user:wolfini_de_web'
  await insertEventIfNew(101, {
    remote_event_id: 2, remote_created_at: inMonth,
    provider_id: 'ollama', model: 'llama3.1:8b',
    input_tokens: 200, output_tokens: 100, cost_usd: 0,
    origin_app: null, status: 'success', error_message: null,
  });
  // Manually attach a provider_user_id to the event for the fallback bucket
  // (insertEventIfNew accepts no provider_user_id field — we need to set it via raw SQL,
  // because Sub-A's provider_service_events table has it as a column populated from upstream)
  await runQuery(
    `UPDATE provider_service_events SET provider_user_id = ? WHERE user_id = 101 AND remote_event_id = 2`,
    ['wolfini_de_web'],
  );
  // Also set provider_user_id for event 1 (so source key is unambiguous)
  await runQuery(
    `UPDATE provider_service_events SET provider_user_id = ? WHERE user_id = 101 AND remote_event_id = 1`,
    ['03bd2c3d-...'],
  );

  // Add a label for the fallback id
  await addProviderUserId(101, 'wolfini_de_web', 'WordPress');

  const s = await getLocalUsageSummary(101, 'month');
  expect(s.total.calls).toBe(2);
  expect(s.total.totalTokens).toBe(450);

  expect(s.perSource).toHaveLength(2);
  // perSource ordered by totalTokens DESC
  expect(s.perSource[0].source).toBe('user:wolfini_de_web');
  expect(s.perSource[0].label).toBe('WordPress');
  expect(s.perSource[0].totalTokens).toBe(300);
  expect(s.perSource[1].source).toBe('bewerbungstracker');
  expect(s.perSource[1].label).toBeNull();
});
```

Wait — `provider_service_events` doesn't yet have a `provider_user_id` column. Looking at Sub-A's spec (table definition), it's not there. We need to add it, because without it we can't do the fallback. Let's add it as a schema change here.

- [ ] **Step 5.4: Add `provider_user_id` column to `provider_service_events`**

Edit `backend/src/database/sqlite.ts`. In the existing block that creates `provider_service_events`, add the `provider_user_id` column. Since the table already exists in production via Sub-A, we ALSO need an `addMissingColumns` call after the index creates (and update the CREATE TABLE for fresh deploys).

In the CREATE TABLE block, add:

```typescript
provider_user_id  TEXT,           -- NEW (Sub-A.1): used for source-key fallback when origin_app is NULL
```

Insert this column right after `output_tokens INTEGER,`.

For existing deployments, after the index creates and BEFORE the new table creation from Task 1, add:

```typescript
await addMissingColumns('provider_service_events', [
  { name: 'provider_user_id', ddl: 'TEXT' },
]);
```

- [ ] **Step 5.5: Update `insertEventIfNew` to write `provider_user_id`**

In `localUsageRepo.ts`, find `RemoteEvent` interface and add field:

```typescript
export interface RemoteEvent {
  remote_event_id: number;
  remote_created_at: string;
  provider_id: string;
  model: string;
  provider_user_id: string;   // NEW: the user_id this event came from in the provider-service
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  origin_app: string | null;
  status: string;
  error_message: string | null;
}
```

Update `insertEventIfNew` body to include the new column:

```typescript
const result = await runQuery(
  `INSERT OR IGNORE INTO provider_service_events
    (user_id, remote_event_id, remote_created_at, provider_id, model, provider_user_id,
     input_tokens, output_tokens, cost_usd, origin_app, status, error_message, ingested_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    userId, ev.remote_event_id, ev.remote_created_at, ev.provider_id, ev.model, ev.provider_user_id,
    ev.input_tokens, ev.output_tokens, ev.cost_usd, ev.origin_app, ev.status,
    ev.error_message, new Date().toISOString(),
  ],
);
return result.changes > 0;
```

- [ ] **Step 5.6: Fix all test callers of `insertEventIfNew`**

`grep -rn "insertEventIfNew" backend/src/__tests__/` — update each test event to include `provider_user_id: '<some-id>'`. There's `localUsageRepo.test.ts` (multiple) and `providerServiceSyncService.test.ts` (one).

- [ ] **Step 5.7: Run tests**

```
cd backend && npm test -- localUsageRepo
```

Expected: all pass. Pay specific attention to the perSource test — it should see the 2 buckets ordered by totalTokens DESC.

- [ ] **Step 5.8: Commit**

```
git add backend/src/data/localUsageRepo.ts backend/src/database/sqlite.ts backend/src/__tests__/unit/localUsageRepo.test.ts
git commit -m "feat(repo): perSource aggregation + provider_user_id column on events"
```

---

## Phase 3 — Backend Sync

### Task 6: `providerServiceSyncService` — iterate over multiple IDs

**Files:**
- Modify: `backend/src/services/providerServiceSyncService.ts`
- Modify: `backend/src/__tests__/unit/providerServiceSyncService.test.ts`

- [ ] **Step 6.1: Replace `SyncResult` and rewrite `syncProviderServiceEvents`**

Replace the entire `providerServiceSyncService.ts` body (keep imports, add new ones):

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import {
  getProviderServiceConfig,
  insertEventIfNew,
  listProviderUserIds,
  updateProviderUserIdSyncStatus,
  type RemoteEvent,
  type ProviderUserIdRow,
} from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';

export interface PerIdResult {
  providerUserId: string;
  ok: boolean;
  newEvents: number;
  error?: string;
}

export interface SyncResult {
  ok: boolean;          // true when ALL ids ok
  newEvents: number;    // summed across ids
  perId: PerIdResult[];
}

interface RemoteEventDto {
  id: number;
  created_at: string;
  provider_id: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  origin_app: string | null;
  status: string;
  error_message: string | null;
}

interface RemotePage {
  events: RemoteEventDto[];
  count: number;
  next_since: string | null;
  has_more: boolean;
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 50;

async function syncOneId(
  userId: number,
  serviceUrl: string,
  token: string,
  idRow: ProviderUserIdRow,
): Promise<PerIdResult> {
  let cursor: string | null = idRow.last_sync_cursor;
  let totalNew = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL('/usage/events', serviceUrl);
      url.searchParams.set('user_id', idRow.provider_user_id);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('since', cursor);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RemotePage;

      for (const ev of data.events) {
        const row: RemoteEvent = {
          remote_event_id: ev.id,
          remote_created_at: ev.created_at,
          provider_id: ev.provider_id,
          model: ev.model,
          provider_user_id: idRow.provider_user_id,
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cost_usd: ev.cost_usd,
          origin_app: ev.origin_app,
          status: ev.status,
          error_message: ev.error_message,
        };
        if (await insertEventIfNew(userId, row)) totalNew++;
      }

      cursor = data.next_since ?? cursor;
      if (!data.has_more) break;
    }

    await updateProviderUserIdSyncStatus(idRow.id, {
      last_sync_at: new Date().toISOString(),
      last_sync_cursor: cursor,
      last_sync_error: null,
    });
    return { providerUserId: idRow.provider_user_id, ok: true, newEvents: totalNew };
  } catch (e) {
    const msg = (e as Error).message;
    await updateProviderUserIdSyncStatus(idRow.id, { last_sync_error: msg });
    return { providerUserId: idRow.provider_user_id, ok: false, newEvents: totalNew, error: msg };
  }
}

export async function syncProviderServiceEvents(userId: number): Promise<SyncResult> {
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) {
    return { ok: true, newEvents: 0, perId: [] };
  }

  let token: string;
  try {
    token = decryptSecret(cfg.service_token_enc);
  } catch (e) {
    // No specific id to attach this to — record on all enabled ids for visibility.
    const ids = (await listProviderUserIds(userId)).filter((r) => r.enabled === 1);
    const msg = `decrypt failed: ${(e as Error).message}`;
    await Promise.all(ids.map((r) => updateProviderUserIdSyncStatus(r.id, { last_sync_error: msg })));
    return {
      ok: false,
      newEvents: 0,
      perId: ids.map((r) => ({ providerUserId: r.provider_user_id, ok: false, newEvents: 0, error: msg })),
    };
  }

  const ids = (await listProviderUserIds(userId)).filter((r) => r.enabled === 1);
  const perId: PerIdResult[] = [];
  for (const idRow of ids) {
    perId.push(await syncOneId(userId, cfg.service_url, token, idRow));
  }
  return {
    ok: perId.every((r) => r.ok),
    newEvents: perId.reduce((sum, r) => sum + r.newEvents, 0),
    perId,
  };
}
```

- [ ] **Step 6.2: Rewrite the sync service test**

Open `backend/src/__tests__/unit/providerServiceSyncService.test.ts`. The existing `beforeEach` sets up one config with a single `provider_user_id` — we need to update it to use the new `provider_service_user_ids` table.

Replace the `beforeEach` body that sets up the config with:

```typescript
beforeEach(async () => {
  await upsertProviderServiceConfig(201, {
    service_url: 'http://test-service:8767',
    service_token_enc: encryptSecret('test-token'),
    enabled: 1,
  });
  // Add ONE provider_user_id ('pu') to mirror Sub-A's single-ID setup so existing
  // assertions about cursors/errors still make sense.
  await addProviderUserId(201, 'pu');
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});
```

Add `addProviderUserId` to the imports at the top:

```typescript
const {
  upsertProviderServiceConfig,
  insertEventIfNew,
  listProviderUserIds,
  addProviderUserId,
} = await import('../../data/localUsageRepo.js');
```

Update each test that asserts `cfg?.last_sync_cursor` — those now look at the row in `provider_service_user_ids`, not in `user_provider_service_config`. Use `listProviderUserIds(201)` and check `rows[0].last_sync_cursor`:

For "pulls events in a single page and inserts them":

```typescript
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
  expect(result.perId).toHaveLength(1);
  expect(result.perId[0].providerUserId).toBe('pu');

  const ids = await listProviderUserIds(201);
  expect(ids[0].last_sync_cursor).toBe('2026-05-01T12:00:00');
  expect(ids[0].last_sync_error).toBeNull();
});
```

For "records last_sync_error on HTTP failure":

```typescript
it('records last_sync_error on HTTP failure', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
  const result = await syncProviderServiceEvents(201);
  expect(result.ok).toBe(false);
  expect(result.perId[0].error).toMatch(/401/);

  const ids = await listProviderUserIds(201);
  expect(ids[0].last_sync_error).toMatch(/401/);
});
```

For "returns ok with 0 events when disabled":

```typescript
it('returns ok with 0 events when master disabled', async () => {
  await runQuery('UPDATE user_provider_service_config SET enabled = 0 WHERE user_id = 201');
  const result = await syncProviderServiceEvents(201);
  expect(result.ok).toBe(true);
  expect(result.newEvents).toBe(0);
  expect(result.perId).toHaveLength(0);
  expect(fetchMock).not.toHaveBeenCalled();
});
```

Add a NEW test:

```typescript
it('iterates over multiple active ids — one ok, one 401', async () => {
  await addProviderUserId(201, 'pu-2');
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [makeEvent(1, '2026-05-01T12:00:00')],
        count: 1, next_since: '2026-05-01T12:00:00', has_more: false,
      }),
    })
    .mockResolvedValueOnce({ ok: false, status: 401 });

  const result = await syncProviderServiceEvents(201);
  expect(result.ok).toBe(false);
  expect(result.newEvents).toBe(1);
  expect(result.perId).toHaveLength(2);
  expect(result.perId[0].ok).toBe(true);
  expect(result.perId[1].ok).toBe(false);
  expect(result.perId[1].error).toMatch(/401/);
});
```

The "idempotent" test should still work since the in-place `insertEventIfNew(201, ...)` was kept compatible:

```typescript
it('is idempotent — re-sync with same events inserts zero new', async () => {
  await insertEventIfNew(201, {
    remote_event_id: 1, remote_created_at: '2026-05-01T12:00:00',
    provider_id: 'ollama', model: 'm', provider_user_id: 'pu',
    input_tokens: 1, output_tokens: 1, cost_usd: 0,
    origin_app: null, status: 'success', error_message: null,
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
```

For "sends bearer token and user_id in request":

```typescript
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
```

- [ ] **Step 6.3: Run tests**

```
cd backend && npm test -- providerServiceSyncService
```

Expected: all pass (the original 5 minus the one we removed + 1 new = 6).

- [ ] **Step 6.4: Commit**

```
git add backend/src/services/providerServiceSyncService.ts backend/src/__tests__/unit/providerServiceSyncService.test.ts
git commit -m "feat(sync): iterate over multiple provider_user_ids per tracker-user"
```

---

## Phase 4 — Backend Routes

### Task 7: Controller refactor + new endpoints

**Files:**
- Modify: `backend/src/controllers/localUsageController.ts`
- Modify: `backend/src/routes/localUsage.ts`

- [ ] **Step 7.1: Refactor controller**

Replace the entire contents of `backend/src/controllers/localUsageController.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  getLocalUsageSummary,
  listProviderUserIds,
  addProviderUserId,
  removeProviderUserId,
  setProviderUserIdEnabled,
  updateProviderUserIdLabel,
  getProviderUserIdRow,
} from '../data/localUsageRepo.js';
import { encryptSecret } from '../utils/secretCrypto.js';
import { syncProviderServiceEvents } from '../services/providerServiceSyncService.js';

function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test((e as Error).message ?? '');
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const period = (req.query.period as string) ?? 'month';
  if (period !== 'day' && period !== 'week' && period !== 'month') {
    res.status(400).json({ error: 'invalid period' });
    return;
  }
  const summary = await getLocalUsageSummary(userId, period);
  res.json(summary);
}

export async function getSyncStatus(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  const ids = await listProviderUserIds(userId);
  const lastSyncAt = ids
    .map((r) => r.last_sync_at)
    .filter((v): v is string => v != null)
    .sort()
    .at(-1) ?? null;
  const anyError = ids.find((r) => r.last_sync_error != null);
  res.json({
    configured: true,
    enabled: cfg.enabled === 1,
    last_sync_at: lastSyncAt,
    last_sync_error: anyError?.last_sync_error ?? null,
    perId: ids.map((r) => ({
      id: r.id,
      provider_user_id: r.provider_user_id,
      label: r.label,
      enabled: r.enabled === 1,
      last_sync_at: r.last_sync_at,
      last_sync_error: r.last_sync_error,
    })),
  });
}

export async function triggerSync(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await syncProviderServiceEvents(userId);
  res.json(result);
}

export async function getConfig(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg) {
    res.json({ configured: false, user_ids: [] });
    return;
  }
  const ids = await listProviderUserIds(userId);
  res.json({
    configured: true,
    service_url: cfg.service_url,
    service_token_set: true,
    enabled: cfg.enabled === 1,
    user_ids: ids.map((r) => ({
      id: r.id,
      provider_user_id: r.provider_user_id,
      label: r.label,
      enabled: r.enabled === 1,
      last_sync_at: r.last_sync_at,
      last_sync_error: r.last_sync_error,
    })),
  });
}

export async function putConfig(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as {
    service_url?: unknown;
    service_token?: unknown;
    enabled?: unknown;
  };
  if (typeof body.service_url !== 'string' || !body.service_url.trim()) {
    res.status(400).json({ error: 'service_url required' });
    return;
  }
  const existing = await getProviderServiceConfig(userId);
  let tokenEnc: string;
  if (typeof body.service_token === 'string' && body.service_token.length > 0) {
    tokenEnc = encryptSecret(body.service_token);
  } else if (existing) {
    tokenEnc = existing.service_token_enc;
  } else {
    res.status(400).json({ error: 'service_token required on first save' });
    return;
  }
  await upsertProviderServiceConfig(userId, {
    service_url: body.service_url.trim(),
    service_token_enc: tokenEnc,
    enabled: body.enabled === false ? 0 : 1,
  });
  res.json({ ok: true });
}

// ---- NEW: user-ids CRUD ----

export async function postUserId(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as { provider_user_id?: unknown; label?: unknown };
  if (typeof body.provider_user_id !== 'string' || !body.provider_user_id.trim()) {
    res.status(400).json({ error: 'provider_user_id required' });
    return;
  }
  const label =
    typeof body.label === 'string' && body.label.trim().length > 0
      ? body.label.trim()
      : null;
  try {
    const row = await addProviderUserId(userId, body.provider_user_id.trim(), label);
    res.json({
      id: row.id,
      provider_user_id: row.provider_user_id,
      label: row.label,
      enabled: row.enabled === 1,
      last_sync_at: row.last_sync_at,
      last_sync_error: row.last_sync_error,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: 'already configured' });
      return;
    }
    throw e;
  }
}

export async function deleteUserId(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const rowId = Number(req.params.id);
  if (!Number.isFinite(rowId)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const removed = await removeProviderUserId(rowId, userId);
  if (!removed) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
}

export async function patchUserId(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const rowId = Number(req.params.id);
  if (!Number.isFinite(rowId)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const body = (req.body ?? {}) as { label?: unknown; enabled?: unknown };
  let changed = false;
  if (typeof body.label === 'string' || body.label === null) {
    const label = body.label === null
      ? null
      : (body.label as string).trim().length > 0
        ? (body.label as string).trim()
        : null;
    const ok = await updateProviderUserIdLabel(rowId, userId, label);
    if (!ok) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    changed = true;
  }
  if (typeof body.enabled === 'boolean') {
    const ok = await setProviderUserIdEnabled(rowId, userId, body.enabled);
    if (!ok && !changed) {
      res.status(404).json({ error: 'not found' });
      return;
    }
  }
  const fresh = await getProviderUserIdRow(rowId, userId);
  if (!fresh) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({
    id: fresh.id,
    provider_user_id: fresh.provider_user_id,
    label: fresh.label,
    enabled: fresh.enabled === 1,
    last_sync_at: fresh.last_sync_at,
    last_sync_error: fresh.last_sync_error,
  });
}
```

- [ ] **Step 7.2: Add new routes to `localUsage.ts`**

Replace the contents of `backend/src/routes/localUsage.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getSummary, getSyncStatus, triggerSync, getConfig, putConfig,
  postUserId, deleteUserId, patchUserId,
} from '../controllers/localUsageController.js';

const router = Router();
router.use(requireUser);
router.get('/summary', getSummary);
router.get('/sync-status', getSyncStatus);
router.post('/sync', triggerSync);
router.get('/config', getConfig);
router.put('/config', putConfig);
router.post('/user-ids', postUserId);
router.delete('/user-ids/:id', deleteUserId);
router.patch('/user-ids/:id', patchUserId);
export default router;
```

- [ ] **Step 7.3: TypeScript check + tests**

```
cd backend && npx tsc --noEmit 2>&1 | head -10
npm test 2>&1 | tail -8
```

Expected: TS clean, all tests pass (minus the one pre-existing failure).

- [ ] **Step 7.4: Commit**

```
git add backend/src/controllers/localUsageController.ts backend/src/routes/localUsage.ts
git commit -m "feat(api): add user-ids CRUD endpoints + adjust config/sync-status for multi-id"
```

---

### Task 8: Cron-Hook on new helper

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 8.1: Replace cron tick body**

Find the existing block:

```typescript
async function runProviderServiceSyncTick(): Promise<void> {
  const users = await listUsersWithProviderServiceConfig();
  for (const u of users) {
    try {
      const r = await syncProviderServiceEvents(u.user_id);
      if (r.newEvents > 0) {
        console.log(`[provider-service-sync] user=${u.user_id} new=${r.newEvents}`);
      }
      if (!r.ok) {
        console.warn(`[provider-service-sync] user=${u.user_id} error=${r.error}`);
      }
    } catch (err) {
      console.error('[provider-service-sync] unexpected', u.user_id, err);
    }
  }
}
```

Replace with:

```typescript
async function runProviderServiceSyncTick(): Promise<void> {
  // List all *active* (master+ID) provider_user_ids across all users. Group by
  // tracker-user-id so the sync function (which iterates IDs internally) is
  // called once per tracker-user.
  const active = await listAllActiveProviderUserIds();
  const userIds = Array.from(new Set(active.map((a) => a.user_id)));
  for (const uid of userIds) {
    try {
      const r = await syncProviderServiceEvents(uid);
      for (const p of r.perId) {
        if (p.newEvents > 0) {
          console.log(`[provider-service-sync] user=${uid} providerUserId=${p.providerUserId} new=${p.newEvents}`);
        }
        if (!p.ok) {
          console.warn(`[provider-service-sync] user=${uid} providerUserId=${p.providerUserId} error=${p.error}`);
        }
      }
    } catch (err) {
      console.error('[provider-service-sync] unexpected', uid, err);
    }
  }
}
```

- [ ] **Step 8.2: Fix the imports at top of `server.ts`**

Change:

```typescript
import { listUsersWithProviderServiceConfig } from './data/localUsageRepo.js';
```

to:

```typescript
import { listAllActiveProviderUserIds } from './data/localUsageRepo.js';
```

- [ ] **Step 8.3: TypeScript check + boot smoke**

```
cd backend && npx tsc --noEmit 2>&1 | head -5
# Boot smoke (terminates after a few seconds via the same pattern from Sub-A)
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=:memory: PORT=3098 npx tsx src/server.ts > /tmp/cron-smoke.log 2>&1 &
SERVER_PID=$!
sleep 3
grep -E "Provider-service sync scheduled|error" /tmp/cron-smoke.log | head -5
kill $SERVER_PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/cron-smoke.log
```

Expected: log shows "Provider-service sync scheduled every 15 minutes", no errors.

- [ ] **Step 8.4: Commit**

```
git add backend/src/server.ts
git commit -m "feat(cron): switch sync tick to listAllActiveProviderUserIds"
```

---

## Phase 5 — Frontend

### Task 9: `localUsageApi.ts` — new types + functions

**Files:**
- Modify: `frontend/src/services/localUsageApi.ts`

- [ ] **Step 9.1: Replace types and add new functions**

Replace the full contents of `frontend/src/services/localUsageApi.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { apiCall } from './api';

export interface ProviderUserIdRow {
  id: number;
  provider_user_id: string;
  label: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface SourceSummary {
  source: string;          // 'origin_app' value OR 'user:<provider_user_id>' fallback
  label: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModel: { model: string; calls: number } | null;
}

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  total: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgTokensPerCall: number;
    topModels: Array<{ model: string; calls: number }>;
  };
  perSource: SourceSummary[];
}

export interface PerIdStatus {
  id: number;
  provider_user_id: string;
  label: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface SyncStatus {
  configured: boolean;
  enabled?: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  perId?: PerIdStatus[];
}

export interface ProviderServiceConfig {
  configured: boolean;
  service_url?: string;
  service_token_set?: boolean;
  enabled?: boolean;
  user_ids: ProviderUserIdRow[];
}

export interface ProviderServiceConfigInput {
  service_url: string;
  service_token?: string;
  enabled: boolean;
}

export interface PerIdResult {
  providerUserId: string;
  ok: boolean;
  newEvents: number;
  error?: string;
}

export interface SyncTriggerResult {
  ok: boolean;
  newEvents: number;
  perId: PerIdResult[];
}

export function getLocalUsageSummary(
  period: 'day' | 'week' | 'month' = 'month',
): Promise<LocalUsageSummary> {
  return apiCall<LocalUsageSummary>(`/local-usage/summary?period=${period}`);
}

export function getLocalUsageSyncStatus(): Promise<SyncStatus> {
  return apiCall<SyncStatus>('/local-usage/sync-status');
}

export function triggerLocalUsageSync(): Promise<SyncTriggerResult> {
  return apiCall<SyncTriggerResult>('/local-usage/sync', { method: 'POST' });
}

export function getProviderServiceConfig(): Promise<ProviderServiceConfig> {
  return apiCall<ProviderServiceConfig>('/local-usage/config');
}

export function updateProviderServiceConfig(
  cfg: ProviderServiceConfigInput,
): Promise<{ ok: boolean }> {
  return apiCall<{ ok: boolean }>('/local-usage/config', {
    method: 'PUT', body: JSON.stringify(cfg),
  });
}

export function addProviderUserId(
  input: { provider_user_id: string; label?: string },
): Promise<ProviderUserIdRow> {
  return apiCall<ProviderUserIdRow>('/local-usage/user-ids', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function removeProviderUserId(id: number): Promise<{ ok: boolean }> {
  return apiCall<{ ok: boolean }>(`/local-usage/user-ids/${id}`, { method: 'DELETE' });
}

export function updateProviderUserId(
  id: number, patch: { label?: string | null; enabled?: boolean },
): Promise<ProviderUserIdRow> {
  return apiCall<ProviderUserIdRow>(`/local-usage/user-ids/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 9.2: TypeScript check**

```
cd frontend && npx tsc --noEmit 2>&1 | grep -E "localUsage|providerService" | head -5
```

Expected: no errors. (Some pre-existing test-file errors are unrelated.)

- [ ] **Step 9.3: Commit**

```
git add frontend/src/services/localUsageApi.ts
git commit -m "feat(frontend-api): new types + endpoints for multi-source tracking"
```

---

### Task 10: `ProviderServiceSettings` — Connection-Config + IDs-List

**Files:**
- Modify: `frontend/src/components/settings/ProviderServiceSettings.tsx`

- [ ] **Step 10.1: Replace the component file entirely**

Replace the full contents of `frontend/src/components/settings/ProviderServiceSettings.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getProviderServiceConfig,
  updateProviderServiceConfig,
  triggerLocalUsageSync,
  addProviderUserId,
  removeProviderUserId,
  updateProviderUserId,
  type ProviderServiceConfig,
  type ProviderUserIdRow,
} from '../../services/localUsageApi';

export default function ProviderServiceSettings(): React.ReactElement {
  const [cfg, setCfg] = useState<ProviderServiceConfig | null>(null);
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceToken, setServiceToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Add-form state
  const [newIdInput, setNewIdInput] = useState('');
  const [newLabelInput, setNewLabelInput] = useState('');
  const [addingId, setAddingId] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    const c = await getProviderServiceConfig();
    setCfg(c);
    if (c.configured) {
      setServiceUrl(c.service_url ?? '');
      setEnabled(c.enabled ?? true);
    }
  }

  async function handleSaveConnection(): Promise<void> {
    setSaving(true);
    setFeedback(null);
    try {
      await updateProviderServiceConfig({
        service_url: serviceUrl.trim(),
        service_token: serviceToken || undefined,
        enabled,
      });
      setServiceToken('');
      await reload();
      setFeedback('Gespeichert ✓');
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setFeedback(null);
    try {
      const r = await triggerLocalUsageSync();
      if (r.ok) {
        setFeedback(`Verbindung ok — ${r.newEvents} neue Events erhalten.`);
      } else {
        const failedIds = r.perId.filter((p) => !p.ok).map((p) => p.providerUserId).join(', ');
        setFeedback(`Teilweise fehlgeschlagen: ${failedIds}`);
      }
      await reload();
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleAddId(): Promise<void> {
    if (!newIdInput.trim()) return;
    setAddingId(true);
    setAddError(null);
    try {
      await addProviderUserId({
        provider_user_id: newIdInput.trim(),
        label: newLabelInput.trim() || undefined,
      });
      setNewIdInput('');
      setNewLabelInput('');
      await reload();
    } catch (e) {
      const msg = (e as Error).message;
      setAddError(/409/.test(msg) ? 'Bereits konfiguriert.' : `Fehler: ${msg}`);
    } finally {
      setAddingId(false);
    }
  }

  async function handleDeleteId(row: ProviderUserIdRow): Promise<void> {
    if (!confirm(`user_id "${row.provider_user_id}" wirklich entfernen?`)) return;
    await removeProviderUserId(row.id);
    await reload();
  }

  async function handlePatchId(
    row: ProviderUserIdRow, patch: { label?: string | null; enabled?: boolean },
  ): Promise<void> {
    await updateProviderUserId(row.id, patch);
    await reload();
  }

  return (
    <section className="bg-white rounded-lg shadow p-4 mb-4">
      <h2 className="text-lg font-semibold mb-3">AI-Provider-Service</h2>
      <p className="text-xs text-gray-500 mb-3">
        Verbinde diesen Tracker mit deinem `ai-provider-service`, um lokale
        LLM-Aufrufe sichtbar zu machen.
      </p>

      {/* ----- Connection ----- */}
      <div className="space-y-3 mb-6">
        <h3 className="text-sm font-medium text-gray-700">Verbindung</h3>
        <div>
          <label className="block text-sm font-medium mb-1">Service-URL</label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="https://bewerbungen.wolfinisoftware.de/ai-provider"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Service-Token{' '}
            {cfg?.service_token_set && (
              <span className="text-gray-500 font-normal">
                (gesetzt — leer lassen zum Beibehalten)
              </span>
            )}
          </label>
          <input
            type="password"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceToken}
            onChange={(e) => setServiceToken(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Aktiv
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleSaveConnection}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !cfg?.configured}
            className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            {testing ? 'Teste…' : 'Verbindung testen'}
          </button>
        </div>
        {feedback && <div className="text-sm text-gray-700">{feedback}</div>}
      </div>

      {/* ----- user_ids list ----- */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Verbundene user_ids</h3>

        {/* Add form */}
        <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="provider_user_id"
              className="flex-1 border rounded px-2 py-1 text-sm font-mono"
              value={newIdInput}
              onChange={(e) => setNewIdInput(e.target.value)}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              className="flex-1 border rounded px-2 py-1 text-sm"
              value={newLabelInput}
              onChange={(e) => setNewLabelInput(e.target.value)}
            />
            <button
              onClick={handleAddId}
              disabled={addingId || !newIdInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
            >
              + Hinzufügen
            </button>
          </div>
          {addError && (
            <div className="mt-2 text-red-700 text-xs">{addError}</div>
          )}
        </div>

        {/* Existing IDs */}
        {cfg?.user_ids?.length === 0 && (
          <p className="text-sm text-gray-500 italic">
            Noch keine user_ids konfiguriert.
          </p>
        )}
        <ul className="space-y-2">
          {cfg?.user_ids?.map((row) => (
            <li key={row.id} className="border border-gray-200 rounded p-3 bg-white">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <input
                    type="text"
                    placeholder="Label"
                    className="w-full border rounded px-2 py-1 text-sm"
                    defaultValue={row.label ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (row.label ?? '')) {
                        void handlePatchId(row, { label: v.length > 0 ? v : null });
                      }
                    }}
                  />
                  <div className="text-xs font-mono text-gray-500">
                    {row.provider_user_id}
                  </div>
                  <div className="text-xs text-gray-500">
                    Letzter Sync: {row.last_sync_at ?? '—'}
                  </div>
                  {row.last_sync_error && (
                    <div className="text-xs text-red-600">
                      Fehler: {row.last_sync_error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        void handlePatchId(row, { enabled: e.target.checked })
                      }
                    />
                    Aktiv
                  </label>
                  <button
                    onClick={() => void handleDeleteId(row)}
                    className="text-red-600 hover:text-red-700 text-xs"
                    aria-label="Entfernen"
                  >
                    Entfernen
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 10.2: TypeScript check + Vite build**

```
cd frontend && npx tsc --noEmit 2>&1 | grep -E "ProviderService|localUsageApi" | head
npx vite build 2>&1 | tail -5
```

Expected: no related errors, build succeeds.

- [ ] **Step 10.3: Commit**

```
git add frontend/src/components/settings/ProviderServiceSettings.tsx
git commit -m "feat(frontend): two-section settings — connection + user_ids list"
```

---

### Task 11: `LocalUsageCard` — Multi-Card-Rendering

**Files:**
- Modify: `frontend/src/components/LocalUsageCard.tsx`

- [ ] **Step 11.1: Replace the component file entirely**

Replace the full contents of `frontend/src/components/LocalUsageCard.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getLocalUsageSummary,
  getLocalUsageSyncStatus,
  type LocalUsageSummary,
  type SyncStatus,
  type SourceSummary,
} from '../services/localUsageApi';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

// For sources of the form 'user:<provider_user_id>', return the matching
// per-id last_sync_error so we can render it inside that mini-card.
function syncErrorForSource(source: SourceSummary, status: SyncStatus | null): string | null {
  if (!status?.perId) return null;
  if (!source.source.startsWith('user:')) return null;
  const providerUserId = source.source.slice(5);
  const match = status.perId.find((p) => p.provider_user_id === providerUserId);
  return match?.last_sync_error ?? null;
}

function MiniCard({
  source, syncError,
}: { source: SourceSummary; syncError: string | null }): React.ReactElement {
  const isUserFallback = source.source.startsWith('user:');
  const displayLabel = source.label
    ?? (isUserFallback ? source.source.slice(5) : source.source);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">
        {displayLabel}
      </div>
      {syncError && (
        <div className="mt-2 bg-red-50 border border-red-200 text-red-800 text-xs p-2 rounded">
          Sync-Fehler: {syncError}
        </div>
      )}
      <div className="mt-2 text-2xl font-bold text-blue-600">
        {formatNumber(source.totalTokens)}
        <span className="text-sm font-normal text-gray-700 ml-1">Tokens</span>
      </div>
      <div className="mt-1 text-xs text-gray-600">
        In: {formatNumber(source.inputTokens)} · Out: {formatNumber(source.outputTokens)}
      </div>
      <div className="mt-1 text-xs text-gray-600">
        {formatNumber(source.calls)} Calls · ⌀ {formatNumber(source.avgTokensPerCall)} Tok/Call
      </div>
      {source.topModel && (
        <div className="mt-2 text-xs text-gray-700">
          <span className="font-mono">{source.topModel.model}</span>{' '}
          <span className="text-gray-500">· {formatNumber(source.topModel.calls)} Calls</span>
        </div>
      )}
    </div>
  );
}

export default function LocalUsageCard(): React.ReactElement {
  const [summary, setSummary] = useState<LocalUsageSummary | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      getLocalUsageSummary('month'),
      getLocalUsageSyncStatus(),
    ])
      .then(([s, st]) => {
        setSummary(s);
        setStatus(st);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-gray-400 text-sm">Lade Lokale LLM-Nutzung…</div>
      </div>
    );
  }

  if (!status || !status.configured) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
          <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">provider-service</span>
        </div>
        <p className="text-sm text-gray-600">
          Noch keine Daten —{' '}
          <a href="/claudetracker/settings" className="text-blue-600 underline">
            konfiguriere den AI-Provider-Service in den Einstellungen
          </a>
          .
        </p>
      </div>
    );
  }

  // Configured but no events yet
  const hasSources = summary && summary.perSource.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
          provider-service
        </span>
      </div>

      {!hasSources ? (
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Noch keine Calls in diesem Monat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {summary!.perSource.map((s) => (
            <MiniCard
              key={s.source}
              source={s}
              syncError={syncErrorForSource(s, status)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 11.2: TypeScript check + Vite build**

```
cd frontend && npx tsc --noEmit 2>&1 | grep -E "LocalUsageCard|localUsageApi" | head
npx vite build 2>&1 | tail -5
```

Expected: no related errors, build succeeds with the new bundle.

- [ ] **Step 11.3: Commit**

```
git add frontend/src/components/LocalUsageCard.tsx
git commit -m "feat(frontend): LocalUsageCard renders one mini-card per perSource"
```

---

## Phase 6 — End-to-End Smoke

### Task 12: Run full smoke test locally before deploy

- [ ] **Step 12.1: Build dist**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npm run build
```

- [ ] **Step 12.2: Run all backend tests**

```
npm test 2>&1 | tail -5
```

Expected: every suite green except the one pre-existing auth-flow failure.

- [ ] **Step 12.3: Migration smoke on a fresh DB**

```
rm -f /tmp/sub-a1-smoke.sqlite
node --input-type=module -e "
process.env.DATABASE_PATH = '/tmp/sub-a1-smoke.sqlite';
const { initDatabase, runQuery, allQuery } = await import('./dist/database/sqlite.js');
await initDatabase();
await runQuery('INSERT OR IGNORE INTO users (id, email) VALUES (1, ?)', ['m@x.com']);
await runQuery(\`INSERT INTO user_provider_service_config (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at) VALUES (1, 'http://x', 'enc', 'sub-a-id', 1, datetime('now'), datetime('now'))\`);
await initDatabase();
const rows = await allQuery('SELECT user_id, provider_user_id FROM provider_service_user_ids');
console.log(JSON.stringify(rows));
" 2>&1
rm -f /tmp/sub-a1-smoke.sqlite
```

Expected: `[{"user_id":1,"provider_user_id":"sub-a-id"}]`

- [ ] **Step 12.4: Frontend build**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npm run build 2>&1 | tail -3
```

Expected: dist build OK, no errors.

- [ ] **Step 12.5: Visual smoke (manual)**

Start dev mode in two terminals:

```
# T1: backend
cd backend
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  npm run dev
# T2: frontend
cd frontend
npm run dev
```

In browser at `http://localhost:5173`:
1. Open Settings → AI-Provider-Service → see two-section layout
2. Add a `provider_user_id` ("test-id-1") with label "Test"
3. Try to add the same again → "Bereits konfiguriert."
4. Toggle Aktiv off → row updates
5. Delete the row → confirm → list updates
6. Open Overview → either Empty-State or Mini-Cards depending on data

If any step fails, debug before moving on.

- [ ] **Step 12.6: Final commit chain — check no leftover files**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d"
git status
```

Expected: clean (or only intentional uncommitted files). If untracked test artifacts, remove them.

---

### Task 13: Production Deploy

Follows the same playbook used for Sub-Projekt A. **All steps must be approved by the user explicitly before being executed against the VPS.**

- [ ] **Step 13.1: Merge to local main + push**

```
cd "/Library/WebServer/Documents/KI Usage tracker"
git fetch origin main
git checkout main
git merge --ff-only claude/priceless-kapitsa-81ec8d
git push origin main
```

- [ ] **Step 13.2: Deploy on VPS**

```
ssh ionos-vps 'set -e
cd /var/www/wolfinisoftware/claudetracker
git fetch origin main
git pull --ff-only origin main
cd backend
rm -rf dist.backup && cp -r dist dist.backup
npm install --no-audit --no-fund
npx tsc
cd ../frontend
rm -rf dist.backup && cp -r dist dist.backup
npm install --legacy-peer-deps --no-audit --no-fund
npx vite build
systemctl restart claudetracker-backend
sleep 3
systemctl is-active claudetracker-backend
'
```

- [ ] **Step 13.3: Smoke production**

```
curl -s -o /dev/null -w "%{http_code}\n" https://wolfinisoftware.de/claudetracker/
curl -s -o /dev/null -w "%{http_code}\n" https://wolfinisoftware.de/claudetracker/api/local-usage/config
JS=$(curl -s https://wolfinisoftware.de/claudetracker/ | grep -oE "assets/index-[A-Za-z0-9_-]+\.js" | head -1)
echo "bundle: $JS"
curl -s "https://wolfinisoftware.de/claudetracker/$JS" | grep -c "Verbundene user_ids"
```

Expected: 200, 401 (unauth), bundle has the new "Verbundene user_ids" string.

- [ ] **Step 13.4: User UI smoke**

In browser on prod:
1. Settings shows existing UUID `03bd2c3d-...` automatically (migration ran)
2. Add `wolfini_de_web` with label "WordPress"
3. "Verbindung testen" → both IDs sync; UI shows two perId statuses
4. Overview shows 1 or 2 mini-cards depending on event data
