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
