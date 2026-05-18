// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// CRUD helpers for catalog_hf_cache (Sub-B.1).
import { runQuery, getQuery } from '../database/sqlite.js';
import type { ModelCard } from '../services/catalogService.js';

export interface CacheRow {
  repo: string;
  card: ModelCard;
  fetched_at: string;
  last_error: string | null;
}

export async function upsertCardCache(
  repo: string, card: ModelCard, lastError: string | null,
): Promise<void> {
  await runQuery(
    `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at, last_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       data_json = excluded.data_json,
       fetched_at = excluded.fetched_at,
       last_error = excluded.last_error`,
    [repo, JSON.stringify(card), new Date().toISOString(), lastError],
  );
}

export async function recordCacheError(repo: string, error: string): Promise<void> {
  // Only updates last_error; preserves data_json and fetched_at so old data
  // stays visible while we track the recent refresh failure.
  await runQuery(
    `UPDATE catalog_hf_cache SET last_error = ? WHERE repo = ?`,
    [error, repo],
  );
}

export async function getCachedCard(repo: string): Promise<CacheRow | null> {
  const row = await getQuery<{
    repo: string;
    data_json: string;
    fetched_at: string;
    last_error: string | null;
  }>('SELECT * FROM catalog_hf_cache WHERE repo = ?', [repo]);
  if (!row) return null;
  return {
    repo: row.repo,
    card: JSON.parse(row.data_json) as ModelCard,
    fetched_at: row.fetched_at,
    last_error: row.last_error,
  };
}

export async function getOldestFetchedAt(): Promise<string | null> {
  const row = await getQuery<{ fetched_at: string | null }>(
    'SELECT MIN(fetched_at) AS fetched_at FROM catalog_hf_cache',
  );
  return row?.fetched_at ?? null;
}
