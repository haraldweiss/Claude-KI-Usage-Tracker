import type { Request, Response } from 'express';
import { createMagicLinkToken, consumeMagicLinkToken, createSession, deleteSession, getSessionUser } from '../services/authService.js';
import { sendMagicLinkMail } from '../services/mailService.js';
import { runQuery, getQuery } from '../database/sqlite.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';
import type { User } from '../types/index.js';

const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'https://wolfinisoftware.de/claudetracker/auth/verify';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/claudetracker/',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

const requestRateLimit = new Map<string, number[]>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_PER_IP = 5;
const RATE_MAX_PER_EMAIL = 3;

function isRateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const hits = (requestRateLimit.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= max) return true;
  hits.push(now);
  requestRateLimit.set(key, hits);
  return false;
}

export async function requestMagicLink(req: Request, res: Response): Promise<void> {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const ip = req.ip || 'unknown';
  if (!email || !email.includes('@')) {
    // Always 200 — no enumeration leak
    res.json({ ok: true });
    return;
  }
  if (isRateLimited(`ip:${ip}`, RATE_MAX_PER_IP) || isRateLimited(`email:${email}`, RATE_MAX_PER_EMAIL)) {
    res.json({ ok: true });
    return;
  }
  try {
    const token = await createMagicLinkToken(email);
    await sendMagicLinkMail(email, token, VERIFY_BASE_URL);
  } catch (err) {
    console.error('[auth] mail send failed:', (err as Error).message);
    // Still 200 — token row stays in DB for retry / no enumeration leak
  }
  res.json({ ok: true });
}

/**
 * Renders an HTML page with a "Log in" button. The button POSTs back to
 * /api/auth/verify which actually consumes the token. This intermediate
 * step prevents mail-scanner GET requests (Outlook, Apple Mail) from
 * burning the token.
 */
export async function showVerifyPage(req: Request, res: Response): Promise<void> {
  const token = String(req.query.token || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><title>Login</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center}
button{font-size:18px;padding:12px 32px;background:#3B82F6;color:white;border:none;border-radius:8px;cursor:pointer}
button:hover{background:#2563EB}</style></head><body>
<h1>Login bestätigen</h1>
<p>Klicke auf den Button um dich anzumelden.</p>
<form method="POST" action="/claudetracker/api/auth/verify">
  <input type="hidden" name="token" value="${token.replace(/"/g, '&quot;')}">
  <button type="submit">Einloggen</button>
</form>
</body></html>`);
}

export async function consumeVerify(req: Request, res: Response): Promise<void> {
  const token = String(req.body?.token || req.query?.token || '');
  try {
    const { email } = await consumeMagicLinkToken(token);
    let user = await getQuery<User>('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      // Open signup: implicit user creation on first verified login
      const display = email.split('@')[0];
      const result = await runQuery(
        `INSERT INTO users (email, display_name) VALUES (?, ?)`,
        [email, display]
      );
      user = await getQuery<User>('SELECT * FROM users WHERE id = ?', [result.lastID]);
    }
    if (!user) throw new Error('user creation failed');
    const sid = await createSession(user.id, req.headers['user-agent'] || null, req.ip || null);
    res.cookie(SESSION_COOKIE_NAME, sid, COOKIE_OPTS);
    res.redirect('/claudetracker/');
  } catch (err) {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center">
      <h1>Login fehlgeschlagen</h1><p>${(err as Error).message}. <a href="/claudetracker/login">Neuen Link anfordern</a></p>
      </body></html>`
    );
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE_NAME];
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/claudetracker/' });
  res.status(204).send();
}

export async function whoami(req: Request, res: Response): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sid) { res.status(401).json({ error: 'no session' }); return; }
  const user = await getSessionUser(sid);
  if (!user) { res.status(401).json({ error: 'invalid session' }); return; }
  res.json({ id: user.id, email: user.email, display_name: user.display_name,
             plan_name: user.plan_name, monthly_limit_eur: user.monthly_limit_eur,
             is_admin: user.is_admin === 1 });
}
