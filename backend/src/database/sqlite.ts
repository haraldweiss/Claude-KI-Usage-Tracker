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
            // The five columns below were added for the per-message Haiku
            // categorization design. That design was abandoned (claude.ai's
            // web UI no longer exposes per-message data); columns remain so
            // we don't run a destructive migration on existing records.
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
            { name: 'cost_usd', ddl: 'REAL' }
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
          await addMissingColumns('pricing', [
            { name: 'api_id', ddl: 'TEXT' },
            { name: 'status', ddl: "TEXT DEFAULT 'active'" },
            { name: 'tier', ddl: 'TEXT' }
          ]);
          await new Promise<void>((res, rej) => {
            database.run(
              "UPDATE pricing SET source = 'auto' WHERE source = 'anthropic'",
              (uErr: Error | null) => (uErr ? rej(uErr) : res())
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
