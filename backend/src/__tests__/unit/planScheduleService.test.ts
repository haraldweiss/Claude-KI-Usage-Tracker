// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, runQuery, getQuery, allQuery } = await import('../../database/sqlite.js');
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
