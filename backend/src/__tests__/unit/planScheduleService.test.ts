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
