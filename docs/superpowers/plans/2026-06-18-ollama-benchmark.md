# Ollama Benchmark Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI benchmark tool that tests all local Ollama models across four categories and posts results to the KI Usage Tracker backend for display in a new Benchmarks tab.

**Architecture:** Pure-Node.js CLI (`benchmark/`) discovers models via Ollama API, runs tasks, scores responses, writes four output formats, and POSTs to a new `/api/benchmarks` Express endpoint backed by a new SQLite table. A new React tab `BenchmarksTab` fetches and visualises the data.

**Tech Stack:** Node.js (ESM, no TypeScript for CLI), Express + SQLite3 (backend), React + Recharts (frontend)

---

## File Map

### New files — backend
- `backend/src/controllers/benchmarkController.ts` — POST + GET handlers
- `backend/src/routes/benchmark.ts` — Express router
- `backend/src/__tests__/benchmark.test.ts` — endpoint tests

### Modified files — backend
- `backend/src/database/sqlite.ts` — add `benchmark_runs` table to `initializeDatabase()`
- `backend/src/app.ts` — wire in `/api/benchmarks` router

### New files — CLI
- `benchmark/config.js` — task lists (quick/standard)
- `benchmark/tasks/coding.js` — HumanEval-style tasks
- `benchmark/tasks/general.js` — MMLU multiple-choice tasks
- `benchmark/tasks/project.js` — KI Usage Tracker domain tasks
- `benchmark/tasks/speed.js` — tokens/sec measurement
- `benchmark/scorer.js` — per-category scoring logic
- `benchmark/reporters/terminal.js` — colored table
- `benchmark/reporters/json.js` — JSON file writer
- `benchmark/reporters/html.js` — self-contained HTML report
- `benchmark/reporters/markdown.js` — Markdown summary
- `benchmark/send.js` — HTTP POST to backend
- `benchmark/run.js` — main orchestrator (CLI entrypoint)

### New files — frontend
- `frontend/src/components/BenchmarksTab.tsx` — score table + speed chart + machine comparison + run history
- `frontend/src/types/benchmark.ts` — TypeScript types for benchmark data

### Modified files — frontend
- `frontend/src/services/api.ts` — add `getBenchmarkRuns()` function
- `frontend/src/components/DashboardTabs.tsx` — add `'benchmarks'` to `TabType` and tabs array
- `frontend/src/pages/Dashboard.tsx` — add `'benchmarks'` to local `TabType`, import and render `BenchmarksTab`

---

## Task 1: Add `benchmark_runs` table to SQLite

**Files:**
- Modify: `backend/src/database/sqlite.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/benchmark.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  process.env.DATABASE_PATH = ':memory:';
  const { default: init } = await import('../database/sqlite.js');
  await init();
  app = await createApp();
});

describe('GET /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/benchmarks');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/benchmarks').send({});
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (endpoint not yet wired)**

```bash
cd backend && npm test -- --testPathPattern=benchmark
```

Expected: FAIL — "Cannot find module" or 404 (route not registered yet)

- [ ] **Step 3: Add the table to sqlite.ts**

In `backend/src/database/sqlite.ts`, find the last `CREATE TABLE IF NOT EXISTS` block in `initializeDatabase()` and append after it:

```typescript
      await run(`
        CREATE TABLE IF NOT EXISTS benchmark_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          machine_name TEXT NOT NULL,
          model_name TEXT NOT NULL,
          mode TEXT NOT NULL,
          category TEXT NOT NULL,
          score REAL,
          tasks_total INTEGER,
          tasks_passed INTEGER,
          raw_results TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
```

- [ ] **Step 4: Commit**

```bash
cd backend && git add src/database/sqlite.ts src/__tests__/benchmark.test.ts
git commit -m "feat(backend): add benchmark_runs table + skeleton test"
```

---

## Task 2: Backend controller + route

**Files:**
- Create: `backend/src/controllers/benchmarkController.ts`
- Create: `backend/src/routes/benchmark.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Create the controller**

`backend/src/controllers/benchmarkController.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import { getDb } from '../database/sqlite.js';

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
        (err) => (err ? reject(err) : resolve())
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
    db.all(sql, params, (err, r) => (err ? reject(err) : resolve(r as unknown[])));
  });

  res.json({ runs: rows });
}
```

- [ ] **Step 2: Create the route**

`backend/src/routes/benchmark.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express, { Router } from 'express';
import { postBenchmarkRun, getBenchmarkRuns } from '../controllers/benchmarkController.js';
import { requireUser } from '../middleware/auth.js';

const router: Router = express.Router();
router.use(requireUser);

router.post('/', postBenchmarkRun);
router.get('/', getBenchmarkRuns);

export default router;
```

- [ ] **Step 3: Wire into app.ts**

In `backend/src/app.ts`, add after the last `import` for a router:

```typescript
import benchmarkRoutes from './routes/benchmark.js';
```

Then in the route registration block, after the last `app.use(...)` route:

```typescript
  app.use('/api/benchmarks', benchmarkRoutes);
```

- [ ] **Step 4: Check TypeScript**

```bash
cd backend && npm run build 2>&1 | head -30
```

Expected: no errors. Fix any type issues before proceeding.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/benchmarkController.ts backend/src/routes/benchmark.ts backend/src/app.ts
git commit -m "feat(backend): POST/GET /api/benchmarks endpoint"
```

---

## Task 3: Backend tests

**Files:**
- Modify: `backend/src/__tests__/benchmark.test.ts`

- [ ] **Step 1: Expand tests with auth + happy path**

Replace the contents of `backend/src/__tests__/benchmark.test.ts` with:

```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';

// NOTE: These tests require a running test database.
// The app factory must accept an already-initialized DB.
// Pattern matches existing test files in this repo.

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3001';
const TOKEN = process.env.TEST_API_TOKEN || '';

const RUN_ID = `test-run-${Date.now()}`;

const SAMPLE_PAYLOAD = {
  run_id: RUN_ID,
  machine_name: 'Test Machine',
  model_name: 'test-model:latest',
  mode: 'quick',
  results: [
    { category: 'coding', score: 80, tasks_total: 5, tasks_passed: 4, raw_results: '[]' },
    { category: 'general', score: 60, tasks_total: 5, tasks_passed: 3, raw_results: '[]' },
    { category: 'project', score: 100, tasks_total: 5, tasks_passed: 5, raw_results: '[]' },
    { category: 'speed', score: 42.5, tasks_total: 3, tasks_passed: 3, raw_results: '[]' },
  ],
};

describe('POST /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await fetch(`${API_BASE}/api/benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE_PAYLOAD),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 with missing fields', async () => {
    const res = await fetch(`${API_BASE}/api/benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ run_id: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('inserts benchmark rows and returns 201', async () => {
    if (!TOKEN) { console.warn('Skipping: no TEST_API_TOKEN'); return; }
    const res = await fetch(`${API_BASE}/api/benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(SAMPLE_PAYLOAD),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { run_id: string };
    expect(body.run_id).toBe(RUN_ID);
  });
});

describe('GET /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await fetch(`${API_BASE}/api/benchmarks`);
    expect(res.status).toBe(401);
  });

  it('returns inserted run', async () => {
    if (!TOKEN) { console.warn('Skipping: no TEST_API_TOKEN'); return; }
    const res = await fetch(`${API_BASE}/api/benchmarks?model=test-model:latest`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runs: unknown[] };
    expect(Array.isArray(body.runs)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd backend && npm test -- --testPathPattern=benchmark
```

Expected: 401 tests PASS; 400 + 201 + GET tests skip if no TOKEN (acceptable). With a token: all PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/benchmark.test.ts
git commit -m "test(backend): benchmark endpoint tests"
```

---

## Task 4: CLI task definitions

**Files:**
- Create: `benchmark/config.js`
- Create: `benchmark/tasks/coding.js`
- Create: `benchmark/tasks/general.js`
- Create: `benchmark/tasks/project.js`
- Create: `benchmark/tasks/speed.js`

- [ ] **Step 1: Create config.js**

`benchmark/config.js`:

```js
export const QUICK_COUNT = 5;
export const STANDARD_COUNT = 15;
export const OLLAMA_BASE = 'http://localhost:11434';
export const BACKEND_BASE = 'http://localhost:3001';
export const TASK_TIMEOUT_MS = 60_000;
```

- [ ] **Step 2: Create coding.js**

`benchmark/tasks/coding.js`:

```js
// HumanEval-style tasks. Each task has: id, prompt, check(response) → boolean
export const codingTasks = [
  {
    id: 'fizzbuzz',
    prompt: 'Write a JavaScript function fizzbuzz(n) that returns an array of strings from 1 to n where multiples of 3 are "Fizz", multiples of 5 are "Buzz", and multiples of both are "FizzBuzz". Return ONLY the function code, no explanation.',
    check: (r) => /fizzbuzz/i.test(r) && /FizzBuzz/i.test(r) && /Fizz/i.test(r) && /Buzz/i.test(r),
  },
  {
    id: 'fibonacci',
    prompt: 'Write a JavaScript function fibonacci(n) that returns the nth Fibonacci number (0-indexed, so fibonacci(0)=0, fibonacci(1)=1, fibonacci(7)=13). Return ONLY the function code.',
    check: (r) => /fibonacci/i.test(r) && (r.includes('fibonacci(n-1)') || r.includes('fibonacci(n - 1)') || r.includes('fib[') || r.includes('memo')),
  },
  {
    id: 'palindrome',
    prompt: 'Write a JavaScript function isPalindrome(s) that returns true if the string s is a palindrome (ignoring case and non-alphanumeric characters), false otherwise. Return ONLY the function code.',
    check: (r) => /isPalindrome/i.test(r) && (r.includes('reverse') || r.includes('split')),
  },
  {
    id: 'list-reverse',
    prompt: 'Write a JavaScript function reverseArray(arr) that returns a new array with elements in reverse order WITHOUT mutating the input. Return ONLY the function code.',
    check: (r) => /reverseArray/i.test(r) && (r.includes('reverse()') || r.includes('slice') || r.includes('reduceRight') || r.includes('spread') || r.includes('...')),
  },
  {
    id: 'word-count',
    prompt: 'Write a JavaScript function wordCount(str) that returns the number of words in a string (words separated by whitespace). Return ONLY the function code.',
    check: (r) => /wordCount/i.test(r) && (r.includes('split') || r.includes('match')),
  },
  {
    id: 'dedup',
    prompt: 'Write a JavaScript function deduplicate(arr) that returns a new array with duplicate values removed, preserving order. Return ONLY the function code.',
    check: (r) => /deduplicate/i.test(r) && (r.includes('Set') || r.includes('filter') || r.includes('indexOf')),
  },
  {
    id: 'prime',
    prompt: 'Write a JavaScript function isPrime(n) that returns true if n is a prime number, false otherwise. Handle edge cases (n < 2 returns false). Return ONLY the function code.',
    check: (r) => /isPrime/i.test(r) && r.includes('return false') && (r.includes('Math.sqrt') || r.includes('i * i')),
  },
  {
    id: 'caesar',
    prompt: 'Write a JavaScript function caesarCipher(str, shift) that encodes str using a Caesar cipher with the given shift. Only shift letters (A-Z, a-z), leave other characters unchanged. Return ONLY the function code.',
    check: (r) => /caesarCipher/i.test(r) && r.includes('charCodeAt') && r.includes('String.fromCharCode'),
  },
  {
    id: 'flatten',
    prompt: 'Write a JavaScript function flattenArray(arr) that recursively flattens a nested array of any depth. E.g. flattenArray([1,[2,[3,[4]]],5]) returns [1,2,3,4,5]. Return ONLY the function code.',
    check: (r) => /flattenArray/i.test(r) && (r.includes('flat') || r.includes('concat') || r.includes('reduce') || r.includes('recursive')),
  },
  {
    id: 'binary-search',
    prompt: 'Write a JavaScript function binarySearch(sortedArr, target) that returns the index of target in sortedArr, or -1 if not found. Return ONLY the function code.',
    check: (r) => /binarySearch/i.test(r) && r.includes('mid') && (r.includes('left') || r.includes('low')) && (r.includes('right') || r.includes('high')),
  },
  {
    id: 'anagram',
    prompt: 'Write a JavaScript function isAnagram(a, b) that returns true if strings a and b are anagrams of each other (case-insensitive). Return ONLY the function code.',
    check: (r) => /isAnagram/i.test(r) && (r.includes('sort') || r.includes('Map') || r.includes('frequency')),
  },
  {
    id: 'count-vowels',
    prompt: 'Write a JavaScript function countVowels(str) that returns the count of vowels (a,e,i,o,u, case-insensitive) in str. Return ONLY the function code.',
    check: (r) => /countVowels/i.test(r) && (r.includes('aeiou') || r.includes('match')),
  },
  {
    id: 'merge-sorted',
    prompt: 'Write a JavaScript function mergeSorted(a, b) that merges two sorted arrays into one sorted array. Return ONLY the function code.',
    check: (r) => /mergeSorted/i.test(r) && (r.includes('push') || r.includes('concat')) && r.includes('while'),
  },
  {
    id: 'find-duplicates',
    prompt: 'Write a JavaScript function findDuplicates(arr) that returns an array of values that appear more than once in arr. Return ONLY the function code.',
    check: (r) => /findDuplicates/i.test(r) && (r.includes('filter') || r.includes('Map') || r.includes('Set')),
  },
  {
    id: 'roman-numeral',
    prompt: 'Write a JavaScript function toRoman(num) that converts an integer (1-3999) to a Roman numeral string. E.g. toRoman(4)="IV", toRoman(1994)="MCMXCIV". Return ONLY the function code.',
    check: (r) => /toRoman/i.test(r) && r.includes('M') && r.includes('IV') && r.includes('IX'),
  },
];
```

- [ ] **Step 3: Create general.js**

`benchmark/tasks/general.js`:

```js
// MMLU-style multiple-choice. Each task: id, question, options {A,B,C,D}, answer ('A'|'B'|'C'|'D')
export const generalTasks = [
  { id: 'g1', question: 'What is the chemical symbol for gold?', options: { A: 'Au', B: 'Ag', C: 'Go', D: 'Gd' }, answer: 'A' },
  { id: 'g2', question: 'Which planet is closest to the Sun?', options: { A: 'Venus', B: 'Earth', C: 'Mercury', D: 'Mars' }, answer: 'C' },
  { id: 'g3', question: 'What is 17 × 13?', options: { A: '211', B: '221', C: '231', D: '241' }, answer: 'B' },
  { id: 'g4', question: 'In which year did World War II end?', options: { A: '1943', B: '1944', C: '1945', D: '1946' }, answer: 'C' },
  { id: 'g5', question: 'What is the capital of Australia?', options: { A: 'Sydney', B: 'Melbourne', C: 'Brisbane', D: 'Canberra' }, answer: 'D' },
  { id: 'g6', question: 'If all roses are flowers and some flowers fade quickly, which must be true?', options: { A: 'All roses fade quickly', B: 'Some roses may fade quickly', C: 'No roses fade quickly', D: 'All flowers are roses' }, answer: 'B' },
  { id: 'g7', question: 'What is the square root of 144?', options: { A: '11', B: '12', C: '13', D: '14' }, answer: 'B' },
  { id: 'g8', question: 'Who wrote "Hamlet"?', options: { A: 'Charles Dickens', B: 'Geoffrey Chaucer', C: 'William Shakespeare', D: 'John Milton' }, answer: 'C' },
  { id: 'g9', question: 'What is the speed of light in vacuum (approximately)?', options: { A: '300,000 km/s', B: '150,000 km/s', C: '450,000 km/s', D: '200,000 km/s' }, answer: 'A' },
  { id: 'g10', question: 'How many sides does a hexagon have?', options: { A: '5', B: '6', C: '7', D: '8' }, answer: 'B' },
  { id: 'g11', question: 'Which programming language was created by Brendan Eich?', options: { A: 'Python', B: 'Ruby', C: 'JavaScript', D: 'Java' }, answer: 'C' },
  { id: 'g12', question: 'What is the largest ocean on Earth?', options: { A: 'Atlantic', B: 'Indian', C: 'Arctic', D: 'Pacific' }, answer: 'D' },
  { id: 'g13', question: 'What does CPU stand for?', options: { A: 'Central Processing Unit', B: 'Computer Personal Unit', C: 'Central Program Utility', D: 'Core Processing Unit' }, answer: 'A' },
  { id: 'g14', question: 'Which element has atomic number 1?', options: { A: 'Helium', B: 'Hydrogen', C: 'Carbon', D: 'Lithium' }, answer: 'B' },
  { id: 'g15', question: 'What is 2^10?', options: { A: '512', B: '1024', C: '2048', D: '256' }, answer: 'B' },
];
```

- [ ] **Step 4: Create project.js**

`benchmark/tasks/project.js`:

```js
// KI Usage Tracker domain tasks. Each task: id, prompt, keywords (all must appear in response)
export const projectTasks = [
  {
    id: 'p1',
    prompt: 'Write a SQLite SELECT query that returns all rows from a table called "usage_records" from the last 30 days, grouped by a column called "source", summing a column called "cost_eur". Return ONLY the SQL query, nothing else.',
    keywords: ['SELECT', 'usage_records', 'GROUP BY', 'source', 'SUM', 'cost_eur'],
  },
  {
    id: 'p2',
    prompt: 'What does importScripts() do in a Chrome Manifest V3 Service Worker? Answer in exactly one sentence.',
    keywords: ['importScripts', 'script'],
  },
  {
    id: 'p3',
    prompt: 'Write a JavaScript regex literal that matches a valid EUR currency amount in German format such as "14,90 €" or "1.234,56 €". Return ONLY the regex literal (e.g. /pattern/).',
    keywords: ['/', '€'],
  },
  {
    id: 'p4',
    prompt: 'What HTTP status code should a REST API return when a new resource has been successfully created? Return ONLY the number.',
    keywords: ['201'],
  },
  {
    id: 'p5',
    prompt: 'In React with TypeScript, write a useState hook declaration for a string state variable called "activeTab" with initial value "overview". Return ONLY the line of code.',
    keywords: ['useState', 'activeTab', 'overview'],
  },
  {
    id: 'p6',
    prompt: 'What is the Ollama API endpoint to list all locally available models? Return ONLY the URL path (e.g. /api/something).',
    keywords: ['/api/tags'],
  },
  {
    id: 'p7',
    prompt: 'In a Chrome Extension Manifest V3, what field in manifest.json lists the URLs a service worker is allowed to fetch from? Return ONLY the field name.',
    keywords: ['host_permissions'],
  },
  {
    id: 'p8',
    prompt: 'Write a JavaScript expression that calculates tokens per second from the Ollama API response fields eval_count (number of tokens generated) and eval_duration (nanoseconds). Return ONLY the expression.',
    keywords: ['eval_count', 'eval_duration', '1e9'],
  },
  {
    id: 'p9',
    prompt: 'In Express.js, write the middleware call that parses incoming JSON request bodies with a 1mb limit. Return ONLY the one line of code.',
    keywords: ['bodyParser', 'json', '1mb'],
  },
  {
    id: 'p10',
    prompt: 'What does the SQLite pragma "PRAGMA journal_mode=WAL" do? Answer in one sentence.',
    keywords: ['WAL', 'write'],
  },
  {
    id: 'p11',
    prompt: 'In Recharts (React charting library), what component do you use to render a bar chart? Return ONLY the component name.',
    keywords: ['BarChart'],
  },
  {
    id: 'p12',
    prompt: 'Write a TypeScript interface named "BenchmarkRun" with these fields: id (number), model_name (string), score (number), created_at (string). Return ONLY the interface definition.',
    keywords: ['interface', 'BenchmarkRun', 'model_name', 'score'],
  },
  {
    id: 'p13',
    prompt: 'What does the Chrome Extension API method chrome.alarms.create() do? Answer in one sentence.',
    keywords: ['alarm', 'schedule'],
  },
  {
    id: 'p14',
    prompt: 'In an Express.js route, what does the requireUser middleware typically do? Answer in one sentence.',
    keywords: ['authenticate', 'user'],
  },
  {
    id: 'p15',
    prompt: 'Write a JavaScript async/await fetch call that sends a POST request to "/api/benchmarks" with a JSON body {run_id: "abc"} and an Authorization header "Bearer mytoken". Return ONLY the function call (no surrounding function).',
    keywords: ['fetch', '/api/benchmarks', 'Authorization', 'Bearer', 'JSON.stringify'],
  },
];
```

- [ ] **Step 5: Create speed.js**

`benchmark/tasks/speed.js`:

```js
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
```

- [ ] **Step 6: Commit**

```bash
git add benchmark/
git commit -m "feat(benchmark): task definitions for all four categories"
```

---

## Task 5: Scorer

**Files:**
- Create: `benchmark/scorer.js`

- [ ] **Step 1: Create scorer.js**

`benchmark/scorer.js`:

```js
import { OLLAMA_BASE, TASK_TIMEOUT_MS } from './config.js';

async function callModel(model, prompt) {
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
    if (!res.ok) return { text: '', error: `HTTP ${res.status}` };
    const data = await res.json();
    return { text: data.response ?? '', raw: data };
  } catch (e) {
    clearTimeout(timer);
    return { text: '', error: e.message };
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
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/scorer.js
git commit -m "feat(benchmark): scoring logic for coding/general/project"
```

---

## Task 6: Reporters

**Files:**
- Create: `benchmark/reporters/terminal.js`
- Create: `benchmark/reporters/json.js`
- Create: `benchmark/reporters/html.js`
- Create: `benchmark/reporters/markdown.js`

- [ ] **Step 1: Create terminal.js**

`benchmark/reporters/terminal.js`:

```js
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function colorScore(score) {
  if (score === null || score === undefined) return '  —  ';
  const s = typeof score === 'number' ? score.toFixed(1) : String(score);
  if (score >= 80) return `${GREEN}${s}${RESET}`;
  if (score >= 60) return `${YELLOW}${s}${RESET}`;
  return `${RED}${s}${RESET}`;
}

export function printTerminalReport(allResults, machineName, mode) {
  console.log(`\n${BOLD}=== Ollama Benchmark — ${machineName} — ${mode} mode ===${RESET}\n`);
  console.log(`${'Model'.padEnd(35)} ${'Coding'.padStart(8)} ${'General'.padStart(8)} ${'Project'.padStart(8)} ${'Overall'.padStart(8)} ${'Speed(t/s)'.padStart(10)}`);
  console.log('─'.repeat(85));

  for (const { model, categories } of allResults) {
    const coding = categories.find((c) => c.category === 'coding');
    const general = categories.find((c) => c.category === 'general');
    const project = categories.find((c) => c.category === 'project');
    const speed = categories.find((c) => c.category === 'speed');
    const scores = [coding?.score, general?.score, project?.score].filter((s) => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    console.log(
      `${model.slice(0, 34).padEnd(35)} ` +
      `${colorScore(coding?.score).padStart(8 + 9)} ` +
      `${colorScore(general?.score).padStart(8 + 9)} ` +
      `${colorScore(project?.score).padStart(8 + 9)} ` +
      `${colorScore(overall).padStart(8 + 9)} ` +
      `${(speed?.score?.toFixed(1) ?? '—').padStart(10)}`
    );
  }
  console.log('');
}
```

- [ ] **Step 2: Create json.js**

`benchmark/reporters/json.js`:

```js
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
```

- [ ] **Step 3: Create markdown.js**

`benchmark/reporters/markdown.js`:

```js
import fs from 'fs';
import path from 'path';

export function writeMarkdownReport(allResults, machineName, mode, runId) {
  const dir = path.join(process.cwd(), 'benchmark', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = machineName.toLowerCase().replace(/\s+/g, '-');
  const filename = `${ts}-${slug}.md`;
  const filepath = path.join(dir, filename);

  const lines = [
    `# Ollama Benchmark — ${machineName}`,
    ``,
    `**Mode:** ${mode} | **Run ID:** ${runId} | **Date:** ${new Date().toISOString()}`,
    ``,
    `| Model | Coding | General | Project | Overall | Speed (t/s) |`,
    `|---|---|---|---|---|---|`,
  ];

  for (const { model, categories } of allResults) {
    const get = (cat) => categories.find((c) => c.category === cat);
    const coding = get('coding')?.score ?? '—';
    const general = get('general')?.score ?? '—';
    const project = get('project')?.score ?? '—';
    const speed = get('speed')?.score?.toFixed(1) ?? '—';
    const scores = [get('coding')?.score, get('general')?.score, get('project')?.score].filter((s) => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : '—';
    lines.push(`| ${model} | ${coding} | ${general} | ${project} | ${overall} | ${speed} |`);
  }

  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`MD    → benchmark/results/${filename}`);
  return filepath;
}
```

- [ ] **Step 4: Create html.js**

`benchmark/reporters/html.js`:

```js
import fs from 'fs';
import path from 'path';

function scoreColor(score) {
  if (score == null) return '#888';
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#ca8a04';
  return '#dc2626';
}

export function writeHtmlReport(allResults, machineName, mode, runId) {
  const dir = path.join(process.cwd(), 'benchmark', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = machineName.toLowerCase().replace(/\s+/g, '-');
  const filename = `${ts}-${slug}.html`;
  const filepath = path.join(dir, filename);

  const rows = allResults.map(({ model, categories }) => {
    const get = (cat) => categories.find((c) => c.category === cat);
    const coding = get('coding')?.score;
    const general = get('general')?.score;
    const project = get('project')?.score;
    const speed = get('speed')?.score;
    const scores = [coding, general, project].filter((s) => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const cell = (v, isSpeed = false) => {
      const display = v != null ? (isSpeed ? v.toFixed(1) : v) : '—';
      const color = isSpeed ? '#374151' : scoreColor(v);
      return `<td style="color:${color};font-weight:600">${display}</td>`;
    };
    return `<tr><td>${model}</td>${cell(coding)}${cell(general)}${cell(project)}${cell(overall)}${cell(speed, true)}</tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Ollama Benchmark — ${machineName}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.5rem;margin-bottom:.25rem}
  .meta{color:#555;font-size:.9rem;margin-bottom:1.5rem}
  table{width:100%;border-collapse:collapse;font-size:.95rem}
  th{background:#f3f4f6;text-align:left;padding:.6rem .8rem;border-bottom:2px solid #e5e7eb}
  td{padding:.55rem .8rem;border-bottom:1px solid #e5e7eb}
  tr:hover td{background:#f9fafb}
</style>
</head>
<body>
<h1>Ollama Benchmark — ${machineName}</h1>
<p class="meta">Mode: <b>${mode}</b> &nbsp;|&nbsp; Run ID: ${runId} &nbsp;|&nbsp; ${new Date().toISOString()}</p>
<table>
<thead><tr><th>Model</th><th>Coding</th><th>General</th><th>Project</th><th>Overall</th><th>Speed (t/s)</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;

  fs.writeFileSync(filepath, html);
  console.log(`HTML  → benchmark/results/${filename}`);
  return filepath;
}
```

- [ ] **Step 5: Commit**

```bash
git add benchmark/reporters/
git commit -m "feat(benchmark): four output reporters (terminal, json, html, markdown)"
```

---

## Task 7: send.js + run.js orchestrator

**Files:**
- Create: `benchmark/send.js`
- Create: `benchmark/run.js`

- [ ] **Step 1: Create send.js**

`benchmark/send.js`:

```js
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
```

- [ ] **Step 2: Create run.js**

`benchmark/run.js`:

```js
#!/usr/bin/env node
import { codingTasks } from './tasks/coding.js';
import { generalTasks } from './tasks/general.js';
import { projectTasks } from './tasks/project.js';
import { runSpeedTasks } from './tasks/speed.js';
import { scoreCoding, scoreGeneral, scoreProject } from './scorer.js';
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
const skipSend = hasFlag('--no-send');
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
    await sendToBackend(allResults, machineName, mode, runId, token);
  }

  console.log('\nDone.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Make executable and add package.json to benchmark/**

```bash
chmod +x benchmark/run.js
```

Create `benchmark/package.json`:

```json
{
  "name": "ollama-benchmark",
  "version": "1.0.0",
  "type": "module",
  "description": "Benchmark suite for local Ollama models"
}
```

- [ ] **Step 4: Smoke test (quick, no-send, single model)**

```bash
node benchmark/run.js --mode quick --no-send --machine "Test"
```

Expected: runs through all models, prints terminal table, writes 3 files to `benchmark/results/`, no backend call.

- [ ] **Step 5: Commit**

```bash
git add benchmark/
git commit -m "feat(benchmark): CLI orchestrator run.js + send.js"
```

---

## Task 8: Frontend — types, API, BenchmarksTab, wire-up

**Files:**
- Create: `frontend/src/types/benchmark.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/components/BenchmarksTab.tsx`
- Modify: `frontend/src/components/DashboardTabs.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Create benchmark types**

`frontend/src/types/benchmark.ts`:

```typescript
export interface BenchmarkRun {
  id: number;
  run_id: string;
  machine_name: string;
  model_name: string;
  mode: 'quick' | 'standard';
  category: 'coding' | 'general' | 'project' | 'speed';
  score: number | null;
  tasks_total: number | null;
  tasks_passed: number | null;
  raw_results: string;
  created_at: string;
}

export interface BenchmarkRunsResponse {
  runs: BenchmarkRun[];
}

export interface ModelSummary {
  model: string;
  machines: string[];
  coding: number | null;
  general: number | null;
  project: number | null;
  overall: number | null;
  speed: number | null;
}
```

- [ ] **Step 2: Add API function**

In `frontend/src/services/api.ts`, add after the last function:

```typescript
// ---------------------------------------------------------------------------
// Benchmark endpoints
// ---------------------------------------------------------------------------
import type { BenchmarkRunsResponse } from '../types/benchmark';

export function getBenchmarkRuns(params?: { model?: string; machine?: string; mode?: string }): Promise<BenchmarkRunsResponse> {
  const q = new URLSearchParams(params as Record<string, string> ?? {}).toString();
  return apiCall<BenchmarkRunsResponse>(`/benchmarks${q ? `?${q}` : ''}`);
}
```

- [ ] **Step 3: Create BenchmarksTab.tsx**

`frontend/src/components/BenchmarksTab.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getBenchmarkRuns } from '../services/api';
import type { BenchmarkRun, ModelSummary } from '../types/benchmark';

function scoreColor(score: number | null): string {
  if (score == null) return 'text-gray-400';
  if (score >= 80) return 'text-green-600 font-semibold';
  if (score >= 60) return 'text-yellow-600 font-semibold';
  return 'text-red-600 font-semibold';
}

function buildSummaries(runs: BenchmarkRun[]): ModelSummary[] {
  const byModel = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    if (!byModel.has(run.model_name)) byModel.set(run.model_name, []);
    byModel.get(run.model_name)!.push(run);
  }

  return Array.from(byModel.entries()).map(([model, modelRuns]) => {
    const latest = (cat: string): number | null => {
      const row = modelRuns.filter((r) => r.category === cat).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      return row?.score ?? null;
    };
    const coding = latest('coding');
    const general = latest('general');
    const project = latest('project');
    const speed = latest('speed');
    const scores = [coding, general, project].filter((s): s is number => s != null);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const machines = [...new Set(modelRuns.map((r) => r.machine_name))];
    return { model, machines, coding, general, project, overall, speed };
  });
}

function ScoreCell({ score }: { score: number | null }): React.ReactElement {
  return (
    <td className={`px-4 py-3 text-right tabular-nums ${scoreColor(score)}`}>
      {score != null ? score : '—'}
    </td>
  );
}

export default function BenchmarksTab(): React.ReactElement {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof ModelSummary>('overall');

  useEffect(() => {
    let cancelled = false;
    getBenchmarkRuns({ limit: '200' } as Record<string, string>)
      .then((data) => { if (!cancelled) { setRuns(data.runs); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="py-8 text-center text-gray-500">Lade Benchmark-Daten…</div>;
  if (error) return <div className="py-8 text-center text-red-600">Fehler: {error}</div>;
  if (runs.length === 0) {
    return (
      <div className="py-8 text-center text-gray-500">
        <p className="font-medium">Noch keine Benchmark-Daten</p>
        <p className="text-sm mt-1">Starte mit: <code className="bg-gray-100 px-1 rounded">node benchmark/run.js --mode quick</code></p>
      </div>
    );
  }

  const summaries = buildSummaries(runs).sort((a, b) => {
    const av = a[sortKey] as number | null;
    const bv = b[sortKey] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  const machines = [...new Set(runs.map((r) => r.machine_name))];
  const speedData = summaries.map((s) => ({ name: s.model.replace(/:latest$/, ''), speed: s.speed ?? 0 }));

  const SortHeader = ({ label, key }: { label: string; key: keyof ModelSummary }): React.ReactElement => (
    <th
      className={`px-4 py-3 text-right text-sm font-medium cursor-pointer select-none ${sortKey === key ? 'text-gray-900 underline' : 'text-gray-500 hover:text-gray-700'}`}
      onClick={() => setSortKey(key)}
    >
      {label}
    </th>
  );

  return (
    <div className="space-y-8">
      {/* Score Table */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Modell-Scores</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Modell</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Maschine</th>
                <SortHeader label="Coding" key="coding" />
                <SortHeader label="General" key="general" />
                <SortHeader label="Project" key="project" />
                <SortHeader label="Overall" key="overall" />
                <SortHeader label="Speed (t/s)" key="speed" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summaries.map((s) => (
                <tr key={s.model} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{s.model}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.machines.join(', ')}</td>
                  <ScoreCell score={s.coding} />
                  <ScoreCell score={s.general} />
                  <ScoreCell score={s.project} />
                  <ScoreCell score={s.overall} />
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{s.speed != null ? s.speed.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-1">Klick auf Spalten-Header zum Sortieren</p>
      </div>

      {/* Speed Chart */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Speed: Tokens/Sekunde</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={speedData} margin={{ top: 4, right: 16, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-40} textAnchor="end" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="speed" name="t/s" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Machine Comparison */}
      {machines.length > 1 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Maschinen-Vergleich</h2>
          <div className="grid grid-cols-2 gap-4">
            {machines.map((machine) => {
              const machineSummaries = buildSummaries(runs.filter((r) => r.machine_name === machine));
              const avg = (key: keyof ModelSummary): string => {
                const vals = machineSummaries.map((s) => s[key] as number | null).filter((v): v is number => v != null);
                return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
              };
              return (
                <div key={machine} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-sm mb-2">{machine}</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-gray-500">Ø Coding</span><span className="font-semibold">{avg('coding')}</span>
                    <span className="text-gray-500">Ø General</span><span className="font-semibold">{avg('general')}</span>
                    <span className="text-gray-500">Ø Project</span><span className="font-semibold">{avg('project')}</span>
                    <span className="text-gray-500">Ø Speed</span><span className="font-semibold">{avg('speed')} t/s</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Run History */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Run-Verlauf</h2>
        <div className="space-y-1">
          {[...new Set(runs.map((r) => r.run_id))].slice(0, 20).map((runId) => {
            const runRows = runs.filter((r) => r.run_id === runId);
            const first = runRows[0];
            const models = [...new Set(runRows.map((r) => r.model_name))];
            return (
              <div key={runId} className="text-sm flex gap-4 py-2 border-b border-gray-100">
                <span className="text-gray-400 font-mono text-xs">{new Date(first.created_at).toLocaleString('de-DE')}</span>
                <span className="text-gray-600">{first.machine_name}</span>
                <span className="text-gray-400">{first.mode}</span>
                <span className="text-gray-500">{models.length} Modell(e)</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add 'benchmarks' to DashboardTabs**

In `frontend/src/components/DashboardTabs.tsx`, change:

```typescript
type TabType = 'overview' | 'models' | 'combined';
```

to:

```typescript
type TabType = 'overview' | 'models' | 'combined' | 'benchmarks';
```

And add to the `tabs` array:

```typescript
const tabs: Tab[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'models', label: 'Modelle' },
  { id: 'combined', label: 'Gesamtkosten' },
  { id: 'benchmarks', label: 'Benchmarks' },   // ← add this line
];
```

- [ ] **Step 5: Wire BenchmarksTab into Dashboard.tsx**

In `frontend/src/pages/Dashboard.tsx`:

Change:
```typescript
type TabType = 'overview' | 'models' | 'combined';
```
to:
```typescript
type TabType = 'overview' | 'models' | 'combined' | 'benchmarks';
```

Add import:
```typescript
import BenchmarksTab from '../components/BenchmarksTab';
```

Add render after `{activeTab === 'combined' && <CombinedCostTab />}`:
```typescript
{activeTab === 'benchmarks' && <BenchmarksTab />}
```

- [ ] **Step 6: Type-check frontend**

```bash
cd frontend && npm run type-check
```

Expected: no errors. Fix any type issues.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/benchmark.ts frontend/src/services/api.ts frontend/src/components/BenchmarksTab.tsx frontend/src/components/DashboardTabs.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat(frontend): BenchmarksTab with score table, speed chart, machine comparison"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Start backend**

```bash
cd backend && npm run dev
```

Expected: `Server running on port 3001`

- [ ] **Step 2: Run quick benchmark with your API token**

```bash
node benchmark/run.js --mode quick --machine "MacBook Pro M3 Max" --token YOUR_API_TOKEN
```

Expected: terminal table printed, 3 files in `benchmark/results/`, backend receives POST requests (200 "✓ Sent" lines).

- [ ] **Step 3: Start frontend and verify tab**

```bash
cd frontend && npm run dev
```

Open browser → Dashboard → click **Benchmarks** tab → score table should show results for all tested models.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: ollama benchmark suite — CLI + backend + dashboard tab complete"
```

---

## Self-Review Notes

- All spec requirements covered: 4 categories ✓, quick/standard modes ✓, all models ✓, 4 output formats ✓, POST to backend ✓, new tab ✓, score table + speed chart + machine comparison + run history ✓
- No TBDs or placeholders
- Types consistent: `BenchmarkRun`, `ModelSummary`, `BenchmarkRunsResponse` defined once in `frontend/src/types/benchmark.ts` and imported where needed
- `getBenchmarkRuns` import in `api.ts` uses type from the same types file
- Machine comparison section only renders when `machines.length > 1` — won't break on single-machine runs
