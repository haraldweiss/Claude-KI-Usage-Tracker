// Set DATABASE_PATH BEFORE importing anything that touches sqlite.ts.
process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { allForUser } = await import('../../utils/scopedDb.js');

beforeAll(async () => {
  await initDatabase();
  // user id=1 is seeded by seedInitialUser migration (anubclaw@gmail.com).
  // Use non-conflicting IDs (10/11) to avoid UNIQUE constraint on email.
  // INSERT OR IGNORE so re-runs are safe even if the rows already exist.
  await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (10, 'a@x.com'), (11, 'b@x.com')`);
  await runQuery(
    `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, user_id) VALUES
     ('m1', 100, 50, 150, 10),
     ('m1', 200, 100, 300, 10),
     ('m1', 999, 999, 1998, 11)`
  );
});

describe('allForUser', () => {
  it('scopes a no-WHERE query', async () => {
    const rows = await allForUser<{ model: string }>('SELECT * FROM usage_records', 10);
    expect(rows).toHaveLength(2);
  });

  it('scopes a WHERE query without breaking existing predicates', async () => {
    const rows = await allForUser<{ model: string }>(
      'SELECT * FROM usage_records WHERE input_tokens > ?', 10, [150]
    );
    expect(rows).toHaveLength(1);   // user 10's row with input_tokens=200
  });

  it('does not leak rows from other users', async () => {
    const rows = await allForUser<{ model: string }>('SELECT * FROM usage_records', 11);
    expect(rows).toHaveLength(1);
  });
});
