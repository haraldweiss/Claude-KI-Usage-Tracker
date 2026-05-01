import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import type { MagicLinkTokenRow, User, ApiTokenRow } from '../types/index.js';

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

// ── API tokens ───────────────────────────────────────────────────────────────

const TOKEN_PREFIX = 'ck_live_';
const BCRYPT_ROUNDS = 10;

export async function createApiToken(
  userId: number,
  label: string | null
): Promise<{ plaintext: string; id: number }> {
  // Revoke existing active token for this user (one-active-per-user rule
  // enforced by partial unique index — pre-revoking avoids the constraint)
  await runQuery(
    `UPDATE api_tokens SET revoked_at = datetime('now')
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  const random = crypto.randomBytes(32).toString('hex');
  const plaintext = `${TOKEN_PREFIX}${random}`;
  const hash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  const result = await runQuery(
    `INSERT INTO api_tokens (user_id, token_hash, label) VALUES (?, ?, ?)`,
    [userId, hash, label]
  );
  return { plaintext, id: result.lastID };
}

export async function getActiveApiToken(userId: number): Promise<ApiTokenRow | null> {
  return (await getQuery<ApiTokenRow>(
    `SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  )) ?? null;
}

export async function revokeApiToken(userId: number, tokenId: number): Promise<void> {
  await runQuery(
    `UPDATE api_tokens SET revoked_at = datetime('now')
     WHERE user_id = ? AND id = ? AND revoked_at IS NULL`,
    [userId, tokenId]
  );
}

export async function findUserByApiToken(plaintext: string): Promise<User | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  // Iterate non-revoked tokens; bcrypt.compare against each.
  // Acceptable at < ~1k active tokens. Switch to prefix-indexed lookup if scale grows.
  const candidates = await allQuery<ApiTokenRow>(
    `SELECT * FROM api_tokens WHERE revoked_at IS NULL`
  );
  for (const row of candidates) {
    if (await bcrypt.compare(plaintext, row.token_hash)) {
      // Throttle last_used_at writes to once per 5 minutes
      const last = row.last_used_at ? new Date(row.last_used_at + ' UTC').getTime() : 0;
      if (Date.now() - last > 5 * 60 * 1000) {
        await runQuery(
          `UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?`,
          [row.id]
        );
      }
      return await getQuery<User>('SELECT * FROM users WHERE id = ?', [row.user_id]) ?? null;
    }
  }
  return null;
}
