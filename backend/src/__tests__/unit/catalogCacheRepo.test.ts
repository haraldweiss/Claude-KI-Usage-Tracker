// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  upsertCardCache,
  recordCacheError,
  getCachedCard,
  getOldestFetchedAt,
} = await import('../../data/catalogCacheRepo.js');

const sampleCard = {
  repo: 'bartowski/X-GGUF',
  size_b: 7,
  quant_count: 12,
  downloads: 1000,
  source_label: 'Bartowski',
  description: 'sample',
  default_quant: 'Q4_K_M',
  ollama_command: 'ollama run hf.co/bartowski/X-GGUF:Q4_K_M',
};

beforeAll(async () => {
  await initDatabase();
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_hf_cache');
});

describe('catalogCacheRepo', () => {
  it('upsertCardCache writes a new row and overwrites on conflict', async () => {
    await upsertCardCache('bartowski/X-GGUF', sampleCard, null);
    const after1 = await getCachedCard('bartowski/X-GGUF');
    expect(after1?.card.downloads).toBe(1000);
    expect(after1?.last_error).toBeNull();

    await upsertCardCache('bartowski/X-GGUF', { ...sampleCard, downloads: 2000 }, null);
    const after2 = await getCachedCard('bartowski/X-GGUF');
    expect(after2?.card.downloads).toBe(2000);
  });

  it('recordCacheError sets last_error without touching data_json', async () => {
    await upsertCardCache('bartowski/X-GGUF', sampleCard, null);
    await recordCacheError('bartowski/X-GGUF', 'HF 500');
    const after = await getCachedCard('bartowski/X-GGUF');
    expect(after?.last_error).toBe('HF 500');
    expect(after?.card.downloads).toBe(1000);
  });

  it('getCachedCard returns null for unknown repo', async () => {
    const r = await getCachedCard('does/not/exist');
    expect(r).toBeNull();
  });

  it('getOldestFetchedAt returns null for empty table', async () => {
    const r = await getOldestFetchedAt();
    expect(r).toBeNull();
  });

  it('getOldestFetchedAt returns the earliest fetched_at', async () => {
    await runQuery(
      `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at, last_error)
       VALUES ('a', ?, '2026-05-01T00:00:00', NULL),
              ('b', ?, '2026-05-02T00:00:00', NULL)`,
      [JSON.stringify(sampleCard), JSON.stringify(sampleCard)],
    );
    const oldest = await getOldestFetchedAt();
    expect(oldest).toBe('2026-05-01T00:00:00');
  });
});
