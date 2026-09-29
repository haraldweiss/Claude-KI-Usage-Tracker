// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
/**
 * Concurrency hardening of the SQLite connection.
 *
 * Regression context (2026-09-29): node-sqlite3 defaults to
 * `journal_mode=delete` with a busy timeout of 0. The DB file is written by the
 * API server (container) and by the host-side benchmark agent, while the
 * dashboard reads it — a write storm could therefore fail instantly with
 * SQLITE_BUSY and a long read blocked writers. `applyConnectionPragmas()` is the
 * single place that configures this, so the test can exercise it directly
 * (native ESM has no module reload, so a DATABASE_PATH swap + re-import is not
 * an option here).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';

import { applyConnectionPragmas } from '../../database/sqlite.js';

describe('applyConnectionPragmas', () => {
  it('enables WAL, a busy timeout and foreign keys on a fresh database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiut-pragmas-'));
    const db = new sqlite3.Database(path.join(dir, 'pragmas.db'));

    try {
      // node-sqlite3 only guarantees statement order inside a serialize()
      // section (initDatabase() calls the helper the same way), and the pragmas
      // must be in effect before the assertions run.
      const results: Record<string, unknown> = {};
      await new Promise<void>((resolve, reject) => {
        db.serialize(() => {
          applyConnectionPragmas(db);
          db.get('PRAGMA journal_mode', (_e, row) => { results.journal = row; });
          db.get('PRAGMA busy_timeout', (_e, row) => { results.busy = row; });
          db.get('PRAGMA foreign_keys', (err: Error | null, row) => {
            results.fk = row;
            if (err) reject(err); else resolve();
          });
        });
      });

      const journal = results.journal as { journal_mode?: string };
      const busy = results.busy as { timeout?: number };
      const fk = results.fk as { foreign_keys?: number };

      expect(String(journal?.journal_mode).toLowerCase()).toBe('wal');
      expect(Number(busy?.timeout)).toBe(10000);
      expect(Number(fk?.foreign_keys)).toBe(1);
    } finally {
      await new Promise<void>((resolve) => db.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
