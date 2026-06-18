import { OLLAMA_BASE, TASK_TIMEOUT_MS } from '../config.js';

const SHORT_PROMPT = 'Say "hello" and nothing else.';
const MEDIUM_PROMPT = 'List exactly 10 common English words, one per line, nothing else.';
const LONG_PROMPT = `List 25 different countries, one per line, with their capital city separated by a colon.
Format: CountryName: CapitalCity
Output nothing else, no numbers, no explanations.`;

async function measureOnce(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const tokensPerSec = data.eval_duration > 0
      ? data.eval_count / (data.eval_duration / 1e9)
      : 0;
    return { tokensPerSec, evalCount: data.eval_count };
  } catch (e) {
    clearTimeout(timer);
    return { tokensPerSec: 0, evalCount: 0, error: e.message };
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function runSpeedTasks(model, _mode) {
  const prompts = [
    { id: 'speed-short', label: 'short', prompt: SHORT_PROMPT },
    { id: 'speed-medium', label: 'medium', prompt: MEDIUM_PROMPT },
    { id: 'speed-long', label: 'long', prompt: LONG_PROMPT },
  ];

  const taskResults = [];
  for (const { id, label, prompt } of prompts) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const result = await measureOnce(model, prompt);
      runs.push(result.tokensPerSec);
    }
    const med = median(runs);
    taskResults.push({ id, label, tokensPerSec: med, passed: med > 0 });
  }

  const avg = taskResults.reduce((s, r) => s + r.tokensPerSec, 0) / taskResults.length;

  return {
    category: 'speed',
    score: Math.round(avg * 10) / 10,
    tasks_total: taskResults.length,
    tasks_passed: taskResults.filter((r) => r.passed).length,
    raw_results: taskResults,
    meta: { unit: 'tokens/sec', breakdown: taskResults },
  };
}
