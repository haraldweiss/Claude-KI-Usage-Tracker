// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { getQuery, allQuery, runQuery } from '../database/sqlite.js';
import type { PendingPlanChange, PlanHistoryRow } from '../types/index.js';

/**
 * Authoritative source of "what plan is this user on right now".
 * Latest plan_history row with effective_from <= today (UTC),
 * tie-broken by id (later insert wins).
 */
export async function getCurrentPlan(userId: number): Promise<string | null> {
  const row = await getQuery<{ plan_name: string }>(
    `SELECT plan_name FROM plan_history
      WHERE user_id = ? AND effective_from <= date('now')
      ORDER BY effective_from DESC, id DESC
      LIMIT 1`,
    [userId]
  );
  return row?.plan_name ?? null;
}

/**
 * Next future plan change (effective_from strictly > today, UTC), or null.
 * Tie-broken by id ASC so the earliest-inserted wins among same-date rows.
 */
export async function getPendingPlanChange(
  userId: number
): Promise<PendingPlanChange | null> {
  const row = await getQuery<PendingPlanChange>(
    `SELECT id, plan_name, effective_from, note
       FROM plan_history
      WHERE user_id = ? AND effective_from > date('now')
      ORDER BY effective_from ASC, id ASC
      LIMIT 1`,
    [userId]
  );
  return row ?? null;
}

/**
 * Full plan history for a user, DESC by effective_from (then id DESC).
 * Pass `limit` to cap the number of rows returned.
 */
export async function getPlanHistory(
  userId: number,
  limit?: number
): Promise<PlanHistoryRow[]> {
  const sql =
    `SELECT id, user_id, plan_name, effective_from, created_at, source, note
       FROM plan_history
      WHERE user_id = ?
      ORDER BY effective_from DESC, id DESC` + (limit ? ' LIMIT ?' : '');
  const params: unknown[] = limit ? [userId, limit] : [userId];
  return allQuery<PlanHistoryRow>(sql, params);
}

/**
 * Insert a future plan change. Rejects past dates and unknown plan names.
 * Returns the new row id.
 */
export async function schedulePlanChange(
  userId: number,
  planName: string,
  effectiveFrom: string,
  note?: string
): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || isNaN(Date.parse(effectiveFrom))) {
    throw new Error('effective_from must be a valid ISO date (YYYY-MM-DD)');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (effectiveFrom < today) {
    throw new Error('effective_from must be today or later');
  }
  const known = await getQuery<{ plan_name: string }>(
    `SELECT plan_name FROM plan_pricing WHERE plan_name = ?`,
    [planName]
  );
  if (!known) {
    throw new Error(`unknown plan: ${planName}`);
  }
  const result = await runQuery(
    `INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
     VALUES (?, ?, ?, 'scheduled', ?)`,
    [userId, planName, effectiveFrom, note ?? null]
  );
  return result.lastID;
}

/**
 * Cancel all future plan changes for this user. Only deletes rows with
 * source='scheduled' — manual and seed rows are preserved even if they
 * happen to be future-dated (edge case, but explicit).
 * Returns number of rows deleted.
 */
export async function cancelPendingPlanChange(userId: number): Promise<number> {
  const result = await runQuery(
    `DELETE FROM plan_history
      WHERE user_id = ?
        AND effective_from > date('now')
        AND source = 'scheduled'`,
    [userId]
  );
  return result.changes;
}

/**
 * Append a 'manual' history entry for an immediate plan switch.
 * No-op when the new plan equals the user's current plan — avoids noise
 * when PATCH /api/account is called only to update display_name.
 */
export async function recordImmediatePlanChange(
  userId: number,
  planName: string,
  note?: string
): Promise<void> {
  const current = await getCurrentPlan(userId);
  if (current === planName) return;
  const today = new Date().toISOString().slice(0, 10);
  await runQuery(
    `INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
     VALUES (?, ?, ?, 'manual', ?)`,
    [userId, planName, today, note ?? null]
  );
}

interface UserSyncRow { id: number; plan_name: string | null }

/**
 * Cron entry point. For every user whose users.plan_name diverges from
 * getCurrentPlan(), update users.plan_name. Returns count of users synced.
 */
export async function applyDuePlanChanges(): Promise<number> {
  const users = await allQuery<UserSyncRow>(`SELECT id, plan_name FROM users`);
  let synced = 0;
  for (const u of users) {
    try {
      const current = await getCurrentPlan(u.id);
      if (current !== null && current !== u.plan_name) {
        await runQuery(
          `UPDATE users SET plan_name = ? WHERE id = ?`,
          [current, u.id]
        );
        console.log(
          `[planSchedule] user ${u.id}: ${u.plan_name ?? 'NULL'} → ${current}`
        );
        synced++;
      }
    } catch (err) {
      console.error(
        `[planSchedule] sync failed for user ${u.id}:`,
        (err as Error).message
      );
    }
  }
  return synced;
}
