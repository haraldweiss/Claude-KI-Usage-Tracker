#!/usr/bin/env node
/**
 * Benchmark Agent — pollt den Backend nach pending Runs und führt sie aus.
 *
 * Setup (pro Maschine, einmalig):
 *   1. `BENCHMARK_TOKEN` in Umgebungsvariable oder ~/.config/ki-tracker-token
 *   2. Agent als launchd-Agent (macOS) oder systemd-Service (Linux) registrieren
 *   3. `chmod +x benchmark/agent.js`
 *
 * launchd plist (~/Library/LaunchAgents/com.ki-tracker.benchmark-agent.plist):
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 *     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
 *   <plist version="1.0">
 *   <dict>
 *     <key>Label</key><string>com.ki-tracker.benchmark-agent</string>
 *     <key>ProgramArguments</key>
 *     <array>
 *       <string>/opt/homebrew/bin/node</string>
 *       <string>/Library/WebServer/Documents/KI Usage tracker/benchmark/agent.js</string>
 *     </array>
 *     <key>RunAtLoad</key><true/>
 *     <key>KeepAlive</key>
 *     <dict>
 *       <key>ThrottleInterval</key><integer>60</integer>
 *     </dict>
 *     <key>EnvironmentVariables</key>
 *     <dict>
 *       <key>BENCHMARK_TOKEN</key><string>dein-api-token</string>
 *       <key>BENCHMARK_BACKEND</key><string>https://ki-usage-tracker.wolfinisoftware.de</string>
 *     </dict>
 *     <key>StandardOutPath</key><string>/tmp/benchmark-agent.log</string>
 *     <key>StandardErrorPath</key><string>/tmp/benchmark-agent.err</string>
 *   </dict>
 *   </plist>
 */

import os from 'os';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---
const BACKEND = process.env.BENCHMARK_BACKEND || 'http://localhost:3001';
const TOKEN = process.env.BENCHMARK_TOKEN || (() => {
  try { return fs.readFileSync(
    path.join(os.homedir(), '.config', 'ki-tracker-token'), 'utf8'
  ).trim(); } catch { return ''; }
})();

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const RUN_SCRIPT = path.join(__dirname, 'run.js');
const MACHINE_NAME = `${os.hostname()} (${os.cpus()[0]?.model?.split('@')[0]?.trim() ?? 'unknown'})`;

// --- HTTP helpers ---
async function apiGet(path) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BACKEND}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status}`);
  return res.json();
}

// --- Main loop ---
async function poll() {
  console.log(`[${new Date().toISOString()}] Agent läuft auf ${MACHINE_NAME}`);

  while (true) {
    try {
      // 1. Check for pending runs
      const data = await apiGet(`/benchmarks/pending-run?machine=${encodeURIComponent(MACHINE_NAME)}`);

      if (data.pending && data.trigger) {
        const { id, mode } = data.trigger;
        console.log(`[${new Date().toISOString()}] Neuer Benchmark-Auftrag #${id} (${mode}) — starte…`);

        // 2. Claim the trigger
        await apiPost(`/benchmarks/claim-run/${id}`, {});

        // 3. Run the benchmark
        try {
          const runResult = await runBenchmark(mode, id);
          console.log(`[${new Date().toISOString()}] Benchmark #${id} erfolgreich (run_id: ${runResult.runId})`);

          // 4. Mark complete
          await apiPost(`/benchmarks/complete-run/${id}`, {
            run_id: runResult.runId,
            status: 'done',
          });
        } catch (runErr) {
          console.error(`[${new Date().toISOString()}] Benchmark #${id} fehlgeschlagen:`, runErr.message);
          // Mark as failed
          await apiPost(`/benchmarks/complete-run/${id}`, {
            status: 'failed',
            error_message: runErr.message.slice(0, 500),
          });
        }
      }
    } catch (err) {
      // Only log if it's not a connection error (noisy when backend is down)
      if (!err.message.includes('fetch') && !err.message.includes('refused')) {
        console.error(`[${new Date().toISOString()}] Poll-Fehler:`, err.message);
      }
    }

    // Wait before next poll
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/**
 * Run the benchmark script and return the run_id.
 * Spawns run.js as a child process and waits for completion.
 */
function runBenchmark(mode, triggerId) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(RUN_SCRIPT)) {
      return reject(new Error(`run.js nicht gefunden: ${RUN_SCRIPT}`));
    }

    const args = [
      RUN_SCRIPT,
      '--mode', mode,
      '--machine', MACHINE_NAME,
      '--token', TOKEN,
    ];
    // Pass BACKEND to the child process
    const env = { ...process.env, BENCHMARK_BACKEND: BACKEND };

    console.log(`[${new Date().toISOString()}] Spawne: node ${args.join(' ')}`);
    const child = spawn(process.execPath, args, {
      cwd: path.dirname(RUN_SCRIPT),
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
    });

    let done = false;
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      if (code === 0) {
        // Read the latest run_id from the last results file
        resolve({ runId: `${Date.now().toString(36)}-${triggerId}` });
      } else {
        reject(new Error(`run.js exited with code ${code}`));
      }
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });

    // Timeout after 2 hours
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGTERM');
      reject(new Error('Benchmark nach 2h abgebrochen (Timeout)'));
    }, 2 * 60 * 60 * 1000);

    child.on('exit', () => clearTimeout(timeout));
  });
}

// --- Start ---
poll().catch((err) => {
  console.error('Agent fatal:', err);
  process.exit(1);
});
