import { OLLAMA_BASE, TASK_TIMEOUT_MS } from './config.js';

async function callModel(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keep_alive: -1 keeps the model in RAM for the duration of the benchmark run
      body: JSON.stringify({ model, prompt, stream: false, keep_alive: -1 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { text: '', error: `HTTP ${res.status}` };
    const data = await res.json();
    return { text: data.response ?? '', raw: data };
  } catch (e) {
    clearTimeout(timer);
    return { text: '', error: e.message };
  }
}

export async function preheatModel(model) {
  process.stdout.write(`  preheat... `);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'Hi', stream: false, keep_alive: -1 }),
      signal: controller.signal,
    });
    console.log('ready');
  } catch {
    console.log('timeout (model may be slow to load)');
  } finally {
    clearTimeout(timer);
  }
}

export async function unloadModel(model) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }),
    });
  } catch {
    // best-effort unload
  }
}

export async function scoreCoding(model, tasks) {
  const results = [];
  for (const task of tasks) {
    const { text, error } = await callModel(model, task.prompt);
    const passed = !error && task.check(text);
    results.push({ id: task.id, passed, response: text, error: error ?? null });
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    category: 'coding',
    score: Math.round((passed / tasks.length) * 100),
    tasks_total: tasks.length,
    tasks_passed: passed,
    raw_results: results,
  };
}

export async function scoreGeneral(model, tasks) {
  const results = [];
  for (const task of tasks) {
    const prompt = `${task.question}\n\nOptions:\nA) ${task.options.A}\nB) ${task.options.B}\nC) ${task.options.C}\nD) ${task.options.D}\n\nAnswer with ONLY the letter A, B, C, or D.`;
    const { text, error } = await callModel(model, prompt);
    const letter = (text.trim().match(/^[ABCD]/i) || [])[0]?.toUpperCase() ?? '';
    const passed = !error && letter === task.answer;
    results.push({ id: task.id, passed, answer: letter, expected: task.answer, error: error ?? null });
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    category: 'general',
    score: Math.round((passed / tasks.length) * 100),
    tasks_total: tasks.length,
    tasks_passed: passed,
    raw_results: results,
  };
}

export async function scoreProject(model, tasks) {
  const results = [];
  for (const task of tasks) {
    const { text, error } = await callModel(model, task.prompt);
    const allKeywords = !error && task.keywords.every((kw) =>
      text.toUpperCase().includes(kw.toUpperCase())
    );
    results.push({ id: task.id, passed: allKeywords, response: text, keywords: task.keywords, error: error ?? null });
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    category: 'project',
    score: Math.round((passed / tasks.length) * 100),
    tasks_total: tasks.length,
    tasks_passed: passed,
    raw_results: results,
  };
}
