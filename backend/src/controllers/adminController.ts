import type { Request, Response } from 'express';
import { runQuery, allQuery, getQuery } from '../database/sqlite.js';

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await allQuery(`
    SELECT u.id, u.email, u.display_name, u.is_admin, u.plan_name, u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM usage_records WHERE user_id = u.id) as record_count
    FROM users u ORDER BY u.created_at DESC
  `);
  res.json({ users });
}

export async function patchUser(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (!isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const { display_name, plan_name, is_admin } = req.body || {};
  const updates: string[] = []; const values: unknown[] = [];
  if (typeof display_name === 'string' || display_name === null) { updates.push('display_name = ?'); values.push(display_name); }
  if (typeof plan_name === 'string' || plan_name === null) { updates.push('plan_name = ?'); values.push(plan_name); }
  if (typeof is_admin === 'boolean') { updates.push('is_admin = ?'); values.push(is_admin ? 1 : 0); }
  if (updates.length === 0) { res.status(400).json({ error: 'nothing to update' }); return; }
  values.push(id);
  await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  const updated = await getQuery('SELECT id, email, display_name, plan_name, is_admin FROM users WHERE id = ?', [id]);
  res.json(updated);
}

export async function deleteUser(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (id === req.user!.id) { res.status(400).json({ error: 'cannot delete yourself' }); return; }
  await runQuery('DELETE FROM users WHERE id = ?', [id]);
  res.status(204).send();
}

export async function adminStats(_req: Request, res: Response): Promise<void> {
  const totalUsers = await getQuery<{ n: number }>('SELECT COUNT(*) as n FROM users');
  const active7d = await getQuery<{ n: number }>(
    `SELECT COUNT(*) as n FROM users WHERE last_login_at > datetime('now', '-7 days')`
  );
  const totalRecords = await getQuery<{ n: number }>('SELECT COUNT(*) as n FROM usage_records');
  res.json({
    total_users: totalUsers?.n ?? 0,
    active_last_7d: active7d?.n ?? 0,
    total_records: totalRecords?.n ?? 0
  });
}
