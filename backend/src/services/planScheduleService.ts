// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { getQuery } from '../database/sqlite.js';

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
