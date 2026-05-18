# Tracker — Scheduled Plan Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `plan_history` table + cron job so users can pre-schedule a future plan change (e.g. Max 5× → Pro on 2026-05-22) and the tracker flips `users.plan_name` automatically on that date.

**Architecture:** New `plan_history` table is appended-to whenever the plan changes (immediate or scheduled). A daily cron at 00:05 sets `users.plan_name` to whatever entry is `effective_from <= today` with the latest date. Existing reads of `users.plan_name` keep working unchanged.

**Tech Stack:** TypeScript backend (ESM, Express, sqlite3, Jest with `--experimental-vm-modules`), React+Vite frontend, node-cron. Tests use `:memory:` SQLite per existing pattern in `backend/src/__tests__/unit/localUsageRepo.test.ts`.

**Spec:** [docs/superpowers/specs/2026-05-18-tracker-plan-scheduling-design.md](../specs/2026-05-18-tracker-plan-scheduling-design.md)

---

## File Map

**Create:**
- `backend/src/database/migrations/seedPlanHistoryFromUsers.ts`
- `backend/src/services/planScheduleService.ts`
- `backend/src/routes/account.ts` — already exists, modify
- `backend/src/__tests__/unit/planScheduleService.test.ts`
- `backend/src/__tests__/unit/seedPlanHistoryFromUsers.test.ts`
- `backend/src/__tests__/unit/accountControllerPlanRoutes.test.ts`

**Modify:**
- `backend/src/database/sqlite.ts` — add `plan_history` CREATE TABLE + call new migration
- `backend/src/controllers/accountController.ts` — extend `patchAccount`, add 4 new handlers
- `backend/src/routes/account.ts` — register 4 new routes
- `backend/src/server.ts` — wire cron tick + startup invocation
- `backend/src/types/index.ts` — add `PlanHistoryRow` and `PendingPlanChange` types
- `frontend/src/services/api.ts` — add 4 API client methods
- `frontend/src/types/api.ts` — add corresponding types
- `frontend/src/components/settings/AccountSection.tsx` — banner, schedule form, history accordion

---

## Task 1: Add `plan_history` table to schema

**Files:**
- Modify: `backend/src/database/sqlite.ts` (insert after the `users` CREATE TABLE block, around line ~170)
- Test: `backend/src/__tests__/unit/planHistorySchema.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/planHistorySchema.test.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, allQuery } = await import('../../database/sqlite.js');

beforeAll(async () => { await initDatabase(); });

describe('plan_history schema', () => {
  it('table exists with expected columns', async () => {
    const cols = await allQuery<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(plan_history)`
    );
    const byName = Object.fromEntries(cols.map(c => [c.name, c]));
    expect(byName.id).toBeDefined();
    expect(byName.user_id?.notnull).toBe(1);
    expect(byName.plan_name?.notnull).toBe(1);
    expect(byName.effective_from?.notnull).toBe(1);
    expect(byName.source?.notnull).toBe(1);
    expect(byName.note).toBeDefined();
    expect(byName.created_at).toBeDefined();
  });

  it('user_id + effective_from index exists', async () => {
    const idxs = await allQuery<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='plan_history'`
    );
    expect(idxs.some(i => i.name === 'idx_plan_history_user_date')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- planHistorySchema`
Expected: FAIL — `plan_history` table doesn't exist yet.

- [ ] **Step 3: Add CREATE TABLE in sqlite.ts**

In `backend/src/database/sqlite.ts`, after the `users` CREATE TABLE (around line 167), add:
```ts
      // Plan-change schedule + audit trail. See spec
      // 2026-05-18-tracker-plan-scheduling-design.md
      database.run(`
        CREATE TABLE IF NOT EXISTS plan_history (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan_name       TEXT NOT NULL,
          effective_from  TEXT NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          source          TEXT NOT NULL DEFAULT 'manual',
          note            TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });
      database.run(
        `CREATE INDEX IF NOT EXISTS idx_plan_history_user_date
           ON plan_history(user_id, effective_from)`,
        (err: Error | null) => {
          if (err && !err.message.includes('already exists')) reject(err);
        }
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- planHistorySchema`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/database/sqlite.ts backend/src/__tests__/unit/planHistorySchema.test.ts
git commit -m "feat(db): add plan_history table + index"
```

---

## Task 2: Migration — seed `plan_history` from existing users

**Files:**
- Create: `backend/src/database/migrations/seedPlanHistoryFromUsers.ts`
- Modify: `backend/src/database/sqlite.ts` (call after `seedInitialUser` around line 299)
- Test: `backend/src/__tests__/unit/seedPlanHistoryFromUsers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/seedPlanHistoryFromUsers.test.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, runQuery, allQuery } = await import('../../database/sqlite.js');
const { seedPlanHistoryFromUsers } = await import(
  '../../database/migrations/seedPlanHistoryFromUsers.js'
);

beforeAll(async () => { await initDatabase(); });

beforeEach(async () => {
  await runQuery('DELETE FROM plan_history');
  await runQuery('DELETE FROM users');
  await runQuery(
    `INSERT INTO users (id, email, plan_name, created_at)
     VALUES (1, 'a@x.com', 'Max (5x)', '2026-01-15T10:00:00Z'),
            (2, 'b@x.com', 'Pro',      '2026-03-01T10:00:00Z'),
            (3, 'c@x.com', NULL,       '2026-04-01T10:00:00Z')`
  );
});

describe('seedPlanHistoryFromUsers', () => {
  it('creates one entry per user with a plan_name', async () => {
    await seedPlanHistoryFromUsers();
    const rows = await allQuery<{ user_id: number; plan_name: string; source: string }>(
      `SELECT user_id, plan_name, source FROM plan_history ORDER BY user_id`
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: 1, plan_name: 'Max (5x)', source: 'seed' });
    expect(rows[1]).toMatchObject({ user_id: 2, plan_name: 'Pro',      source: 'seed' });
  });

  it('skips users with null plan_name', async () => {
    await seedPlanHistoryFromUsers();
    const row = await allQuery(`SELECT * FROM plan_history WHERE user_id = 3`);
    expect(row).toHaveLength(0);
  });

  it('is idempotent — re-running does not duplicate', async () => {
    await seedPlanHistoryFromUsers();
    await seedPlanHistoryFromUsers();
    const rows = await allQuery(`SELECT * FROM plan_history`);
    expect(rows).toHaveLength(2);
  });

  it('uses users.created_at (truncated to date) as effective_from', async () => {
    await seedPlanHistoryFromUsers();
    const row = await allQuery<{ effective_from: string }>(
      `SELECT effective_from FROM plan_history WHERE user_id = 1`
    );
    expect(row[0].effective_from).toBe('2026-01-15');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- seedPlanHistoryFromUsers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the migration**

Create `backend/src/database/migrations/seedPlanHistoryFromUsers.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { runQuery } from '../sqlite.js';

/**
 * One-time backfill: for every user that has a plan_name set but no
 * plan_history entry yet, create a seed entry effective from their
 * users.created_at date. Idempotent — safe to run on every startup.
 */
export async function seedPlanHistoryFromUsers(): Promise<void> {
  await runQuery(
    `INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
     SELECT u.id,
            u.plan_name,
            substr(COALESCE(u.created_at, datetime('now')), 1, 10),
            'seed',
            'Backfill from users.plan_name at migration time'
       FROM users u
      WHERE u.plan_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM plan_history h WHERE h.user_id = u.id
        )`
  );
}
```

- [ ] **Step 4: Wire migration into startup**

In `backend/src/database/sqlite.ts`, find the existing line:
```ts
          const { seedInitialUser } = await import('./migrations/seedInitialUser.js');
          await seedInitialUser();
```
Add immediately after:
```ts
          const { seedPlanHistoryFromUsers } = await import('./migrations/seedPlanHistoryFromUsers.js');
          await seedPlanHistoryFromUsers();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- seedPlanHistoryFromUsers`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/src/database/migrations/seedPlanHistoryFromUsers.ts \
        backend/src/database/sqlite.ts \
        backend/src/__tests__/unit/seedPlanHistoryFromUsers.test.ts
git commit -m "feat(db): backfill plan_history from users on migration"
```

---

## Task 3: Add types for plan history

**Files:**
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: Add the types**

Append to `backend/src/types/index.ts`:
```ts
export interface PlanHistoryRow {
  id: number;
  user_id: number;
  plan_name: string;
  effective_from: string;     // ISO date YYYY-MM-DD
  created_at: string;
  source: 'manual' | 'seed' | 'scheduled';
  note: string | null;
}

export interface PendingPlanChange {
  id: number;
  plan_name: string;
  effective_from: string;
  note: string | null;
}
```

- [ ] **Step 2: Compile-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat(types): add PlanHistoryRow + PendingPlanChange"
```

---

## Task 4: Service — `getCurrentPlan`

**Files:**
- Create: `backend/src/services/planScheduleService.ts`
- Test: `backend/src/__tests__/unit/planScheduleService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/planScheduleService.test.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { getCurrentPlan } = await import('../../services/planScheduleService.js');

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email, plan_name) VALUES (501, 't1@x.com', 'Max (5x)')`
  );
});

beforeEach(async () => {
  await runQuery('DELETE FROM plan_history WHERE user_id = 501');
});

describe('getCurrentPlan', () => {
  it('returns null when no history exists', async () => {
    expect(await getCurrentPlan(501)).toBeNull();
  });

  it('returns the only entry when one exists in the past', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'Max (5x)', '2026-01-01', 'seed')`
    );
    expect(await getCurrentPlan(501)).toBe('Max (5x)');
  });

  it('ignores future-dated entries', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source) VALUES
       (501, 'Max (5x)', '2026-01-01', 'seed'),
       (501, 'Pro',      '2099-01-01', 'scheduled')`
    );
    expect(await getCurrentPlan(501)).toBe('Max (5x)');
  });

  it('returns latest entry when multiple are in the past', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source) VALUES
       (501, 'Free',     '2025-01-01', 'seed'),
       (501, 'Pro',      '2025-06-01', 'manual'),
       (501, 'Max (5x)', '2026-01-01', 'manual')`
    );
    expect(await getCurrentPlan(501)).toBe('Max (5x)');
  });

  it('tie-breaks same effective_from by latest id', async () => {
    await runQuery(
      `INSERT INTO plan_history (id, user_id, plan_name, effective_from, source) VALUES
       (1001, 501, 'Pro',      '2026-01-01', 'manual'),
       (1002, 501, 'Max (5x)', '2026-01-01', 'manual')`
    );
    expect(await getCurrentPlan(501)).toBe('Max (5x)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- planScheduleService`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement getCurrentPlan**

Create `backend/src/services/planScheduleService.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { getQuery } from '../database/sqlite.js';

/**
 * Authoritative source of "what plan is this user on right now".
 * Latest plan_history row with effective_from <= today (UTC),
 * tie-broken by id (later insert wins).
 */
export async function getCurrentPlan(userId: number): Promise<string | null> {
  const row = await getQuery<{ plan_name: string }>(
    `SELECT plan_name FROM plan_history
      WHERE user_id = ? AND effective_from <= date('now')
      ORDER BY effective_from DESC, id DESC
      LIMIT 1`,
    [userId]
  );
  return row?.plan_name ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- planScheduleService`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planScheduleService.ts \
        backend/src/__tests__/unit/planScheduleService.test.ts
git commit -m "feat(plan-schedule): getCurrentPlan service"
```

---

## Task 5: Service — `getPendingPlanChange` and `getPlanHistory`

**Files:**
- Modify: `backend/src/services/planScheduleService.ts`
- Modify: `backend/src/__tests__/unit/planScheduleService.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `planScheduleService.test.ts`:
```ts
const { getPendingPlanChange, getPlanHistory } = await import('../../services/planScheduleService.js');

describe('getPendingPlanChange', () => {
  it('returns null when no future entry exists', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'Max (5x)', '2026-01-01', 'seed')`
    );
    expect(await getPendingPlanChange(501)).toBeNull();
  });

  it('ignores entries with effective_from = today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'Pro', ?, 'manual')`,
      [today]
    );
    expect(await getPendingPlanChange(501)).toBeNull();
  });

  it('returns the nearest future entry', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source) VALUES
       (501, 'Pro',      '2099-06-01', 'scheduled'),
       (501, 'Max (5x)', '2099-01-01', 'scheduled')`
    );
    const pending = await getPendingPlanChange(501);
    expect(pending?.plan_name).toBe('Max (5x)');
    expect(pending?.effective_from).toBe('2099-01-01');
  });
});

describe('getPlanHistory', () => {
  it('returns all entries DESC sorted by effective_from', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source) VALUES
       (501, 'Free',     '2025-01-01', 'seed'),
       (501, 'Pro',      '2026-01-01', 'manual'),
       (501, 'Max (5x)', '2026-03-01', 'manual')`
    );
    const hist = await getPlanHistory(501);
    expect(hist.map(r => r.plan_name)).toEqual(['Max (5x)', 'Pro', 'Free']);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await runQuery(
        `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
         VALUES (501, 'Pro', ?, 'manual')`,
        [`2026-01-${String(i + 1).padStart(2, '0')}`]
      );
    }
    const hist = await getPlanHistory(501, 3);
    expect(hist).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- planScheduleService`
Expected: FAIL — exports missing.

- [ ] **Step 3: Add the two functions**

Append to `backend/src/services/planScheduleService.ts`:
```ts
import { allQuery } from '../database/sqlite.js';
import type { PendingPlanChange, PlanHistoryRow } from '../types/index.js';

/** Next future plan change (effective_from > today), or null. */
export async function getPendingPlanChange(
  userId: number
): Promise<PendingPlanChange | null> {
  const row = await getQuery<PendingPlanChange>(
    `SELECT id, plan_name, effective_from, note
       FROM plan_history
      WHERE user_id = ? AND effective_from > date('now')
      ORDER BY effective_from ASC, id ASC
      LIMIT 1`,
    [userId]
  );
  return row ?? null;
}

/** Full history DESC sorted, optionally limited. */
export async function getPlanHistory(
  userId: number,
  limit?: number
): Promise<PlanHistoryRow[]> {
  const sql =
    `SELECT id, user_id, plan_name, effective_from, created_at, source, note
       FROM plan_history
      WHERE user_id = ?
      ORDER BY effective_from DESC, id DESC` + (limit ? ' LIMIT ?' : '');
  const params: unknown[] = limit ? [userId, limit] : [userId];
  return allQuery<PlanHistoryRow>(sql, params);
}
```

(NB: the existing `import { getQuery }` line is already at top — `allQuery` is added in this new import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- planScheduleService`
Expected: PASS, 5 + 2 + 2 = 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planScheduleService.ts \
        backend/src/__tests__/unit/planScheduleService.test.ts
git commit -m "feat(plan-schedule): getPendingPlanChange + getPlanHistory"
```

---

## Task 6: Service — `schedulePlanChange` with validations

**Files:**
- Modify: `backend/src/services/planScheduleService.ts`
- Modify: `backend/src/__tests__/unit/planScheduleService.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `planScheduleService.test.ts`:
```ts
const { schedulePlanChange } = await import('../../services/planScheduleService.js');

beforeAll(async () => {
  await runQuery(
    `INSERT OR IGNORE INTO plan_pricing (plan_name, monthly_eur) VALUES
     ('Pro', 20.0), ('Max (5x)', 100.0)`
  );
});

describe('schedulePlanChange', () => {
  it('rejects past date', async () => {
    await expect(
      schedulePlanChange(501, 'Pro', '2020-01-01')
    ).rejects.toThrow(/today or later/);
  });

  it('rejects unknown plan name', async () => {
    const future = '2099-12-31';
    await expect(
      schedulePlanChange(501, 'Bogus', future)
    ).rejects.toThrow(/unknown plan/);
  });

  it('accepts a valid future change and inserts with source=scheduled', async () => {
    const id = await schedulePlanChange(501, 'Pro', '2099-12-31', 'Kostengründe');
    expect(id).toBeGreaterThan(0);
    const row = await getQuery<{ source: string; note: string | null }>(
      `SELECT source, note FROM plan_history WHERE id = ?`, [id]
    );
    expect(row?.source).toBe('scheduled');
    expect(row?.note).toBe('Kostengründe');
  });

  it("accepts today's date (treated as immediate)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await expect(
      schedulePlanChange(501, 'Pro', today)
    ).resolves.toBeGreaterThan(0);
  });
});
```

Also import `getQuery` if not already (it's auto-resolved from sqlite.js via the existing service import inside test).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- planScheduleService`
Expected: FAIL — `schedulePlanChange` is not a function.

- [ ] **Step 3: Implement schedulePlanChange**

Append to `backend/src/services/planScheduleService.ts`:
```ts
import { runQuery } from '../database/sqlite.js';

/**
 * Insert a future plan change. Rejects past dates and unknown plan names.
 * Returns the new row id.
 */
export async function schedulePlanChange(
  userId: number,
  planName: string,
  effectiveFrom: string,
  note?: string
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  if (effectiveFrom < today) {
    throw new Error('effective_from must be today or later');
  }
  const known = await getQuery<{ plan_name: string }>(
    `SELECT plan_name FROM plan_pricing WHERE plan_name = ?`,
    [planName]
  );
  if (!known) {
    throw new Error(`unknown plan: ${planName}`);
  }
  const result = await runQuery(
    `INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
     VALUES (?, ?, ?, 'scheduled', ?)`,
    [userId, planName, effectiveFrom, note ?? null]
  );
  return result.lastID;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- planScheduleService`
Expected: PASS, 9 + 4 = 13 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planScheduleService.ts \
        backend/src/__tests__/unit/planScheduleService.test.ts
git commit -m "feat(plan-schedule): schedulePlanChange with validations"
```

---

## Task 7: Service — `cancelPendingPlanChange`

**Files:**
- Modify: `backend/src/services/planScheduleService.ts`
- Modify: `backend/src/__tests__/unit/planScheduleService.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `planScheduleService.test.ts`:
```ts
const { cancelPendingPlanChange } = await import('../../services/planScheduleService.js');

describe('cancelPendingPlanChange', () => {
  it('deletes only future scheduled entries', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source) VALUES
       (501, 'Max (5x)', '2026-01-01', 'seed'),
       (501, 'Pro',      '2026-06-01', 'manual'),
       (501, 'Pro',      '2099-01-01', 'scheduled'),
       (501, 'Free',     '2099-06-01', 'scheduled')`
    );
    const deleted = await cancelPendingPlanChange(501);
    expect(deleted).toBe(2);
    const remaining = await allQuery<{ source: string }>(
      `SELECT source FROM plan_history WHERE user_id = 501`
    );
    expect(remaining.map(r => r.source).sort()).toEqual(['manual', 'seed']);
  });

  it('does not touch manual entries even if in the future', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source) VALUES
       (501, 'Pro', '2099-01-01', 'manual')`
    );
    await cancelPendingPlanChange(501);
    const remaining = await allQuery(`SELECT * FROM plan_history WHERE user_id = 501`);
    expect(remaining).toHaveLength(1);
  });

  it('is idempotent — no rows, no error', async () => {
    await expect(cancelPendingPlanChange(501)).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- planScheduleService`
Expected: FAIL — `cancelPendingPlanChange` is not a function.

- [ ] **Step 3: Implement**

Append to `backend/src/services/planScheduleService.ts`:
```ts
/**
 * Cancel all future plan changes for this user. Only deletes rows with
 * source='scheduled' — manual and seed rows are preserved even if they
 * happen to be future-dated (edge case, but explicit).
 * Returns number of rows deleted.
 */
export async function cancelPendingPlanChange(userId: number): Promise<number> {
  const result = await runQuery(
    `DELETE FROM plan_history
      WHERE user_id = ?
        AND effective_from > date('now')
        AND source = 'scheduled'`,
    [userId]
  );
  return result.changes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- planScheduleService`
Expected: PASS, 13 + 3 = 16 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planScheduleService.ts \
        backend/src/__tests__/unit/planScheduleService.test.ts
git commit -m "feat(plan-schedule): cancelPendingPlanChange"
```

---

## Task 8: Service — `recordImmediatePlanChange` + `applyDuePlanChanges`

**Files:**
- Modify: `backend/src/services/planScheduleService.ts`
- Modify: `backend/src/__tests__/unit/planScheduleService.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `planScheduleService.test.ts`:
```ts
const { recordImmediatePlanChange, applyDuePlanChanges } = await import(
  '../../services/planScheduleService.js'
);

describe('recordImmediatePlanChange', () => {
  it('no-ops when new plan equals current plan', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'Pro', '2026-01-01', 'manual')`
    );
    const beforeCount = (await allQuery(`SELECT * FROM plan_history WHERE user_id = 501`)).length;
    await recordImmediatePlanChange(501, 'Pro');
    const afterCount = (await allQuery(`SELECT * FROM plan_history WHERE user_id = 501`)).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('inserts when plan differs', async () => {
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'Pro', '2026-01-01', 'manual')`
    );
    await recordImmediatePlanChange(501, 'Max (5x)', 'Wechsel back');
    const today = new Date().toISOString().slice(0, 10);
    const row = await getQuery<{ source: string; effective_from: string }>(
      `SELECT source, effective_from FROM plan_history
        WHERE user_id = 501 AND plan_name = 'Max (5x)' AND note = 'Wechsel back'`
    );
    expect(row?.source).toBe('manual');
    expect(row?.effective_from).toBe(today);
  });
});

describe('applyDuePlanChanges', () => {
  it('syncs users.plan_name when out of sync', async () => {
    await runQuery(`UPDATE users SET plan_name = 'Old' WHERE id = 501`);
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'New', '2026-01-01', 'manual')`
    );
    const synced = await applyDuePlanChanges();
    expect(synced).toBeGreaterThanOrEqual(1);
    const u = await getQuery<{ plan_name: string }>(
      `SELECT plan_name FROM users WHERE id = 501`
    );
    expect(u?.plan_name).toBe('New');
  });

  it('no-op when users.plan_name already matches current plan', async () => {
    await runQuery(`UPDATE users SET plan_name = 'Pro' WHERE id = 501`);
    await runQuery(
      `INSERT INTO plan_history (user_id, plan_name, effective_from, source)
       VALUES (501, 'Pro', '2026-01-01', 'manual')`
    );
    const synced = await applyDuePlanChanges();
    expect(synced).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- planScheduleService`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement both**

Append to `backend/src/services/planScheduleService.ts`:
```ts
import { allQuery } from '../database/sqlite.js';

/**
 * Append a 'manual' history entry for an immediate plan switch.
 * No-op when the new plan equals the user's current plan — avoids noise
 * when PATCH /api/account is called only to update display_name.
 */
export async function recordImmediatePlanChange(
  userId: number,
  planName: string,
  note?: string
): Promise<void> {
  const current = await getCurrentPlan(userId);
  if (current === planName) return;
  const today = new Date().toISOString().slice(0, 10);
  await runQuery(
    `INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
     VALUES (?, ?, ?, 'manual', ?)`,
    [userId, planName, today, note ?? null]
  );
}

interface UserSyncRow { id: number; plan_name: string | null }

/**
 * Cron entry point. For every user whose users.plan_name diverges from
 * getCurrentPlan(), update users.plan_name. Returns count of users synced.
 */
export async function applyDuePlanChanges(): Promise<number> {
  const users = await allQuery<UserSyncRow>(`SELECT id, plan_name FROM users`);
  let synced = 0;
  for (const u of users) {
    try {
      const current = await getCurrentPlan(u.id);
      if (current !== null && current !== u.plan_name) {
        await runQuery(
          `UPDATE users SET plan_name = ? WHERE id = ?`,
          [current, u.id]
        );
        console.log(
          `[planSchedule] user ${u.id}: ${u.plan_name ?? 'NULL'} → ${current}`
        );
        synced++;
      }
    } catch (err) {
      console.error(
        `[planSchedule] sync failed for user ${u.id}:`,
        (err as Error).message
      );
    }
  }
  return synced;
}
```

(NB: `allQuery` import is already on the previous task — remove the duplicate import if it produces a TS error.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- planScheduleService`
Expected: PASS, 16 + 2 + 2 = 20 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/planScheduleService.ts \
        backend/src/__tests__/unit/planScheduleService.test.ts
git commit -m "feat(plan-schedule): recordImmediatePlanChange + applyDuePlanChanges"
```

---

## Task 9: Wire cron + startup tick in server.ts

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Add import and cron registration**

In `backend/src/server.ts`, add to imports:
```ts
import { applyDuePlanChanges } from './services/planScheduleService.js';
```

In the startup block where `schedulePricingCheck(cron)` is called (around line 51), add immediately after:
```ts
    // Plan-schedule cron: flip users.plan_name when a scheduled change is due.
    cron.schedule('5 0 * * *', async () => {
      try {
        const synced = await applyDuePlanChanges();
        if (synced > 0) console.log(`[planSchedule] ${synced} user(s) synced`);
      } catch (err) {
        console.error('Scheduled plan-change apply failed:', err);
      }
    });
    // Run once at startup in case the server was down during the cron tick.
    applyDuePlanChanges().catch((err) =>
      console.error('Startup plan-schedule apply failed:', (err as Error).message)
    );
```

- [ ] **Step 2: Compile-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual sanity check**

Run: `cd backend && npm run dev` (or whatever starts the server)
Expected: server starts; in logs you should see no error from the startup `applyDuePlanChanges()` call. Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat(server): wire plan-schedule cron + startup tick"
```

---

## Task 10: Hook `patchAccount` into `recordImmediatePlanChange`

**Files:**
- Modify: `backend/src/controllers/accountController.ts`

- [ ] **Step 1: Modify patchAccount**

In `backend/src/controllers/accountController.ts`, at the top add:
```ts
import { recordImmediatePlanChange } from '../services/planScheduleService.js';
```

Modify `patchAccount` — after the existing `await runQuery(...)` line and before the `const updated = await getQuery<User>(...)` line, insert:
```ts
  // Append history entry if plan_name was provided and actually changed.
  if (typeof plan_name === 'string' && plan_name.length > 0) {
    await recordImmediatePlanChange(u.id, plan_name);
  }
```

- [ ] **Step 2: Compile-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/accountController.ts
git commit -m "feat(account): record plan history on immediate PATCH switch"
```

---

## Task 11: New controller handlers + tests

**Files:**
- Modify: `backend/src/controllers/accountController.ts`
- Create: `backend/src/__tests__/unit/accountControllerPlanRoutes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/__tests__/unit/accountControllerPlanRoutes.test.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
process.env.DATABASE_PATH = ':memory:';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  getPlanHistory: getPlanHistoryHandler,
  getPlanPending,
  postPlanSchedule,
  deletePlanSchedule,
} = await import('../../controllers/accountController.js');

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email, plan_name) VALUES (701, 'route@x.com', 'Max (5x)')`
  );
  await runQuery(
    `INSERT OR IGNORE INTO plan_pricing (plan_name, monthly_eur) VALUES ('Pro', 20)`
  );
});

beforeEach(async () => {
  await runQuery('DELETE FROM plan_history WHERE user_id = 701');
});

function makeApp() {
  const app = express();
  app.use(express.json());
  // Inject fake user (id=701) onto req.user — replaces requireUser middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 701 } as never;
    next();
  });
  app.get('/plan-history', getPlanHistoryHandler);
  app.get('/plan-pending', getPlanPending);
  app.post('/plan-schedule', postPlanSchedule);
  app.delete('/plan-schedule', deletePlanSchedule);
  return app;
}

describe('plan routes', () => {
  it('GET /plan-history returns [] when empty', async () => {
    const res = await request(makeApp()).get('/plan-history');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /plan-pending returns null when nothing scheduled', async () => {
    const res = await request(makeApp()).get('/plan-pending');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('POST /plan-schedule with valid body returns 201', async () => {
    const res = await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Pro', effective_from: '2099-12-31', note: 'test' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('POST /plan-schedule with past date returns 400', async () => {
    const res = await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Pro', effective_from: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/today or later/);
  });

  it('POST /plan-schedule with unknown plan returns 400', async () => {
    const res = await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Bogus', effective_from: '2099-12-31' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown plan/);
  });

  it('DELETE /plan-schedule returns 204 even when nothing to cancel', async () => {
    const res = await request(makeApp()).delete('/plan-schedule');
    expect(res.status).toBe(204);
  });

  it('GET /plan-pending after POST returns the new entry', async () => {
    await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Pro', effective_from: '2099-12-31' });
    const res = await request(makeApp()).get('/plan-pending');
    expect(res.body.plan_name).toBe('Pro');
    expect(res.body.effective_from).toBe('2099-12-31');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- accountControllerPlanRoutes`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Add handler implementations**

Append to `backend/src/controllers/accountController.ts`:
```ts
import {
  getPlanHistory as svcGetPlanHistory,
  getPendingPlanChange,
  schedulePlanChange,
  cancelPendingPlanChange,
} from '../services/planScheduleService.js';

export async function getPlanHistory(req: Request, res: Response): Promise<void> {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const hist = await svcGetPlanHistory(req.user!.id, limit);
  res.json(hist);
}

export async function getPlanPending(req: Request, res: Response): Promise<void> {
  const pending = await getPendingPlanChange(req.user!.id);
  res.json(pending);
}

export async function postPlanSchedule(req: Request, res: Response): Promise<void> {
  const { plan_name, effective_from, note } = req.body || {};
  if (typeof plan_name !== 'string' || typeof effective_from !== 'string') {
    res.status(400).json({ error: 'plan_name and effective_from required' });
    return;
  }
  try {
    const id = await schedulePlanChange(
      req.user!.id,
      plan_name,
      effective_from,
      typeof note === 'string' ? note.slice(0, 500) : undefined
    );
    res.status(201).json({ id });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
}

export async function deletePlanSchedule(req: Request, res: Response): Promise<void> {
  await cancelPendingPlanChange(req.user!.id);
  res.status(204).send();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- accountControllerPlanRoutes`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/accountController.ts \
        backend/src/__tests__/unit/accountControllerPlanRoutes.test.ts
git commit -m "feat(account): handlers for plan-history / plan-pending / plan-schedule"
```

---

## Task 12: Register routes

**Files:**
- Modify: `backend/src/routes/account.ts`

- [ ] **Step 1: Add the four routes**

In `backend/src/routes/account.ts`, extend imports:
```ts
import {
  getAccount, patchAccount, deleteAccount,
  getToken, rotateToken, revokeToken,
  getPlanHistory, getPlanPending, postPlanSchedule, deletePlanSchedule,
} from '../controllers/accountController.js';
```

Append before `export default router`:
```ts
router.get('/plan-history', getPlanHistory);
router.get('/plan-pending', getPlanPending);
router.post('/plan-schedule', postPlanSchedule);
router.delete('/plan-schedule', deletePlanSchedule);
```

- [ ] **Step 2: Compile-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

Run: `cd backend && npm run dev`
In another terminal:
```bash
curl -s http://localhost:PORT/api/account/plan-history -H "Cookie: cut_session=..."
```
Expected: `[]` (after login).
Then Ctrl+C the server.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/account.ts
git commit -m "feat(routes): register plan-schedule routes"
```

---

## Task 13: Frontend types + API client

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add types**

Append to `frontend/src/types/api.ts`:
```ts
export interface PlanHistoryRow {
  id: number;
  user_id: number;
  plan_name: string;
  effective_from: string;
  created_at: string;
  source: 'manual' | 'seed' | 'scheduled';
  note: string | null;
}

export interface PendingPlanChange {
  id: number;
  plan_name: string;
  effective_from: string;
  note: string | null;
}
```

- [ ] **Step 2: Add API methods**

In `frontend/src/services/api.ts`, add (use existing fetch wrapper pattern — copy a nearby method as template):
```ts
export async function getPlanHistory(limit?: number): Promise<PlanHistoryRow[]> {
  const q = limit ? `?limit=${limit}` : '';
  return apiFetch(`/account/plan-history${q}`);
}

export async function getPlanPending(): Promise<PendingPlanChange | null> {
  return apiFetch('/account/plan-pending');
}

export async function postPlanSchedule(
  body: { plan_name: string; effective_from: string; note?: string }
): Promise<{ id: number }> {
  return apiFetch('/account/plan-schedule', { method: 'POST', body: JSON.stringify(body) });
}

export async function deletePlanSchedule(): Promise<void> {
  await apiFetch('/account/plan-schedule', { method: 'DELETE' });
}
```

Add the types import at the top:
```ts
import type { PlanHistoryRow, PendingPlanChange } from '../types/api';
```

- [ ] **Step 3: Compile-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/services/api.ts
git commit -m "feat(frontend): plan-schedule types + API methods"
```

---

## Task 14: AccountSection — pending banner + cancel

**Files:**
- Modify: `frontend/src/components/settings/AccountSection.tsx`

- [ ] **Step 1: Add state + load on mount**

In `AccountSection.tsx`, add imports:
```tsx
import { getPlanPending, deletePlanSchedule } from '../../services/api';
import type { PendingPlanChange } from '../../types/api';
```

In the component, add state:
```tsx
const [pending, setPending] = useState<PendingPlanChange | null>(null);

useEffect(() => {
  getPlanPending().then(setPending).catch(console.error);
}, []);

async function handleCancelPending() {
  if (!confirm(`Plan-Wechsel am ${pending?.effective_from} auf ${pending?.plan_name} abbrechen?`)) return;
  await deletePlanSchedule();
  setPending(null);
}
```

- [ ] **Step 2: Render banner**

Above the existing plan-dropdown JSX in the return:
```tsx
{pending && (
  <div style={{
    padding: '12px', marginBottom: '16px',
    background: '#f0f7ff', border: '1px solid #b3d4ff',
    borderRadius: '6px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center'
  }}>
    <span>📅 Plan wechselt am <b>{pending.effective_from}</b> auf <b>{pending.plan_name}</b>
      {pending.note && ` — ${pending.note}`}</span>
    <button onClick={handleCancelPending} type="button">Abbrechen</button>
  </div>
)}
```

- [ ] **Step 3: Manual verification**

Run: `cd frontend && npm run dev`
In the browser: log in, open Settings → Account.
Then in a DB shell, insert a pending row:
```sql
INSERT INTO plan_history (user_id, plan_name, effective_from, source)
VALUES (1, 'Pro', '2099-12-31', 'scheduled');
```
Reload the page → banner appears. Click „Abbrechen" → banner disappears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/AccountSection.tsx
git commit -m "feat(account-ui): pending plan-change banner + cancel"
```

---

## Task 15: AccountSection — schedule form

**Files:**
- Modify: `frontend/src/components/settings/AccountSection.tsx`

- [ ] **Step 1: Add form state + handler**

In `AccountSection.tsx`, add state and import:
```tsx
import { postPlanSchedule } from '../../services/api';

// inside component:
const [schedPlan, setSchedPlan] = useState('');
const [schedDate, setSchedDate] = useState('');
const [schedNote, setSchedNote] = useState('');
const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

async function handleSchedule(e: React.FormEvent) {
  e.preventDefault();
  if (!schedPlan || !schedDate) return;
  try {
    await postPlanSchedule({
      plan_name: schedPlan, effective_from: schedDate,
      note: schedNote || undefined,
    });
    const fresh = await getPlanPending();
    setPending(fresh);
    setSchedPlan(''); setSchedDate(''); setSchedNote('');
  } catch (err) {
    alert('Fehler: ' + (err as Error).message);
  }
}
```

- [ ] **Step 2: Render the form**

After the existing plan-dropdown JSX, add:
```tsx
<details style={{ marginTop: '24px' }}>
  <summary><b>Plan-Wechsel vormerken</b></summary>
  <form onSubmit={handleSchedule}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', maxWidth: '420px' }}>
    <label>
      Plan:
      <select value={schedPlan} onChange={(e) => setSchedPlan(e.target.value)} required>
        <option value="">— wählen —</option>
        {plans.map((p) => <option key={p.plan_name} value={p.plan_name}>{p.plan_name}</option>)}
      </select>
    </label>
    <label>
      Wirksam ab:
      <input type="date" value={schedDate} min={tomorrow}
             onChange={(e) => setSchedDate(e.target.value)} required />
    </label>
    <label>
      Notiz (optional):
      <input type="text" value={schedNote} maxLength={500}
             onChange={(e) => setSchedNote(e.target.value)} placeholder="z.B. Kostengründe" />
    </label>
    <button type="submit">Wechsel vormerken</button>
  </form>
</details>
```

- [ ] **Step 3: Manual verification**

Reload Settings → Account. Open „Plan-Wechsel vormerken", choose Pro + 2099-12-31 + note, submit. Banner should appear immediately above with the new pending change.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/AccountSection.tsx
git commit -m "feat(account-ui): schedule form for future plan change"
```

---

## Task 16: AccountSection — history accordion

**Files:**
- Modify: `frontend/src/components/settings/AccountSection.tsx`

- [ ] **Step 1: Load history**

Add state and effect:
```tsx
import { getPlanHistory } from '../../services/api';
import type { PlanHistoryRow } from '../../types/api';

const [history, setHistory] = useState<PlanHistoryRow[]>([]);
useEffect(() => {
  getPlanHistory(5).then(setHistory).catch(console.error);
}, []);
```

- [ ] **Step 2: Render**

After the schedule form `<details>`:
```tsx
<details style={{ marginTop: '16px' }}>
  <summary>Plan-Historie (letzte {history.length})</summary>
  <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
    {history.map((h) => (
      <li key={h.id}>
        <b>{h.effective_from}</b> — {h.plan_name}{' '}
        <span style={{ fontSize: '0.85em', color: '#777' }}>
          [{h.source}]{h.note ? ` ${h.note}` : ''}
        </span>
      </li>
    ))}
  </ul>
</details>
```

- [ ] **Step 3: Manual verification**

Reload Settings → Account. Open „Plan-Historie" — list of recent entries appears.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/AccountSection.tsx
git commit -m "feat(account-ui): collapsible plan-history"
```

---

## Task 17: Full test sweep + lint

**Files:** none — verification only.

- [ ] **Step 1: Full backend test run**

Run: `cd backend && npm test`
Expected: all green, including the new ~30 tests added across tasks.

- [ ] **Step 2: Frontend lint**

Run: `cd frontend && npx eslint src/components/settings/AccountSection.tsx src/services/api.ts src/types/api.ts`
Expected: no errors.

- [ ] **Step 3: Frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Backend type-check**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

If any failure: fix and re-run before proceeding.

---

## Task 18: Deploy + activate the 2026-05-22 change

**Files:** none — deployment only.

- [ ] **Step 1: Build frontend**

Run: `cd frontend && npm run build`
Expected: `dist/` populated.

- [ ] **Step 2: Deploy backend to VPS**

```bash
rsync -avz --delete \
  backend/dist/ backend/src/ backend/package.json backend/package-lock.json \
  user@vps:/var/www/wolfinisoftware/claudetracker/backend/
ssh user@vps 'cd /var/www/wolfinisoftware/claudetracker/backend && npm ci --production'
ssh user@vps 'systemctl restart claudetracker-backend'
```
Expected: service restarts cleanly. Check `journalctl -u claudetracker-backend -n 50` for startup logs incl. plan-schedule startup tick.

- [ ] **Step 3: Deploy frontend bundle**

```bash
rsync -avz --delete \
  frontend/dist/ user@vps:/var/www/wolfinisoftware/claudetracker/frontend/dist/
```

- [ ] **Step 4: Schedule the actual 2026-05-22 change in production**

Open `https://wolfinisoftware.de/claudetracker/`, log in, Settings → Account → „Plan-Wechsel vormerken":
- Plan: `Pro`
- Wirksam ab: `2026-05-22`
- Notiz: `Kostengründe`

Submit. Banner appears: „📅 Plan wechselt am 2026-05-22 auf Pro — Kostengründe".

- [ ] **Step 5: Verify on 2026-05-22**

On the morning of 2026-05-22, check the Settings page — Plan should now show `Pro`, banner gone, history shows the entry. `journalctl -u claudetracker-backend --since '2026-05-22 00:00'` should contain `[planSchedule] user 1: Max (5x) → Pro`.

---

## Self-Review Notes

**Spec coverage:** All sections of the spec map to tasks above (datenmodell→T1, migration→T2, service-layer→T4-8, cron→T9, hook into patchAccount→T10, API endpoints→T11+T12, UI→T14-16, deployment→T18, tests scattered across each task). ✓

**Placeholder scan:** No TBDs, no "implement appropriate validation" — every code block is real. ✓

**Type consistency:** `PlanHistoryRow` and `PendingPlanChange` defined once in `types/index.ts` (backend) and `types/api.ts` (frontend) — kept in sync by spec discipline since these are wire types. Function names (`getCurrentPlan`, `getPendingPlanChange`, `schedulePlanChange`, `cancelPendingPlanChange`, `recordImmediatePlanChange`, `applyDuePlanChanges`, `getPlanHistory`) are consistent across service + controller + test files. ✓

**Order matters:** Tasks 4–8 each add to the same service file and the same test file — implement strictly in order so tests stay green. Tasks 14–16 likewise build on each other in `AccountSection.tsx`.
