import crypto from 'crypto';
import { runQuery, getQuery } from '../database/sqlite.js';
import type { MagicLinkTokenRow, User } from '../types/index.js';

const MAGIC_LINK_TTL_MIN = 15;

export async function createMagicLinkToken(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  // Invalidate any outstanding unused tokens for this email
  await runQuery(
    `UPDATE magic_link_tokens SET consumed_at = datetime('now')
     WHERE email = ? AND consumed_at IS NULL`,
    [normalized]
  );
  const token = crypto.randomBytes(32).toString('hex');
  await runQuery(
    `INSERT INTO magic_link_tokens (token, email, expires_at)
     VALUES (?, ?, datetime('now', '+${MAGIC_LINK_TTL_MIN} minutes'))`,
    [token, normalized]
  );
  return token;
}

export async function consumeMagicLinkToken(token: string): Promise<{ email: string }> {
  // Atomic single-statement consume: only un-consumed AND non-expired tokens
  // get marked. If 0 rows changed, look up the row to figure out which error
  // to report (not found / already consumed / expired).
  const result = await runQuery(
    `UPDATE magic_link_tokens
     SET consumed_at = datetime('now')
     WHERE token = ?
       AND consumed_at IS NULL
       AND datetime(expires_at) > datetime('now')`,
    [token]
  );

  if (result.changes === 1) {
    // Successfully consumed — fetch email to return
    const row = await getQuery<MagicLinkTokenRow>(
      'SELECT email FROM magic_link_tokens WHERE token = ?',
      [token]
    );
    if (!row) throw new Error('token not found');  // shouldn't happen, paranoia
    return { email: row.email };
  }

  // Disambiguate the failure
  const row = await getQuery<MagicLinkTokenRow>(
    'SELECT * FROM magic_link_tokens WHERE token = ?',
    [token]
  );
  if (!row) throw new Error('token not found');
  if (row.consumed_at) throw new Error('already consumed');
  // Expired (the only remaining failure mode given the WHERE clause)
  throw new Error('expired');
}

// ── Session lifecycle ────────────────────────────────────────────────────────

const SESSION_TTL_DAYS = 30;

export async function createSession(
  userId: number,
  userAgent: string | null,
  ipAddress: string | null
): Promise<string> {
  const sid = crypto.randomBytes(32).toString('hex');
  await runQuery(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address)
     VALUES (?, ?, datetime('now', '+${SESSION_TTL_DAYS} days'), ?, ?)`,
    [sid, userId, userAgent, ipAddress]
  );
  await runQuery(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [userId]);
  return sid;
}

export async function getSessionUser(sessionId: string): Promise<User | null> {
  // Expiry check is performed at SQL level (consistent with B3's atomic-consume pattern)
  // to avoid JS Date timezone-parsing pitfalls with SQLite's UTC string format.
  const row = await getQuery<User>(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?
       AND datetime(s.expires_at) > datetime('now')`,
    [sessionId]
  );
  return row ?? null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await runQuery('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export async function touchSession(sessionId: string): Promise<void> {
  await runQuery(
    `UPDATE sessions SET expires_at = datetime('now', '+${SESSION_TTL_DAYS} days') WHERE id = ?`,
    [sessionId]
  );
}
