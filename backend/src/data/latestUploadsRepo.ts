// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Index over catalog_hf_cache for the dynamic "Latest Uploads" section.
import { runQuery, allQuery } from '../database/sqlite.js';

export interface LatestUploadRow {
  position: number;
  repo: string;
  fetched_at: string;
}

export async function replaceLatestUploads(repos: string[]): Promise<void> {
  // Atomic replacement: clear all, then insert new ordering.
  // sqlite3's serialize ordering guarantees the DELETE finishes before INSERTs.
  const now = new Date().toISOString();
  await runQuery('DELETE FROM catalog_latest_uploads');
  for (let i = 0; i < repos.length; i++) {
    await runQuery(
      'INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES (?, ?, ?)',
      [i + 1, repos[i], now],
    );
  }
}

export async function listLatestUploads(): Promise<LatestUploadRow[]> {
  return allQuery<LatestUploadRow>(
    'SELECT position, repo, fetched_at FROM catalog_latest_uploads ORDER BY position ASC',
  );
}
