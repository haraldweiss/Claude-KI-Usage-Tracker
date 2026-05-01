import { runQuery, getQuery } from '../sqlite.js';

/**
 * One-time migration: ensure user 1 (harald) exists and that all pre-existing
 * usage_records / model_analysis rows are tagged with user_id = 1. Idempotent —
 * safe to run on every startup.
 */
export async function seedInitialUser(): Promise<void> {
  const existing = await getQuery<{ count: number }>('SELECT COUNT(*) as count FROM users');
  if (existing && existing.count > 0) return;  // already seeded

  await runQuery(
    `INSERT INTO users (id, email, display_name, is_admin, plan_name, monthly_limit_eur)
     VALUES (1, ?, ?, 1, ?, ?)`,
    ['anubclaw@gmail.com', 'Harald', 'Max (5x)', 50.0]
  );

  await runQuery('UPDATE usage_records SET user_id = 1 WHERE user_id IS NULL');
  await runQuery('UPDATE model_analysis SET user_id = 1 WHERE user_id IS NULL');

  console.log('[migration] Seeded initial user (harald) and backfilled user_id columns');
}
