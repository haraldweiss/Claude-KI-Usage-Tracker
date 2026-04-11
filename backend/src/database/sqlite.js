import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../database.sqlite');

const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
export function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Usage records table
      db.run(`
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
      `, (err) => {
        if (err) {
          // Table might already exist from an older schema version; attempt a
          // non-destructive migration to add any missing columns.
          if (err.message.includes('already exists')) {
            addMissingColumns().catch((migrationErr) => {
              console.error('Failed to migrate usage_records table:', migrationErr);
            });
          } else {
            reject(err);
          }
        }
      });

      // Pricing table
      db.run(`
        CREATE TABLE IF NOT EXISTS pricing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL UNIQUE,
          input_price REAL NOT NULL,
          output_price REAL NOT NULL,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT DEFAULT 'anthropic'
        )
      `, (err) => {
        if (err) reject(err);
      });

      // Model analysis table (cached statistics)
      db.run(`
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
      `, (err) => {
        if (err) reject(err);
      });

      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_records(timestamp)');
      db.run('CREATE INDEX IF NOT EXISTS idx_model ON usage_records(model)');
      db.run('CREATE INDEX IF NOT EXISTS idx_source ON usage_records(source)');
      db.run('CREATE INDEX IF NOT EXISTS idx_usage_success_status ON usage_records(success_status)');
      db.run('CREATE INDEX IF NOT EXISTS idx_usage_task_desc ON usage_records(task_description)');
      db.run('CREATE INDEX IF NOT EXISTS idx_pricing_model ON pricing(model)', (err) => {
        if (err) reject(err);
        else resolve();
      });

    });
  });
}

/**
 * Non-destructive migration: adds any columns that were introduced after the
 * original schema to an existing `usage_records` table. Uses PRAGMA to detect
 * which columns already exist and only runs ALTER TABLE for missing ones.
 * Safe to call multiple times; already-present columns are skipped silently.
 */
function addMissingColumns() {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(usage_records)', (err, rows) => {
      if (err) return reject(err);

      const existing = new Set((rows || []).map((r) => r.name));
      const required = [
        { name: 'task_description', ddl: 'TEXT' },
        { name: 'success_status', ddl: 'TEXT DEFAULT \'unknown\'' },
        { name: 'response_metadata', ddl: 'TEXT' }
      ];
      const missing = required.filter((c) => !existing.has(c.name));

      if (missing.length === 0) {
        return resolve();
      }

      let remaining = missing.length;
      let failed = false;
      for (const col of missing) {
        db.run(
          `ALTER TABLE usage_records ADD COLUMN ${col.name} ${col.ddl}`,
          (alterErr) => {
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

// Helper functions for database operations
export function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function insertOrUpdateModelAnalysis(model, stats) {
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

export default db;
