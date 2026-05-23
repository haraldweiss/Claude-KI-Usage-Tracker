// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { getModelProsCons, upsertModelProsCons } = await import(
  '../../data/modelProsConsRepo.js'
);

beforeAll(async () => {
  await initDatabase();
});

beforeEach(async () => {
  await runQuery('DELETE FROM model_pros_cons');
});

describe('modelProsConsRepo', () => {
  it('returns null for missing model', async () => {
    expect(await getModelProsCons('Claude Sonnet 4.6')).toBeNull();
  });

  it('round-trips a row', async () => {
    await upsertModelProsCons('Claude Sonnet 4.6', ['p1', 'p2', 'p3'], ['c1', 'c2', 'c3']);
    const row = await getModelProsCons('Claude Sonnet 4.6');
    expect(row).not.toBeNull();
    expect(row!.pros).toEqual(['p1', 'p2', 'p3']);
    expect(row!.cons).toEqual(['c1', 'c2', 'c3']);
    expect(row!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('upsert replaces existing row', async () => {
    await upsertModelProsCons('Claude Haiku 4.5', ['a', 'b', 'c'], ['x', 'y', 'z']);
    await upsertModelProsCons('Claude Haiku 4.5', ['d', 'e', 'f'], ['u', 'v', 'w']);
    const row = await getModelProsCons('Claude Haiku 4.5');
    expect(row!.pros).toEqual(['d', 'e', 'f']);
    expect(row!.cons).toEqual(['u', 'v', 'w']);
  });
});
