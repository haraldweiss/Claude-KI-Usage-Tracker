#!/usr/bin/env node
import { codingTasks } from './tasks/coding.js';
import { generalTasks } from './tasks/general.js';
import { projectTasks } from './tasks/project.js';
import { runSpeedTasks } from './tasks/speed.js';
import { scoreCoding, scoreGeneral, scoreProject, preheatModel, unloadModel } from './scorer.js';
import { printTerminalReport } from './reporters/terminal.js';
import { writeJsonReport } from './reporters/json.js';
import { writeMarkdownReport } from './reporters/markdown.js';
import { writeHtmlReport } from './reporters/html.js';
import { sendToBackend } from './send.js';
import { OLLAMA_BASE, QUICK_COUNT, STANDARD_COUNT } from './config.js';
import { randomUUID } from 'crypto';
import os from 'os';

// --- Parse CLI args ---
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const hasFlag = (flag) => args.includes(flag);

const mode = getArg('--mode', 'standard');
const machineName = getArg('--machine', `${os.hostname()} (${os.cpus()[0]?.model?.split('@')[0]?.trim() ?? 'unknown'})`);
const token = getArg('--token', process.env.BENCHMARK_TOKEN ?? '');
const session = getArg('--session', process.env.BENCHMARK_SESSION ?? '');
const skipSend = hasFlag('--no-send');
const onlyModel = getArg('--model', '');
const count = mode === 'quick' ? QUICK_COUNT : STANDARD_COUNT;
const runId = randomUUID();

// --- Discover models ---
async function discoverModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama not reachable: HTTP ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map((m) => m.name).filter(
    // Skip embedding models — they don't generate text
    (name) => !name.includes('embed')
  ).filter(
    // Skip GLM locally — ~6 min per prompt on this Mac, unpractical for benchmarking
    (name) => !name.toLowerCase().includes('glm')
  );
}

// --- Main ---
async function main() {
  console.log(`\nOllama Benchmark — ${machineName} — ${mode} mode (${count} tasks/category)\n`);

  let models;
  try {
    models = await discoverModels();
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  if (onlyModel) models = models.filter((m) => m === onlyModel || m.startsWith(onlyModel));
  if (models.length === 0) {
    console.error('No models found. Run: ollama pull <model>');
    process.exit(1);
  }

  console.log(`Found ${models.length} model(s): ${models.join(', ')}\n`);

  const coding = codingTasks.slice(0, count);
  const general = generalTasks.slice(0, count);
  const project = projectTasks.slice(0, count);

  const allResults = [];

  for (const model of models) {
    console.log(`\n── ${model} ──`);
    const categories = [];

    try {
      await preheatModel(model);

      process.stdout.write('  coding...  ');
      const c = await scoreCoding(model, coding);
      categories.push(c);
      console.log(`${c.tasks_passed}/${c.tasks_total} (${c.score}%)`);

      process.stdout.write('  general... ');
      const g = await scoreGeneral(model, general);
      categories.push(g);
      console.log(`${g.tasks_passed}/${g.tasks_total} (${g.score}%)`);

      process.stdout.write('  project... ');
      const p = await scoreProject(model, project);
      categories.push(p);
      console.log(`${p.tasks_passed}/${p.tasks_total} (${p.score}%)`);

      process.stdout.write('  speed...   ');
      const s = await runSpeedTasks(model, mode);
      categories.push(s);
      console.log(`${s.score} t/s avg`);
    } catch (e) {
      console.warn(`  ✗ Skipping ${model}: ${e.message}`);
    } finally {
      process.stdout.write('  unloading... ');
      await unloadModel(model);
      console.log('done');
    }

    allResults.push({ model, categories });
  }

  // --- Report ---
  printTerminalReport(allResults, machineName, mode);
  writeJsonReport(allResults, machineName, mode, runId);
  writeMarkdownReport(allResults, machineName, mode, runId);
  writeHtmlReport(allResults, machineName, mode, runId);

  if (!skipSend) {
    console.log('\nSending to backend...');
    await sendToBackend(allResults, machineName, mode, runId, token, session);
  }

  console.log('\nDone.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
