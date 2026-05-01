import { initDatabase, runQuery } from '../../database/sqlite.js';
import { allForUser } from '../../utils/scopedDb.js';

// user_id values resolved after initDatabase (which seeds user id=1 via migration)
let user1: number;
let user2: number;

beforeAll(async () => {
  process.env.DATABASE_PATH = ':memory:';
  await initDatabase();
  // user id=1 is seeded by seedInitialUser migration; grab its id
  const u1 = await import('../../database/sqlite.js').then(m =>
    m.getQuery<{ id: number }>('SELECT id FROM users LIMIT 1')
  );
  user1 = u1!.id;

  // Insert a second user for cross-user isolation tests
  const { lastID } = await runQuery(`INSERT INTO users (email) VALUES ('b@x.com')`);
  user2 = lastID;

  await runQuery(
    `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, user_id) VALUES
     ('m1', 100, 50, 150, ?),
     ('m1', 200, 100, 300, ?),
     ('m1', 999, 999, 1998, ?)`,
    [user1, user1, user2]
  );
});

describe('allForUser', () => {
  it('scopes a no-WHERE query', async () => {
    const rows = await allForUser<{ model: string }>('SELECT * FROM usage_records', user1);
    expect(rows).toHaveLength(2);
  });

  it('scopes a WHERE query without breaking existing predicates', async () => {
    const rows = await allForUser<{ model: string }>(
      'SELECT * FROM usage_records WHERE input_tokens > ?', user1, [150]
    );
    expect(rows).toHaveLength(1);   // user 1's row with 200
  });

  it('does not leak rows from other users', async () => {
    const rows = await allForUser<{ model: string }>('SELECT * FROM usage_records', user2);
    expect(rows).toHaveLength(1);
  });
});
