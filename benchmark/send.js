import fs from 'fs';
import { BACKEND_BASE } from './config.js';

export async function sendToBackend(allResults, machineName, mode, runId, token) {
  const url = `${BACKEND_BASE}/api/benchmarks`;

  for (const { model, categories } of allResults) {
    const results = categories.map((cat) => ({
      category: cat.category,
      score: cat.score ?? null,
      tasks_total: cat.tasks_total ?? null,
      tasks_passed: cat.tasks_passed ?? null,
      raw_results: JSON.stringify(cat.raw_results ?? []),
    }));

    const body = { run_id: runId, machine_name: machineName, model_name: model, mode, results };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`⚠ Backend rejected ${model}: HTTP ${res.status}`);
      } else {
        console.log(`✓ Sent ${model} to backend`);
      }
    } catch (e) {
      console.warn(`⚠ Backend unreachable for ${model}: ${e.message}`);
      console.warn(`  Retry manually: node benchmark/send.js benchmark/results/<your-file>.json`);
    }
  }
}

// Allow: node benchmark/send.js <json-file> [--token TOKEN]
if (process.argv[1].endsWith('send.js') && process.argv[2]) {
  const file = process.argv[2];
  const tokenIdx = process.argv.indexOf('--token');
  const token = tokenIdx !== -1 ? process.argv[tokenIdx + 1] : process.env.BENCHMARK_TOKEN;
  const report = JSON.parse(fs.readFileSync(file, 'utf-8'));
  sendToBackend(report.models, report.machine_name, report.mode, report.run_id, token)
    .then(() => console.log('Done.'));
}
