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
