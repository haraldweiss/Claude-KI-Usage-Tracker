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

    res.status(201).json({ run_id });
  } catch (error) {
    logger.error({ err: error }, 'benchmarkController error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

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
