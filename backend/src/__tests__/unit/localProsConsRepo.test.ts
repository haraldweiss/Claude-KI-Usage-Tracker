// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  getLocalProsCons,
  upsertLocalProsCons,
} = await import('../../data/localProsConsRepo.js');

beforeAll(async () => {
  await initDatabase();
});

beforeEach(async () => {
  await runQuery('DELETE FROM catalog_local_pros_cons');
});

describe('localProsConsRepo', () => {
  it('returns null for missing model', async () => {
    expect(await getLocalProsCons('nope:latest')).toBeNull();
  });

  it('round-trips a row', async () => {
    await upsertLocalProsCons('foo:latest', ['p1', 'p2', 'p3'], ['c1', 'c2', 'c3'], 'chat');
    const row = await getLocalProsCons('foo:latest');
    expect(row).not.toBeNull();
    expect(row!.pros).toEqual(['p1', 'p2', 'p3']);
    expect(row!.cons).toEqual(['c1', 'c2', 'c3']);
    expect(row!.family).toBe('chat');
    expect(row!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('upsert replaces existing row', async () => {
    await upsertLocalProsCons('foo:latest', ['a', 'b', 'c'], ['x', 'y', 'z'], 'chat');
    await upsertLocalProsCons('foo:latest', ['d', 'e', 'f'], ['u', 'v', 'w'], 'code');
    const row = await getLocalProsCons('foo:latest');
    expect(row!.pros).toEqual(['d', 'e', 'f']);
    expect(row!.family).toBe('code');
  });
});
