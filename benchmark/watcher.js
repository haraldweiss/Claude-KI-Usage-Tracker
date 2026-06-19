#!/usr/bin/env node
/**
 * Benchmark watcher — polls Ollama for version/model changes and auto-triggers
 * benchmarks. Each machine runs its own watcher against its local Ollama instance.
 *
 * Usage:
 *   node benchmark/watcher.js --machine "Mac mini M4 Pro" --session <token>
 *   node benchmark/watcher.js --machine "Mac Studio M2 Ultra" --token <api-token>
 *
 * Triggers:
 *   - Ollama version change  → re-benchmark ALL models
 *   - New model added        → benchmark ONLY the new model(s)
 *   - Model removed          → update state, nothing to run
 */
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import { OLLAMA_BASE, POLL_INTERVAL_MS } from './config.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, 'state.json');

// --- CLI args ---
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const machineName = getArg('--machine', `${os.hostname()} (${os.cpus()[0]?.model?.split('@')[0]?.trim() ?? 'unknown'})`);
const token = getArg('--token', process.env.BENCHMARK_TOKEN ?? '');
const session = getArg('--session', process.env.BENCHMARK_SESSION ?? '');
const mode = getArg('--mode', 'quick');

// --- State persistence ---
function readState() {
  if (!existsSync(STATE_FILE)) return { ollamaVersion: null, models: [] };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { ollamaVersion: null, models: [] }; }
}

function writeState(patch) {
  const prev = readState();
  writeFileSync(STATE_FILE, JSON.stringify(
    { ...prev, ...patch, lastCheck: new Date().toISOString() },
    null, 2
  ));
}

function modelListHash(models) {
  return createHash('sha1').update([...models].sort().join('\n')).digest('hex').slice(0, 8);
}

// --- Ollama introspection ---
async function fetchOllamaState() {
  const [tagsRes, versionRes] = await Promise.all([
    fetch(`${OLLAMA_BASE}/api/tags`),
    fetch(`${OLLAMA_BASE}/api/version`),
  ]);
  if (!tagsRes.ok || !versionRes.ok) throw new Error(`HTTP ${tagsRes.status}/${versionRes.status}`);
  const { models } = await tagsRes.json();
  const { version } = await versionRes.json();
  const modelNames = (models ?? [])
    .map((m) => m.name)
    .filter((n) => !n.includes('embed'))
    .filter((n) => !n.toLowerCase().includes('glm'))
    .sort();
  return { version, modelNames };
}

// --- Benchmark runner ---
let running = false;

async function runBenchmarkForModels(models, reason) {
  if (running) {
    log(`Skipping trigger (already running): ${reason}`);
    return;
  }
  running = true;
  log(`Triggered: ${reason}`);
  log(`Models: ${models.join(', ')}`);

  const baseArgs = [
    join(__dir, 'run.js'),
    '--mode', mode,
    '--machine', machineName,
    ...(token ? ['--token', token] : []),
    ...(session ? ['--session', session] : []),
  ];

  // Run each model sequentially — one in RAM at a time
  for (const model of models) {
    log(`Benchmarking: ${model}`);
    await new Promise((resolve) => {
      const proc = spawn(process.execPath, [...baseArgs, '--model', model], {
        stdio: 'inherit',
      });
      proc.on('close', (code) => {
        if (code !== 0) log(`Warning: run.js exited ${code} for ${model}`);
        resolve();
      });
    });
  }

  running = false;
  log('Benchmark complete.');
}

// --- Poll loop ---
function log(msg) {
  console.log(`[watcher ${new Date().toISOString()}] ${msg}`);
}

async function check() {
  let current;
  try {
    current = await fetchOllamaState();
  } catch (e) {
    log(`Ollama unreachable: ${e.message}`);
    return;
  }

  const state = readState();
  const versionChanged = state.ollamaVersion !== current.version;
  const newModels = current.modelNames.filter((m) => !(state.models ?? []).includes(m));
  const removedModels = (state.models ?? []).filter((m) => !current.modelNames.includes(m));

  // Always persist current state
  writeState({ ollamaVersion: current.version, models: current.modelNames });

  if (removedModels.length > 0) {
    log(`Models removed (no action): ${removedModels.join(', ')}`);
  }

  if (versionChanged) {
    log(`Ollama version: ${state.ollamaVersion ?? 'unknown'} → ${current.version} — re-benchmarking all models`);
    await runBenchmarkForModels(current.modelNames, `Ollama updated to ${current.version}`);
  } else if (newModels.length > 0) {
    log(`New model(s): ${newModels.join(', ')}`);
    await runBenchmarkForModels(newModels, `New model(s) added`);
  } else {
    log(`No changes (v${current.version}, ${current.modelNames.length} models, hash ${modelListHash(current.modelNames)})`);
  }
}

log(`Starting — polling every ${POLL_INTERVAL_MS / 60_000} min`);
log(`Machine: ${machineName} | mode: ${mode}`);
log(`State file: ${STATE_FILE}`);

check();
setInterval(check, POLL_INTERVAL_MS);
