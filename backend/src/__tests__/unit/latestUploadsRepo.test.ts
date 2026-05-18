// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { replaceLatestUploads, listLatestUploads } = await import(
  '../../data/latestUploadsRepo.js'
);

beforeAll(async () => {
  await initDatabase();
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_latest_uploads');
});

describe('latestUploadsRepo', () => {
  it('replaceLatestUploads writes rows with sequential positions', async () => {
    await replaceLatestUploads(['a/x', 'b/y', 'c/z']);
    const rows = await listLatestUploads();
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.repo)).toEqual(['a/x', 'b/y', 'c/z']);
    expect(rows[0]?.fetched_at).toMatch(/^2\d{3}-/);
  });

  it('replaceLatestUploads replaces (not appends) on second call', async () => {
    await replaceLatestUploads(['a/x', 'b/y', 'c/z']);
    await replaceLatestUploads(['p/q', 'r/s']);
    const rows = await listLatestUploads();
    expect(rows.map((r) => r.repo)).toEqual(['p/q', 'r/s']);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it('replaceLatestUploads with empty array clears the table', async () => {
    await replaceLatestUploads(['a/x', 'b/y']);
    await replaceLatestUploads([]);
    const rows = await listLatestUploads();
    expect(rows).toHaveLength(0);
  });

  it('listLatestUploads orders by position ASC', async () => {
    await runQuery(
      `INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES
       (3, 'c/z', '2026-05-18T00:00:00'),
       (1, 'a/x', '2026-05-18T00:00:00'),
       (2, 'b/y', '2026-05-18T00:00:00')`,
    );
    const rows = await listLatestUploads();
    expect(rows.map((r) => r.repo)).toEqual(['a/x', 'b/y', 'c/z']);
  });
});
