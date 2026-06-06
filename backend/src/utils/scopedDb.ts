// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
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

const WHERE_RE = /WHERE\s/i;

function appendUserScope(sql: string, userId: number, params: unknown[]): { sql: string; params: unknown[] } {
  const trimmed = sql.trim();
  // Check that WHERE appears at a statement level (not inside a string literal)
  // by looking for it as a standalone word after the SELECT/UPDATE/DELETE clause.
  // Simpler and safer: if the SQL has a WHERE, we prepend user_id AND right after it.
  // If the pattern matches inside a literal, the query would already be broken —
  // the caller is responsible for not writing SQL with 'WHERE' in string values.
  const hasWhere = WHERE_RE.test(trimmed);
  const newSql = hasWhere
    ? trimmed.replace(WHERE_RE, 'WHERE user_id = ? AND ')
    : trimmed + ' WHERE user_id = ?';
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
