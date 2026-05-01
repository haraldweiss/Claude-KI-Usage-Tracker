import { allQuery, getQuery } from '../database/sqlite.js';

/**
 * Auto-scoped variants of the database query helpers. The SQL must use a
 * caller-controlled WHERE clause, but `user_id = ?` is appended automatically.
 *
 * Call site:
 *   db.allForUser('SELECT * FROM usage_records WHERE timestamp > ?', userId, [t])
 *   →  SELECT * FROM usage_records WHERE user_id = ? AND timestamp > ?
 *      params: [userId, t]
 *
 * If your SQL has no WHERE clause yet, the helper appends one.
 */

function appendUserScope(sql: string, userId: number, params: unknown[]): { sql: string; params: unknown[] } {
  const trimmed = sql.trim();
  const hasWhere = /\bWHERE\b/i.test(trimmed);
  const newSql = hasWhere
    ? trimmed.replace(/\bWHERE\b/i, 'WHERE user_id = ? AND ')
    : trimmed + ' WHERE user_id = ?';
  // user_id goes FIRST in the params array because we inserted it right after WHERE
  return { sql: newSql, params: hasWhere ? [userId, ...params] : [...params, userId] };
}

export async function allForUser<T = unknown>(
  sql: string, userId: number, params: unknown[] = []
): Promise<T[]> {
  const scoped = appendUserScope(sql, userId, params);
  return allQuery<T>(scoped.sql, scoped.params);
}

export async function getForUser<T = unknown>(
  sql: string, userId: number, params: unknown[] = []
): Promise<T | undefined> {
  const scoped = appendUserScope(sql, userId, params);
  return getQuery<T>(scoped.sql, scoped.params);
}
