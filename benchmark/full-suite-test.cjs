const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");

const OLLAMA_BASE = "http://localhost:11434";
const BACKEND_BASE = "http://localhost:3001";
const AUTH = "Bearer ck_live_f2969d64fb2be544cf909eb9cbffb24dd07bc45940ece0475cba7c625c316f0c";
const PROMPT = "Explain why renewable energy is important for economic development in 2-3 sentences.";

const MODELS = [
  "hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M",
  "mistral-nemo-cc:latest",
  "qwen3-coder-cc:latest",
  "anubclaw/dev-coder:q5",
  "qwen3-coder:latest",
  "soc-analyst:latest",
  "soc-detect:latest",
  "dev-coder:latest",
  "mistral-nemo:12b-instruct-2407-q5_K_M",
  "llama3.1:8b-instruct-q5_K_M",
  "qwen3.6:latest",
  "glm-4.7-flash:latest",
];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testOneModel(model, runId) {
  const start = Date.now();
  process.stdout.write("  " + model.padEnd(60) + " ");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const response = await fetch(OLLAMA_BASE + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: PROMPT, stream: false }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      process.stdout.write("FAIL HTTP " + response.status + "\n");
      return { model, success: false, error: "HTTP " + response.status, duration: Date.now() - start, run_id: runId };
    }
    const data = await response.json();
    const text = data.response || "";
    if (text.trim().length < 20) {
      process.stdout.write("FAIL empty\n");
      return { model, success: false, error: "empty response", duration: Date.now() - start, run_id: runId };
    }
    const tokens = text.split(" ").length;
    const dur = Date.now() - start;
    const tps = (tokens / (dur / 1000)).toFixed(1);
    process.stdout.write("OK " + tokens + "t " + (dur/1000).toFixed(1) + "s " + tps + "t/s\n");
    return { model, success: true, tokens, duration: dur, response_length: text.length, run_id: runId, tokens_per_sec: parseFloat(tps) };
  } catch (e) {
    const msg = e.name === "AbortError" ? "TIMEOUT 120s" : e.message;
    process.stdout.write("FAIL " + msg + "\n");
    return { model, success: false, error: msg, duration: Date.now() - start, run_id: runId };
  }
}

async function sendToBackend(results, machineName) {
  for (const r of results) {
    const payload = {
      run_id: r.run_id,
      machine_name: machineName,
      model_name: r.model,
      mode: "full_suite",
      results: [{
        category: "text_generation",
        score: r.success ? 100 : 0,
        tasks_total: 1,
        tasks_passed: r.success ? 1 : 0,
        raw_results: JSON.stringify([r])
      }]
    };
    try {
      const res = await fetch(BACKEND_BASE + "/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": AUTH },
        body: JSON.stringify(payload)
      });
      process.stdout.write(res.ok ? "." : "E" + res.status);
    } catch(e) { process.stdout.write("X"); }
  }
  console.log(" done");
}

async function main() {
  const runId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,6);
  const cpu = os.cpus()[0]?.model?.split("@")[0]?.trim() || "unknown";
  const machineName = os.hostname() + " (" + cpu + ")";

  console.log("\nOllama Full Model Suite Test");
  console.log("   Machine: " + machineName);
  console.log("   Run ID:  " + runId);
  console.log("   Models:  " + MODELS.length + " text models\n");
  console.log("---".repeat(26));

  const results = [];
  for (const model of MODELS) {
    const r = await testOneModel(model, runId);
    results.push(r);
    await wait(1000);
  }

  const ok = results.filter(r => r.success);
  const fail = results.filter(r => !r.success);

  console.log("\n" + "===".repeat(26));
  console.log("SUMMARY");
  console.log("===".repeat(26));
  console.log("   Tested:  " + results.length + " models");
  console.log("   PASS:    " + ok.length);
  console.log("   FAIL:    " + fail.length);
  if (ok.length) {
    const avgDur = ok.reduce((s, r) => s + r.duration, 0) / ok.length;
    const avgTok = ok.reduce((s, r) => s + (r.tokens || 0), 0) / ok.length;
    console.log("   Avg time: " + (avgDur / 1000).toFixed(1) + "s");
    console.log("   Avg tok:  " + avgTok.toFixed(0));
  }
  if (ok.length) {
    console.log("\nPASSED (by speed):");
    ok.sort((a, b) => a.duration - b.duration).forEach(r => {
      console.log("   " + r.model.padEnd(58) + " " + (r.duration/1000).toFixed(1) + "s  " + r.tokens + "tok  " + r.tokens_per_sec + "t/s");
    });
  }
  if (fail.length) {
    console.log("\nFAILED:");
    fail.forEach(r => console.log("   " + r.model.padEnd(58) + " " + r.error));
  }

  const report = { run_id: runId, machine_name: machineName, mode: "full_suite", results, timestamp: new Date().toISOString() };
  const dir = "benchmark/results";
  fs.mkdirSync(dir, { recursive: true });
  const file = dir + "/full-suite-" + runId + ".json";
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log("\nSaved: " + file);
  console.log("\nBackend upload...");
  await sendToBackend(results, machineName);
  console.log("\nDone!");
}

main().catch(console.error);
