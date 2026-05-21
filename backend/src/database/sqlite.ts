// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ModelAnalysisInsert } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../database.sqlite');

/**
 * Column definition structure for database migrations
 */
interface ColumnDefinition {
  name: string;
  ddl: string;
}

/**
 * PRAGMA table info result structure
 */
interface TableInfo {
  name: string;
  [key: string]: unknown;
}

/**
 * Database query result with insert/update metadata
 */
interface DatabaseQueryResult {
  lastID: number;
  changes: number;
}

let db: sqlite3.Database;

/**
 * Get or initialize database connection
 * @returns sqlite3.Database instance
 */
function getDb(): sqlite3.Database {
  if (!db) {
    db = new sqlite3.Database(DB_PATH);
  }
  return db;
}

/**
 * Initialize database tables
 */
export function initDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.serialize(() => {
      // SQLite disables foreign-key enforcement by default and re-disables it on
      // every new connection. Required for the ON DELETE CASCADE declarations on
      // sessions/api_tokens to actually fire when a user is deleted.
      database.run('PRAGMA foreign_keys = ON');

      // Usage records table
      database.run(`
        CREATE TABLE IF NOT EXISTS usage_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          cost REAL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          conversation_id TEXT,
          source TEXT DEFAULT 'claude_ai',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          task_description TEXT,
          success_status TEXT DEFAULT 'unknown',
          response_metadata TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Pricing table
      database.run(`
        CREATE TABLE IF NOT EXISTS pricing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL UNIQUE,
          input_price REAL NOT NULL,
          output_price REAL NOT NULL,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT DEFAULT 'anthropic'
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Model analysis table (cached statistics)
      database.run(`
        CREATE TABLE IF NOT EXISTS model_analysis (
          model TEXT PRIMARY KEY,
          total_requests INTEGER DEFAULT 0,
          success_rate REAL DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          avg_input_tokens REAL DEFAULT 0,
          avg_output_tokens REAL DEFAULT 0,
          cost_per_request REAL DEFAULT 0,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // claude.ai plan subscription pricing — flat monthly fees per plan
      // (not exposed by Anthropic in any public API; seed with current values
      // and let the user edit via Settings, plus a best-effort daily refresh
      // that scrapes the public pricing page).
      database.run(`
        CREATE TABLE IF NOT EXISTS plan_pricing (
          plan_name TEXT PRIMARY KEY,
          monthly_eur REAL NOT NULL,
          min_seats INTEGER DEFAULT 1,
          source TEXT DEFAULT 'manual',
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Daily exchange-rate snapshots from the public Frankfurter API
      // (https://www.frankfurter.app, ECB-backed, free, no auth). We persist
      // each day's rate so the dashboard can show consistent EUR equivalents
      // even if the Frankfurter API is briefly unreachable.
      database.run(`
        CREATE TABLE IF NOT EXISTS exchange_rates (
          currency_pair TEXT NOT NULL,
          rate REAL NOT NULL,
          rate_date TEXT NOT NULL,
          fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (currency_pair, rate_date)
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Multi-user SaaS tables (Phase A — additive only, no behavior change)
      database.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT,
          is_admin INTEGER NOT NULL DEFAULT 0,
          plan_name TEXT,
          monthly_limit_eur REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_login_at TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Plan-change schedule + audit trail. See spec
      // 2026-05-18-tracker-plan-scheduling-design.md
      database.run(`
        CREATE TABLE IF NOT EXISTS plan_history (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan_name       TEXT NOT NULL,
          effective_from  TEXT NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          source          TEXT NOT NULL DEFAULT 'manual',
          note            TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });
      database.run(
        `CREATE INDEX IF NOT EXISTS idx_plan_history_user_date
           ON plan_history(user_id, effective_from)`,
        (err: Error | null) => {
          if (err && !err.message.includes('already exists')) reject(err);
        }
      );

      database.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          user_agent TEXT,
          ip_address TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      database.run(`
        CREATE TABLE IF NOT EXISTS magic_link_tokens (
          token TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          consumed_at TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      database.run(`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT,
          revoked_at TEXT
        )
      `, (err: Error | null) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Create indexes
      database.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_records(timestamp)');
      database.run('CREATE INDEX IF NOT EXISTS idx_model ON usage_records(model)');
      database.run('CREATE INDEX IF NOT EXISTS idx_source ON usage_records(source)');
      database.run('CREATE INDEX IF NOT EXISTS idx_usage_success_status ON usage_records(success_status)');
      database.run('CREATE INDEX IF NOT EXISTS idx_usage_task_desc ON usage_records(task_description)');
      database.run('CREATE INDEX IF NOT EXISTS idx_pricing_model ON pricing(model)', async (err: Error | null) => {
        if (err) return reject(err);
        // After tables and indexes exist, run additive column migrations and
        // the source-value rewrite. Awaited here so callers (seedFromFallback)
        // can rely on the new columns being present when initDatabase resolves.
        try {
          await addMissingColumns('usage_records', [
            { name: 'task_description', ddl: 'TEXT' },
            { name: 'success_status', ddl: "TEXT DEFAULT 'unknown'" },
            { name: 'response_metadata', ddl: 'TEXT' },
            // DEAD COLUMNS — added for an abandoned per-message Haiku
            // categorization design (claude.ai's web UI doesn't expose
            // per-message data anymore). No code reads or writes these,
            // they're left behind to avoid a destructive migration on
            // user databases. Drop in a future major release.
            { name: 'category', ddl: "TEXT DEFAULT 'Pending'" },
            { name: 'effectiveness_score', ddl: 'REAL' },
            { name: 'effectiveness_confirmed', ddl: 'INTEGER DEFAULT 0' },
            { name: 'user_category_override', ddl: 'TEXT' },
            { name: 'haiku_reasoning', ddl: 'TEXT' },
            // Plan B: combined claude.ai + Console API tracking. Console
            // sync rows fill workspace/key_name/key_id_suffix/cost_usd;
            // claude.ai sync rows leave them NULL.
            { name: 'workspace', ddl: 'TEXT' },
            { name: 'key_name', ddl: 'TEXT' },
            { name: 'key_id_suffix', ddl: 'TEXT' },
            { name: 'cost_usd', ddl: 'REAL' },
            { name: 'user_id', ddl: 'INTEGER REFERENCES users(id)' }
          ]);
          // Indexes for the new categorization columns
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_usage_category ON usage_records(category)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
            );
          });
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_usage_effectiveness_confirmed ON usage_records(effectiveness_confirmed)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
            );
          });
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_usage_workspace ON usage_records(workspace)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
            );
          });
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_records(user_id, timestamp)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res()));
          });
          // Indexes for multi-user SaaS tables
          await new Promise<void>((res, rej) => {
            database.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res()));
          });
          await new Promise<void>((res, rej) => {
            database.run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res()));
          });
          // Partial: every login flow only ever queries un-consumed tokens by email,
          // so excluding consumed rows keeps the index narrow.
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email_active ON magic_link_tokens(email) WHERE consumed_at IS NULL',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res()));
          });
          // Partial UNIQUE: enforces "exactly one active API token per user".
          // Token rotation flow: UPDATE sets revoked_at on the old row, then INSERT
          // creates the new row — both inside one transaction, no race window.
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_token_per_user ON api_tokens(user_id) WHERE revoked_at IS NULL',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res()));
          });
          await addMissingColumns('pricing', [
            { name: 'api_id', ddl: 'TEXT' },
            { name: 'status', ddl: "TEXT DEFAULT 'active'" },
            { name: 'tier', ddl: 'TEXT' }
          ]);
          await addMissingColumns('plan_pricing', [
            { name: 'min_seats', ddl: 'INTEGER DEFAULT 1' }
          ]);
          await addMissingColumns('model_analysis', [
            { name: 'user_id', ddl: 'INTEGER REFERENCES users(id)' }
          ]);
          await new Promise<void>((res, rej) => {
            database.run(
              "UPDATE pricing SET source = 'auto' WHERE source = 'anthropic'",
              (uErr: Error | null) => (uErr ? rej(uErr) : res())
            );
          });
          const { seedInitialUser } = await import('./migrations/seedInitialUser.js');
          await seedInitialUser();
          const { seedPlanHistoryFromUsers } = await import('./migrations/seedPlanHistoryFromUsers.js');
          await seedPlanHistoryFromUsers();

          // Provider-Service integration tables (Sub-project A: local LLM tracking).
          // 1:0..1 with users — each tracker user can configure one ai-provider-service
          // endpoint they want to pull usage events from.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS user_provider_service_config (
                user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                service_url        TEXT NOT NULL,
                service_token_enc  TEXT NOT NULL,
                provider_user_id   TEXT NOT NULL,
                last_sync_at       TEXT,
                last_sync_cursor   TEXT,
                last_sync_error    TEXT,
                enabled            INTEGER NOT NULL DEFAULT 1,
                created_at         TEXT NOT NULL,
                updated_at         TEXT NOT NULL
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });
          // Mirror of /usage/events from the provider-service. UNIQUE makes
          // INSERT OR IGNORE idempotent — even if the cursor is wrong we never
          // double-count.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS provider_service_events (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                remote_event_id   INTEGER NOT NULL,
                remote_created_at TEXT NOT NULL,
                provider_id       TEXT NOT NULL,
                model             TEXT NOT NULL,
                input_tokens      INTEGER,
                output_tokens     INTEGER,
                cost_usd          REAL,
                origin_app        TEXT,
                status            TEXT NOT NULL,
                error_message     TEXT,
                ingested_at       TEXT NOT NULL,
                UNIQUE (user_id, remote_event_id)
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_pse_user_created ON provider_service_events(user_id, remote_created_at)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
            );
          });
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_pse_provider ON provider_service_events(user_id, provider_id)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
            );
          });

          // Sub-A.1: provider_user_id on events (additive). Used by the multi-source
          // card to fall back from origin_app to "user:<provider_user_id>" when the
          // upstream app does not set the X-Origin-App header. Defensive on existing
          // production rows: nullable.
          await addMissingColumns('provider_service_events', [
            { name: 'provider_user_id', ddl: 'TEXT' },
          ]);

          // Sub-A.1: 1:N — multiple provider_user_ids per tracker-user. Replaces the
          // single column user_provider_service_config.provider_user_id (kept for one
          // release as rollback safety net). Each row tracks its own sync cursor so a
          // failing/slow ID doesn't poison another ID's incremental state.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS provider_service_user_ids (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                provider_user_id  TEXT NOT NULL,
                label             TEXT,
                enabled           INTEGER NOT NULL DEFAULT 1,
                last_sync_at      TEXT,
                last_sync_cursor  TEXT,
                last_sync_error   TEXT,
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL,
                UNIQUE (user_id, provider_user_id)
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });
          await new Promise<void>((res, rej) => {
            database.run(
              'CREATE INDEX IF NOT EXISTS idx_psuid_user_enabled ON provider_service_user_ids(user_id, enabled)',
              (idxErr: Error | null) => (idxErr ? rej(idxErr) : res())
            );
          });

          // Migration: copy existing provider_user_id from user_provider_service_config
          // into the new table. Idempotent via NOT EXISTS so reruns are safe.
          await new Promise<void>((res, rej) => {
            database.run(
              `INSERT INTO provider_service_user_ids
                 (user_id, provider_user_id, label, enabled, last_sync_at, last_sync_cursor, last_sync_error, created_at, updated_at)
               SELECT
                 upsc.user_id, upsc.provider_user_id, NULL, upsc.enabled,
                 upsc.last_sync_at, upsc.last_sync_cursor, upsc.last_sync_error,
                 upsc.created_at, upsc.updated_at
               FROM user_provider_service_config upsc
               WHERE upsc.provider_user_id IS NOT NULL
                 AND upsc.provider_user_id != ''
                 AND NOT EXISTS (
                   SELECT 1 FROM provider_service_user_ids psuid
                   WHERE psuid.user_id = upsc.user_id
                     AND psuid.provider_user_id = upsc.provider_user_id
                 )`,
              (mErr: Error | null) => (mErr ? rej(mErr) : res())
            );
          });

          // Sub-B.1: HF metadata cache. Filled daily by the catalogCacheRefresh cron
          // (and once on startup if empty). Page-load reads from here instead of
          // hitting the HF API for each curated model.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS catalog_hf_cache (
                repo        TEXT PRIMARY KEY,
                data_json   TEXT NOT NULL,
                fetched_at  TEXT NOT NULL,
                last_error  TEXT
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });

          // Sub-B.2: index table for the dynamic "Latest Uploads" section.
          // Holds the top 6 repos by lastModified across the configured
          // quanters. Refreshed daily by catalogCacheRefresh.refreshLatestUploads().
          // Metadata for each repo lives in catalog_hf_cache.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS catalog_latest_uploads (
                position    INTEGER PRIMARY KEY,
                repo        TEXT NOT NULL,
                fetched_at  TEXT NOT NULL
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });

          // 2026-05-21: Local Ollama models pros/cons cache. Populated lazily
          // by getLocalInstalled() controller when a model is neither curated
          // nor already cached. Key is the exact Ollama model name (e.g.
          // "mistral-nemo-cc:latest"), so customer-specific tags persist
          // even when normalize() would collapse them.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS catalog_local_pros_cons (
                model_name   TEXT PRIMARY KEY,
                pros         TEXT NOT NULL,
                cons         TEXT NOT NULL,
                family       TEXT NOT NULL,
                generated_at TEXT NOT NULL
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });

          // 2026-05-21: Pros/cons cache for non-Ollama models (Claude Haiku/
          // Sonnet/Opus today; could extend to other cloud providers later).
          // Populated lazily from the recommendation endpoint when a model
          // is recommended and has no cached pros/cons yet.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS model_pros_cons (
                model_name   TEXT PRIMARY KEY,
                pros         TEXT NOT NULL,
                cons         TEXT NOT NULL,
                generated_at TEXT NOT NULL
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });

          resolve();
        } catch (migrationErr) {
          reject(migrationErr as Error);
        }
      });
    });
  });
}

/**
 * Non-destructive migration: adds any missing columns to a specified table.
 * Uses PRAGMA to detect which columns already exist and only runs ALTER TABLE
 * for missing ones. Safe to call multiple times; already-present columns are skipped silently.
 * @param tableName - Name of the table to migrate
 * @param required - Array of required column definitions
 */
function addMissingColumns(
  tableName: string,
  required: ColumnDefinition[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.all(`PRAGMA table_info(${tableName})`, (err: Error | null, rows: TableInfo[] | undefined) => {
      if (err) return reject(err);

      const existing = new Set<string>((rows || []).map((r) => r.name as string));
      const missing = required.filter((c) => !existing.has(c.name));

      if (missing.length === 0) {
        return resolve();
      }

      let remaining = missing.length;
      let failed = false;
      for (const col of missing) {
        database.run(
          `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.ddl}`,
          (alterErr: Error | null) => {
            if (failed) return;
            if (alterErr) {
              // Ignore "duplicate column" races, surface anything else.
              if (!/duplicate column/i.test(alterErr.message)) {
                failed = true;
                return reject(alterErr);
              }
            }
            remaining -= 1;
            if (remaining === 0) resolve();
          }
        );
      }
    });
  });
}

/**
 * Execute a database query (INSERT, UPDATE, DELETE)
 * @param sql - SQL query string
 * @param params - Query parameters (default: empty array)
 * @returns Promise resolving to result with lastID and changes
 */
export function runQuery(sql: string, params: unknown[] = []): Promise<DatabaseQueryResult> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.run(sql, params, function (err: Error | null) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID as number, changes: this.changes as number });
    });
  });
}

/**
 * Execute a SELECT query returning a single row
 * @template T - The type of the row result
 * @param sql - SQL query string
 * @param params - Query parameters (default: empty array)
 * @returns Promise resolving to single row or undefined
 */
export function getQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.get(sql, params, (err: Error | null, row: T | undefined) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Execute a SELECT query returning all matching rows
 * @template T - The type of each row in the result
 * @param sql - SQL query string
 * @param params - Query parameters (default: empty array)
 * @returns Promise resolving to array of rows (empty array if no results)
 */
export function allQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.all(sql, params, (err: Error | null, rows: T[] | undefined) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Close the database connection
 * @returns Promise that resolves when connection is closed
 */
export function closeDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.close((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Insert or update a model analysis record
 * Uses upsert (INSERT ... ON CONFLICT) to atomically insert or update
 * @param model - Model identifier (e.g., 'claude-3-sonnet-20240229')
 * @param stats - Partial model analysis statistics
 * @returns Promise resolving to result with lastID and changes
 */
export function insertOrUpdateModelAnalysis(
  model: string,
  stats: Partial<ModelAnalysisInsert>
): Promise<DatabaseQueryResult> {
  const sql = `
    INSERT INTO model_analysis (model, total_requests, success_rate, error_count, avg_input_tokens, avg_output_tokens, cost_per_request, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(model) DO UPDATE SET
      total_requests = excluded.total_requests,
      success_rate = excluded.success_rate,
      error_count = excluded.error_count,
      avg_input_tokens = excluded.avg_input_tokens,
      avg_output_tokens = excluded.avg_output_tokens,
      cost_per_request = excluded.cost_per_request,
      last_updated = CURRENT_TIMESTAMP
  `;

  return runQuery(sql, [
    model,
    stats.total_requests || 0,
    stats.success_rate || 0,
    stats.error_count || 0,
    stats.avg_input_tokens || 0,
    stats.avg_output_tokens || 0,
    stats.cost_per_request || 0
  ]);
}

export { getDb as default };
