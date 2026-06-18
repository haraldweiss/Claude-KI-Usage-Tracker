import fs from 'fs';
import path from 'path';

export function writeJsonReport(allResults, machineName, mode, runId) {
  const dir = path.join(process.cwd(), 'benchmark', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = machineName.toLowerCase().replace(/\s+/g, '-');
  const filename = `${ts}-${slug}.json`;
  const filepath = path.join(dir, filename);
  const report = { run_id: runId, machine_name: machineName, mode, timestamp: new Date().toISOString(), models: allResults };
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`JSON  → benchmark/results/${filename}`);
  return filepath;
}
