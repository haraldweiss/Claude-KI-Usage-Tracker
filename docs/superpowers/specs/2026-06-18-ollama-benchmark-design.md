# Ollama Benchmark Suite — Design Spec

**Date:** 2026-06-18  
**Status:** Approved  
**Scope:** KI Usage Tracker — new benchmark subsystem

---

## Overview

A CLI benchmark tool that automatically discovers all locally installed Ollama models, tests them across four categories, and posts results to the KI Usage Tracker backend for cross-machine comparison in a new dashboard tab.

---

## Goals

- Benchmark every installed Ollama model without manual model selection
- Compare performance across two machines (MacBook Pro + Michael's Mac Studio)
- Persist results in the existing backend (SQLite) for longitudinal tracking
- Surface results in a new "Benchmarks" tab in the React dashboard
- Output results in all four formats: Terminal, JSON, HTML, Markdown

---

## Non-Goals

- No cloud model benchmarking (Ollama only)
- No human evaluation pipeline (automated scoring only)
- No real-time streaming benchmark display
- No changes to existing tabs or backend endpoints

---

## Directory Structure

```
benchmark/
├── run.js                  # CLI entrypoint
├── config.js               # Task definitions (quick=5, standard=15 per category)
├── tasks/
│   ├── coding.js           # HumanEval-style Python/JS tasks
│   ├── general.js          # MMLU-style multiple-choice (A/B/C/D)
│   ├── project.js          # KI Usage Tracker domain tasks
│   └── speed.js            # Tokens/sec measurement
├── scorer.js               # Scoring logic per category
├── reporters/
│   ├── terminal.js         # Colored summary table
│   ├── json.js             # Structured output file
│   ├── html.js             # Self-contained HTML report
│   └── markdown.js         # Markdown summary
└── send.js                 # POST results to backend API
```

---

## CLI Usage

```bash
# Standard run — all models, standard mode (15 tasks/category)
node benchmark/run.js

# Quick run — all models, quick mode (5 tasks/category)
node benchmark/run.js --mode quick

# Label the machine (used in dashboard)
node benchmark/run.js --machine "MacBook Pro M3 Max"
node benchmark/run.js --machine "Mac Studio M2 Ultra"

# Skip sending to backend (local-only)
node benchmark/run.js --no-send
```

**Discovery:** On startup, `GET http://localhost:11434/api/tags` returns all installed models. The script iterates over every model automatically.

---

## Task Categories

### 1. Coding (`tasks/coding.js`)

HumanEval-style tasks. Each task provides:
- A natural-language prompt asking for a function
- An expected output when the function is called with given inputs
- A regex or exact-match check on the model's response

**Quick (5 tasks):** FizzBuzz, Fibonacci, Palindrome check, List reversal, String word count  
**Standard (15 tasks):** Above + array deduplication, prime check, Caesar cipher, flatten nested list, binary search, anagram detection, count vowels, merge sorted arrays, find duplicates, Roman numeral conversion

**Scoring:** Pass/Fail per task. Score = passed / total × 100.

### 2. General Knowledge (`tasks/general.js`)

MMLU-style multiple-choice questions. Each task has a question + four options (A/B/C/D) + correct answer.

Topics: science, history, math, geography, logic, common sense reasoning.

**Scoring:** Exact match on A/B/C/D extracted from response. Score = correct / total × 100.

### 3. Project-Specific (`tasks/project.js`)

KI Usage Tracker domain knowledge. Tests how well a model understands the project's stack.

Example tasks:
- "Write a SQLite query that returns all usage_snapshots from the last 30 days grouped by source, summing cost_eur. Return valid SQL only."
- "What does `importScripts` do in a Chrome MV3 Service Worker? Answer in one sentence."
- "Write a JavaScript regex that matches a valid EUR amount like '14,90 €' or '1.234,56 €'."
- "In a React component using Recharts, write a BarChart that renders [{name:'Claude',value:12},{name:'OpenCode',value:5}]."
- "What HTTP status code should a REST API return when a resource is created successfully?"

**Scoring:** Keyword presence check (predefined expected keywords per task). Score = tasks_with_all_keywords / total × 100. Tasks can be manually overridden via a `--review` flag for human spot-check.

### 4. Speed / Throughput (`tasks/speed.js`)

Three prompt sizes: short (50 tokens), medium (200 tokens), long (500 tokens).
Each measured 3 times, median taken.

Metric from Ollama API response: `eval_count / (eval_duration / 1e9)` = tokens/sec.

**Output:** tokens/sec per prompt size, plus overall average.

---

## Scoring Summary

| Category | Method | Scale |
|---|---|---|
| Coding | Pass/Fail per task | 0–100 |
| General | Exact A/B/C/D match | 0–100 |
| Project | Keyword presence | 0–100 |
| Speed | Tokens/sec (median) | raw number |

**Overall score** = average of Coding + General + Project (Speed excluded from composite).

---

## Backend Changes

### New SQLite Table

```sql
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,           -- UUID per run
  machine_name TEXT NOT NULL,     -- e.g. "MacBook Pro M3 Max"
  model_name TEXT NOT NULL,       -- e.g. "glm-4.7-flash:latest"
  mode TEXT NOT NULL,             -- "quick" | "standard"
  category TEXT NOT NULL,         -- "coding" | "general" | "project" | "speed"
  score REAL,                     -- 0-100 or tokens/sec
  tasks_total INTEGER,
  tasks_passed INTEGER,
  raw_results TEXT,               -- JSON blob of per-task details
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### New Endpoints

```
POST /api/benchmarks
  Body: { run_id, machine_name, model_name, mode, results: [...] }
  Auth: existing API token (x-api-token header)
  Response: 201 { id, run_id }

GET /api/benchmarks
  Query: ?model=&machine=&mode=&limit=50
  Auth: existing session or API token
  Response: 200 { runs: [...] }
```

---

## Frontend Changes

### New Tab: BenchmarksTab

Added to the existing tab array in `App.tsx` (after CombinedCostTab).

**Sections:**

1. **Score Table** — rows: models, columns: Coding / General / Project / Overall. Sortable. Color-coded (green >80, yellow 60-80, red <60).

2. **Speed Chart** — Recharts `BarChart`, grouped by model, colored by machine. Shows tokens/sec for short/medium/long prompts.

3. **Machine Comparison** — side-by-side cards for MacBook vs. Mac Studio showing score delta per model.

4. **Run History** — collapsible list of past runs with timestamp, machine, mode, and overall score.

**Data fetching:** `GET /api/benchmarks` on tab mount, no polling needed.

---

## Output Files

All written to `benchmark/results/` directory:

```
results/
├── 2026-06-18T14-30-00-macbook.json
├── 2026-06-18T14-30-00-macbook.html
├── 2026-06-18T14-30-00-macbook.md
└── (terminal output printed directly)
```

HTML is self-contained (inline CSS + JS, no external deps).

---

## Error Handling

- Model unavailable mid-run → skip model, log warning, continue
- Ollama API timeout (>60s per task) → mark task as timed-out, score 0
- Backend unreachable → write files locally, print "results saved locally, send manually with: node benchmark/send.js <file>"
- Malformed model response → log raw response to JSON, score 0

---

## Implementation Order

1. Backend: migration + endpoint (`/api/benchmarks`)
2. `benchmark/tasks/` — all four task files with task definitions
3. `benchmark/scorer.js` — scoring logic
4. `benchmark/reporters/` — all four reporters
5. `benchmark/send.js` — HTTP POST to backend
6. `benchmark/run.js` — main orchestrator
7. Frontend: `BenchmarksTab.tsx` + wire into `App.tsx`
8. Manual end-to-end test: run on this Mac, verify data in dashboard
