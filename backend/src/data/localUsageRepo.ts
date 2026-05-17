// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// DB helpers for the local-LLM-tracking feature. Wraps node-sqlite3 via the
// shared runQuery/getQuery/allQuery helpers from database/sqlite.ts.
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';

export interface ProviderServiceConfigRow {
  user_id: number;
  service_url: string;
  service_token_enc: string;
  provider_user_id: string;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  last_sync_error: string | null;
  enabled: number;
}

export interface ProviderServiceConfigInput {
  service_url: string;
  service_token_enc: string;
  provider_user_id: string;
  enabled: number;
}

export interface RemoteEvent {
  remote_event_id: number;
  remote_created_at: string;
  provider_id: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  origin_app: string | null;
  status: string;
  error_message: string | null;
}

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModels: Array<{ model: string; calls: number }>;
}

export interface SyncStatusUpdate {
  last_sync_at?: string;
  last_sync_cursor?: string | null;
  last_sync_error?: string | null;
}

export interface ProviderUserIdRow {
  id: number;
  user_id: number;
  provider_user_id: string;
  label: string | null;
  enabled: number;
  last_sync_at: string | null;
  last_sync_cursor: string | null;
  last_sync_error: string | null;
}

export async function upsertProviderServiceConfig(
  userId: number, input: ProviderServiceConfigInput,
): Promise<void> {
  const now = new Date().toISOString();
  await runQuery(
    `INSERT INTO user_provider_service_config
      (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       service_url = excluded.service_url,
       service_token_enc = excluded.service_token_enc,
       provider_user_id = excluded.provider_user_id,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [userId, input.service_url, input.service_token_enc, input.provider_user_id,
     input.enabled, now, now],
  );
}

export async function getProviderServiceConfig(
  userId: number,
): Promise<ProviderServiceConfigRow | null> {
  const row = await getQuery<ProviderServiceConfigRow>(
    'SELECT * FROM user_provider_service_config WHERE user_id = ?',
    [userId],
  );
  return row ?? null;
}

export async function listUsersWithProviderServiceConfig(): Promise<Array<{ user_id: number }>> {
  return allQuery<{ user_id: number }>(
    'SELECT user_id FROM user_provider_service_config WHERE enabled = 1',
  );
}

export async function updateSyncStatus(
  userId: number, update: SyncStatusUpdate,
): Promise<void> {
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [new Date().toISOString()];

  if (update.last_sync_at !== undefined) {
    sets.push('last_sync_at = ?');
    params.push(update.last_sync_at);
  }
  if (update.last_sync_cursor !== undefined) {
    sets.push('last_sync_cursor = ?');
    params.push(update.last_sync_cursor);
  }
  if (update.last_sync_error !== undefined) {
    sets.push('last_sync_error = ?');
    params.push(update.last_sync_error);
  }
  params.push(userId);

  await runQuery(
    `UPDATE user_provider_service_config SET ${sets.join(', ')} WHERE user_id = ?`,
    params,
  );
}

export async function insertEventIfNew(
  userId: number, ev: RemoteEvent,
): Promise<boolean> {
  const result = await runQuery(
    `INSERT OR IGNORE INTO provider_service_events
      (user_id, remote_event_id, remote_created_at, provider_id, model,
       input_tokens, output_tokens, cost_usd, origin_app, status, error_message, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, ev.remote_event_id, ev.remote_created_at, ev.provider_id, ev.model,
      ev.input_tokens, ev.output_tokens, ev.cost_usd, ev.origin_app, ev.status,
      ev.error_message, new Date().toISOString(),
    ],
  );
  return result.changes > 0;
}

function periodSinceISO(period: 'day' | 'week' | 'month'): string {
  const d = new Date();
  if (period === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const dow = d.getDay() || 7;
    d.setDate(d.getDate() - (dow - 1));
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

interface AggRow { calls: number; inputTokens: number; outputTokens: number }

export async function getLocalUsageSummary(
  userId: number, period: 'day' | 'week' | 'month',
): Promise<LocalUsageSummary> {
  const since = periodSinceISO(period);

  const agg = await getQuery<AggRow>(
    `SELECT
       COUNT(*) AS calls,
       COALESCE(SUM(input_tokens), 0) AS inputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens
     FROM provider_service_events
     WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'`,
    [userId, since],
  );

  const calls = agg?.calls ?? 0;
  const inputTokens = agg?.inputTokens ?? 0;
  const outputTokens = agg?.outputTokens ?? 0;

  const topModels = await allQuery<{ model: string; calls: number }>(
    `SELECT model, COUNT(*) AS calls
     FROM provider_service_events
     WHERE user_id = ? AND remote_created_at >= ? AND status = 'success'
     GROUP BY model
     ORDER BY calls DESC
     LIMIT 3`,
    [userId, since],
  );

  const totalTokens = inputTokens + outputTokens;
  const avgTokensPerCall = calls > 0 ? Math.round(totalTokens / calls) : 0;

  return {
    period,
    calls,
    inputTokens,
    outputTokens,
    totalTokens,
    avgTokensPerCall,
    topModels,
  };
}

// ---------------------------------------------------------------------------
// Sub-A.1: per-provider_user_id CRUD on provider_service_user_ids
// ---------------------------------------------------------------------------

export async function addProviderUserId(
  userId: number, providerUserId: string, label: string | null = null,
): Promise<ProviderUserIdRow> {
  const now = new Date().toISOString();
  const res = await runQuery(
    `INSERT INTO provider_service_user_ids
       (user_id, provider_user_id, label, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [userId, providerUserId, label, now, now],
  );
  const row = await getQuery<ProviderUserIdRow>(
    'SELECT * FROM provider_service_user_ids WHERE id = ?',
    [res.lastID],
  );
  if (!row) throw new Error('insert failed');
  return row;
}

export async function listProviderUserIds(
  userId: number,
): Promise<ProviderUserIdRow[]> {
  return allQuery<ProviderUserIdRow>(
    'SELECT * FROM provider_service_user_ids WHERE user_id = ? ORDER BY id ASC',
    [userId],
  );
}

export async function getProviderUserIdRow(
  rowId: number, userId: number,
): Promise<ProviderUserIdRow | null> {
  const row = await getQuery<ProviderUserIdRow>(
    'SELECT * FROM provider_service_user_ids WHERE id = ? AND user_id = ?',
    [rowId, userId],
  );
  return row ?? null;
}

export async function removeProviderUserId(
  rowId: number, userId: number,
): Promise<boolean> {
  const res = await runQuery(
    'DELETE FROM provider_service_user_ids WHERE id = ? AND user_id = ?',
    [rowId, userId],
  );
  return res.changes > 0;
}

export async function setProviderUserIdEnabled(
  rowId: number, userId: number, enabled: boolean,
): Promise<boolean> {
  const res = await runQuery(
    'UPDATE provider_service_user_ids SET enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [enabled ? 1 : 0, new Date().toISOString(), rowId, userId],
  );
  return res.changes > 0;
}

export async function updateProviderUserIdLabel(
  rowId: number, userId: number, label: string | null,
): Promise<boolean> {
  const res = await runQuery(
    'UPDATE provider_service_user_ids SET label = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [label, new Date().toISOString(), rowId, userId],
  );
  return res.changes > 0;
}
