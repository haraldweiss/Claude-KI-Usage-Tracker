import type { Request, Response } from 'express';
import { runQuery, getQuery } from '../database/sqlite.js';
import { createApiToken, getActiveApiToken, revokeApiToken } from '../services/authService.js';
import type { User } from '../types/index.js';

export async function getAccount(req: Request, res: Response): Promise<void> {
  const u = req.user!;
  res.json({
    email: u.email,
    display_name: u.display_name,
    plan_name: u.plan_name,
    monthly_limit_eur: u.monthly_limit_eur,
    is_admin: u.is_admin === 1
  });
}

export async function patchAccount(req: Request, res: Response): Promise<void> {
  const u = req.user!;
  const { display_name, plan_name, monthly_limit_eur } = req.body || {};
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof display_name === 'string') { updates.push('display_name = ?'); values.push(display_name.slice(0, 100)); }
  if (typeof plan_name === 'string' || plan_name === null) { updates.push('plan_name = ?'); values.push(plan_name); }
  if (typeof monthly_limit_eur === 'number' || monthly_limit_eur === null) {
    updates.push('monthly_limit_eur = ?'); values.push(monthly_limit_eur);
  }
  if (updates.length === 0) { res.status(400).json({ error: 'nothing to update' }); return; }
  values.push(u.id);
  await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  const updated = await getQuery<User>('SELECT * FROM users WHERE id = ?', [u.id]);
  res.json(updated);
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  // CASCADE delete is configured on FK; usage_records, sessions, api_tokens go too
  await runQuery('DELETE FROM users WHERE id = ?', [req.user!.id]);
  // Use the same COOKIE_PATH env handling as authController for consistency
  const cookiePath = process.env.COOKIE_PATH || '/claudetracker/';
  res.clearCookie('cut_session', { path: cookiePath });
  res.status(204).send();
}

export async function getToken(req: Request, res: Response): Promise<void> {
  const t = await getActiveApiToken(req.user!.id);
  if (!t) { res.json(null); return; }
  res.json({ id: t.id, label: t.label, created_at: t.created_at, last_used_at: t.last_used_at });
}

export async function rotateToken(req: Request, res: Response): Promise<void> {
  const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 100) : 'Extension';
  const { plaintext, id } = await createApiToken(req.user!.id, label);
  res.status(201).json({ token: plaintext, id, label });
}

export async function revokeToken(req: Request, res: Response): Promise<void> {
  const t = await getActiveApiToken(req.user!.id);
  if (t) await revokeApiToken(req.user!.id, t.id);
  res.status(204).send();
}
