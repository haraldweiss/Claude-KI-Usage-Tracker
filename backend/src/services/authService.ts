import crypto from 'crypto';
import { runQuery, getQuery } from '../database/sqlite.js';
import type { MagicLinkTokenRow } from '../types/index.js';

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
  const row = await getQuery<MagicLinkTokenRow>(
    'SELECT * FROM magic_link_tokens WHERE token = ?',
    [token]
  );
  if (!row) throw new Error('token not found');
  if (row.consumed_at) throw new Error('already consumed');
  if (new Date(row.expires_at + ' UTC') < new Date()) throw new Error('expired');
  await runQuery(
    `UPDATE magic_link_tokens SET consumed_at = datetime('now') WHERE token = ?`,
    [token]
  );
  return { email: row.email };
}
