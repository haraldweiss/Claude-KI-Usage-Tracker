// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import getDb from '../database/sqlite.js';

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
  const { run_id, machine_name, model_name, mode, results }: PostBenchmarkBody = req.body;

  if (!run_id || !machine_name || !model_name || !mode || !Array.isArray(results)) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const db = getDb();
  const stmt = `
    INSERT INTO benchmark_runs
      (run_id, machine_name, model_name, mode, category, score, tasks_total, tasks_passed, raw_results)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  for (const row of results) {
    await new Promise<void>((resolve, reject) => {
      db.run(
        stmt,
        [run_id, machine_name, model_name, mode, row.category, row.score ?? null,
         row.tasks_total ?? null, row.tasks_passed ?? null,
         typeof row.raw_results === 'string' ? row.raw_results : JSON.stringify(row.raw_results)],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  res.status(201).json({ run_id });
}

export async function getBenchmarkRuns(req: Request, res: Response): Promise<void> {
  const { model, machine, mode, limit = '50' } = req.query as Record<string, string>;

  const db = getDb();
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
  params.push(parseInt(limit, 10));

  const rows = await new Promise<unknown[]>((resolve, reject) => {
    db.all(sql, params, (err: Error | null, r: unknown[]) => (err ? reject(err) : resolve(r)));
  });

  res.json({ runs: rows });
}
