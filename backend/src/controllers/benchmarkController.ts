// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import getDb from '../database/sqlite.js';
import { runQuery, allQuery } from '../database/sqlite.js';
import logger from '../utils/logger.js';

interface BenchmarkResultRow {
  category: string;
  score: number | null;
  tasks_total: number | null;
  tasks_passed: number | null;
  raw_results: string;
}

interface PostBenchmarkBody {
  run_id: string;
  machine_name: string;
  model_name: string;
  mode: string;
  results: BenchmarkResultRow[];
}

// ---------------------------------------------------------------------------
// POST /api/benchmarks  — submit benchmark results (from run.js / agent)
// ---------------------------------------------------------------------------
export async function postBenchmarkRun(req: Request, res: Response): Promise<void> {
  try {
    const { run_id, machine_name, model_name, mode, results }: PostBenchmarkBody = req.body;

    if (!run_id || !machine_name || !model_name || !mode || !Array.isArray(results)) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (results.length === 0 || results.length > 1000) {
      res.status(400).json({ error: 'results must contain between 1 and 1000 entries' });
      return;
    }

    const db = getDb();
    const stmt = `
      INSERT INTO benchmark_runs
        (run_id, machine_name, model_name, mode, category, score, tasks_total, tasks_passed, raw_results)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await new Promise<void>((resolve, reject) => {
      db.run('BEGIN', (err: Error | null) => (err ? reject(err) : resolve()));
    });

    try {
      for (const row of results) {
        await runQuery(stmt, [
          run_id, machine_name, model_name, mode,
          row.category, row.score ?? null,
          row.tasks_total ?? null, row.tasks_passed ?? null,
          typeof row.raw_results === 'string' ? row.raw_results : JSON.stringify(row.raw_results),
        ]);
      }
      await new Promise<void>((resolve, reject) => {
        db.run('COMMIT', (err: Error | null) => (err ? reject(err) : resolve()));
      });
    } catch (insertErr) {
      await new Promise<void>((resolve) => {
        db.run('ROLLBACK', () => resolve());
      });
      throw insertErr;
    }

    // If this run_id matches a pending trigger, mark it complete
    await runQuery(
      `UPDATE benchmark_triggers SET status = 'done', run_id = ?, completed_at = datetime('now')
       WHERE run_id = ? AND status IN ('pending', 'running')`,
      [run_id, run_id]
    );

    res.status(201).json({ run_id });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/benchmarks  — list benchmark results
// ---------------------------------------------------------------------------
export async function getBenchmarkRuns(req: Request, res: Response): Promise<void> {
  try {
    const model = String(req.query.model ?? '');
    const machine = String(req.query.machine ?? '');
    const mode = String(req.query.mode ?? '');
    const limitRaw = req.query.limit;
    const parsedLimit = Math.min(Math.max(parseInt(String(limitRaw ?? '50'), 10) || 50, 1), 500);

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (model) { conditions.push('model_name = ?'); params.push(model); }
    if (machine) { conditions.push('machine_name = ?'); params.push(machine); }
    if (mode) { conditions.push('mode = ?'); params.push(mode); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM benchmark_runs
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    params.push(parsedLimit);

    const rows = await allQuery<unknown>(sql, params);

    res.json({ runs: rows });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/benchmarks/request-run  — request a new benchmark run (from dashboard)
// ---------------------------------------------------------------------------
export async function requestBenchmarkRun(req: Request, res: Response): Promise<void> {
  try {
    const { machine_name, mode } = req.body;
    const userId = req.user?.id;

    if (!machine_name) {
      res.status(400).json({ error: 'machine_name is required' });
      return;
    }

    const runMode = mode === 'standard' ? 'standard' : 'quick';
    const result = await runQuery(
      `INSERT INTO benchmark_triggers (machine_name, mode, requested_by, status)
       VALUES (?, ?, ?, 'pending')`,
      [machine_name, runMode, userId ?? null]
    );

    logger.info({ triggerId: result.lastID, machine_name, mode: runMode }, 'benchmark trigger created');

    res.status(201).json({
      success: true,
      message: `Benchmark auf ${machine_name} angefordert (${runMode})`,
      trigger_id: result.lastID,
    });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/benchmarks/pending-run  — poll for pending runs (agent)
// Query: ?machine=hostname
// ---------------------------------------------------------------------------
export async function getPendingRun(req: Request, res: Response): Promise<void> {
  try {
    const machine = String(req.query.machine ?? '').trim();
    if (!machine) {
      res.status(400).json({ error: 'machine query param is required' });
      return;
    }

    const rows = await allQuery<{
      id: number; machine_name: string; mode: string; status: string; created_at: string;
    }>(
      `SELECT id, machine_name, mode, status, created_at
       FROM benchmark_triggers
       WHERE machine_name = ? AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`,
      [machine]
    );

    if (rows.length === 0) {
      res.json({ pending: false });
      return;
    }

    res.json({ pending: true, trigger: rows[0] });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/benchmarks/claim-run/:id  — agent claims a trigger (marks as running)
// ---------------------------------------------------------------------------
export async function claimBenchmarkRun(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const result = await runQuery(
      `UPDATE benchmark_triggers SET status = 'running', started_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
      [id]
    );

    if (result.changes === 0) {
      res.status(409).json({ error: 'trigger already claimed or not found' });
      return;
    }

    res.json({ success: true, message: 'Trigger claimed' });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/benchmarks/complete-run/:id  — agent reports completion
// Body: { run_id, status: 'done'|'failed', error_message? }
// ---------------------------------------------------------------------------
export async function completeBenchmarkRun(req: Request, res: Response): Promise<void> {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const { run_id, status, error_message } = req.body;
    const finalStatus = status === 'failed' ? 'failed' : 'done';

    await runQuery(
      `UPDATE benchmark_triggers
       SET status = ?, run_id = ?, error_message = ?, completed_at = datetime('now')
       WHERE id = ?`,
      [finalStatus, run_id ?? null, error_message ?? null, id]
    );

    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/benchmarks/machines  — list distinct machines from runs + triggers
// ---------------------------------------------------------------------------
export async function listMachines(_req: Request, res: Response): Promise<void> {
  try {
    const runMachines = await allQuery<{ machine_name: string }>(
      `SELECT DISTINCT machine_name FROM benchmark_runs ORDER BY machine_name`
    );
    const triggerMachines = await allQuery<{ machine_name: string }>(
      `SELECT DISTINCT machine_name FROM benchmark_triggers ORDER BY machine_name`
    );

    const seen = new Set<string>();
    const allMachines: string[] = [];
    for (const row of [...runMachines, ...triggerMachines]) {
      if (!seen.has(row.machine_name)) {
        seen.add(row.machine_name);
        allMachines.push(row.machine_name);
      }
    }

    res.json({ machines: allMachines.sort() });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/benchmarks/triggers  — list recent trigger requests
// ---------------------------------------------------------------------------
export async function getTriggers(req: Request, res: Response): Promise<void> {
  try {
    const limitRaw = req.query.limit;
    const parsedLimit = Math.min(Math.max(parseInt(String(limitRaw ?? '20'), 10) || 20, 1), 100);

    const rows = await allQuery<{
      id: number; machine_name: string; mode: string; status: string;
      run_id: string | null; created_at: string; started_at: string | null;
      completed_at: string | null; error_message: string | null;
    }>(
      `SELECT * FROM benchmark_triggers ORDER BY created_at DESC LIMIT ?`,
      [parsedLimit]
    );

    res.json({ triggers: rows });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}
