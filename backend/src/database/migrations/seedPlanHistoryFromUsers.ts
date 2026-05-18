// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { runQuery } from '../sqlite.js';

/**
 * One-time backfill: for every user that has a plan_name set but no
 * plan_history entry yet, create a seed entry effective from their
 * users.created_at date. Idempotent — safe to run on every startup.
 */
export async function seedPlanHistoryFromUsers(): Promise<void> {
  await runQuery(
    `INSERT INTO plan_history (user_id, plan_name, effective_from, source, note)
     SELECT u.id,
            u.plan_name,
            substr(COALESCE(u.created_at, datetime('now')), 1, 10),
            'seed',
            'Backfill from users.plan_name at migration time'
       FROM users u
      WHERE u.plan_name IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM plan_history h WHERE h.user_id = u.id
        )`
  );
}
