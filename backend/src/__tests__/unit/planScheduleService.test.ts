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
