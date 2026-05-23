# Modell-Katalog (Sub-Projekt B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New `/catalog` page in the tracker that lets you browse HuggingFace GGUF models with curated default sections (Code / Chat / Reasoning), free-text search, and per-model status badges showing which ones are already installed on the connected Ollama. Each model has a copy-button for `ollama run hf.co/<repo>:Q4_K_M`.

**Architecture:** Backend acts as a proxy to the HF Hub API with a 30-min in-memory cache. Status awareness reuses the existing provider-service connection (URL + token from `user_provider_service_config`). Curated list is a JSON file under version control. Frontend is a single new page with a search bar plus sections, no global state library — local React state and three small fetch calls.

**Tech Stack:** Node.js/TypeScript + node-sqlite3 + Jest (backend), React + TypeScript + Vite (frontend), Hugging Face Hub API.

**Spec:** [docs/superpowers/specs/2026-05-18-model-catalog-design.md](../specs/2026-05-18-model-catalog-design.md)

---

## Phase 1 — Backend

### Task 1: Curated JSON data file

**Files:**
- Create: `backend/src/data/curated-models.json`

- [ ] **Step 1.1: Create the JSON file**

Create `backend/src/data/curated-models.json`:

```json
{
  "sections": [
    {
      "key": "code",
      "label": "Code",
      "default_quant": "Q4_K_M",
      "models": [
        "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
        "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF",
        "bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF"
      ]
    },
    {
      "key": "chat",
      "label": "Chat / General",
      "default_quant": "Q4_K_M",
      "models": [
        "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF",
        "bartowski/Llama-3.2-3B-Instruct-GGUF",
        "MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF"
      ]
    },
    {
      "key": "reasoning",
      "label": "Reasoning",
      "default_quant": "Q4_K_M",
      "models": [
        "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
        "bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF"
      ]
    }
  ]
}
```

- [ ] **Step 1.2: Commit**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d"
git add backend/src/data/curated-models.json
git commit -m "feat(catalog): add curated-models.json with 3 sections"
```

---

### Task 2: catalogService — HF API client + in-memory cache

**Files:**
- Create: `backend/src/services/catalogService.ts`
- Create: `backend/src/__tests__/unit/catalogService.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `backend/src/__tests__/unit/catalogService.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const {
  fetchModelMetadata,
  searchModels,
  isInstalled,
  ollamaCommandFor,
  __clearCacheForTest,
} = await import('../../services/catalogService.js');

let fetchMock: jest.Mock;

beforeEach(() => {
  __clearCacheForTest();
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('ollamaCommandFor', () => {
  it('appends the default quant tag', () => {
    expect(ollamaCommandFor('bartowski/X-GGUF', 'Q4_K_M'))
      .toBe('ollama run hf.co/bartowski/X-GGUF:Q4_K_M');
  });
});

describe('isInstalled', () => {
  it('matches with -GGUF stripped, lowercased, by startsWith', () => {
    const installed = ['qwen2.5-coder-7b-instruct:q4_k_m'];
    expect(isInstalled(installed, 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(true);
  });

  it('matches the full hf.co path', () => {
    const installed = ['hf.co/bartowski/qwen2.5-coder-7b-instruct-gguf:q4_k_m'];
    expect(isInstalled(installed, 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(true);
  });

  it('does not match unrelated models', () => {
    const installed = ['llama3:8b'];
    expect(isInstalled(installed, 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(false);
  });
});

describe('fetchModelMetadata', () => {
  it('returns a mapped ModelCard on successful HF response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        modelId: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
        downloads: 23000,
        siblings: [
          { rfilename: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf' },
          { rfilename: 'Qwen2.5-Coder-7B-Instruct-Q8_0.gguf' },
          { rfilename: 'README.md' },
        ],
        description: 'A coding LLM by Qwen team.',
      }),
    });

    const card = await fetchModelMetadata('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF', 'Q4_K_M');
    expect(card.repo).toBe('bartowski/Qwen2.5-Coder-7B-Instruct-GGUF');
    expect(card.downloads).toBe(23000);
    expect(card.quant_count).toBe(2);  // .gguf files only
    expect(card.source_label).toBe('Bartowski');
    expect(card.default_quant).toBe('Q4_K_M');
    expect(card.ollama_command).toBe('ollama run hf.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M');
    expect(card.size_b).toBe(7);
    expect(card.description).toContain('coding LLM');
  });

  it('handles 404 by returning null', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const card = await fetchModelMetadata('bartowski/Vanished-GGUF', 'Q4_K_M');
    expect(card).toBeNull();
  });

  it('uses cache on second call within TTL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ modelId: 'r', downloads: 1, siblings: [] }),
    });
    await fetchModelMetadata('r', 'Q4_K_M');
    await fetchModelMetadata('r', 'Q4_K_M');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns stale cache on HF error if cache exists', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ modelId: 'r', downloads: 1, siblings: [] }),
    });
    await fetchModelMetadata('r', 'Q4_K_M');
    __clearCacheForTest({ keepStale: true });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const card = await fetchModelMetadata('r', 'Q4_K_M');
    expect(card).not.toBeNull();
    expect(card!.stale).toBe(true);
  });
});

describe('searchModels', () => {
  it('returns mapped ModelCards from HF search', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { modelId: 'bartowski/A-GGUF', downloads: 100, siblings: [{ rfilename: 'a-Q4.gguf' }] },
        { modelId: 'bartowski/B-GGUF', downloads: 50, siblings: [{ rfilename: 'b-Q4.gguf' }] },
      ],
    });
    const r = await searchModels('coder', 50);
    expect(r.results).toHaveLength(2);
    expect(r.results[0].repo).toBe('bartowski/A-GGUF');
  });
});
```

- [ ] **Step 2.2: Run to verify fail**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npm test -- catalogService
```

Expected: FAIL — module does not exist.

- [ ] **Step 2.3: Implement the service**

Create `backend/src/services/catalogService.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HF Hub API client with in-memory cache + status-match heuristic.
// 30-min TTL, stale-fallback on HF errors.

export interface ModelCard {
  repo: string;
  size_b: number | null;
  quant_count: number;
  downloads: number;
  source_label: string;
  description: string;
  default_quant: string;
  ollama_command: string;
  stale?: boolean;
}

interface HfModelResponse {
  modelId?: string;
  downloads?: number;
  siblings?: Array<{ rfilename?: string }>;
  description?: string;
}

interface CacheEntry { data: ModelCard | ModelCard[]; fetched_at: number; }

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const HF_TOKEN = process.env.HF_TOKEN;

function authHeaders(): Record<string, string> {
  return HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
}

function sourceLabelFromRepo(repo: string): string {
  const user = repo.split('/')[0]?.toLowerCase() ?? '';
  if (user === 'bartowski') return 'Bartowski';
  if (user === 'maziyarpanahi') return 'MaziyarPanahi';
  return 'community';
}

function sizeFromRepo(repo: string): number | null {
  // Heuristic: pick the last "<n>B" pattern. Examples:
  // "Qwen2.5-Coder-7B-Instruct" → 7; "Llama-3.2-3B-Instruct" → 3.
  const matches = [...repo.matchAll(/(\d+(?:\.\d+)?)B/gi)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1][1];
  const n = parseFloat(last);
  return Number.isFinite(n) ? n : null;
}

export function ollamaCommandFor(repo: string, defaultQuant: string): string {
  return `ollama run hf.co/${repo}:${defaultQuant}`;
}

function mapToCard(
  data: HfModelResponse,
  defaultQuant: string,
  fallbackRepo: string,
): ModelCard {
  const repo = data.modelId ?? fallbackRepo;
  const ggufCount = (data.siblings ?? []).filter(
    (s) => typeof s.rfilename === 'string' && s.rfilename.toLowerCase().endsWith('.gguf'),
  ).length;
  const desc = (data.description ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
  return {
    repo,
    size_b: sizeFromRepo(repo),
    quant_count: ggufCount,
    downloads: data.downloads ?? 0,
    source_label: sourceLabelFromRepo(repo),
    description: desc.slice(0, 200),
    default_quant: defaultQuant,
    ollama_command: ollamaCommandFor(repo, defaultQuant),
  };
}

export async function fetchModelMetadata(
  repo: string, defaultQuant: string,
): Promise<ModelCard | null> {
  const key = `model:${repo}:${defaultQuant}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.fetched_at < TTL_MS) {
    return hit.data as ModelCard;
  }
  try {
    const res = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(repo)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`HF ${res.status}`);
    }
    const data = (await res.json()) as HfModelResponse;
    const card = mapToCard(data, defaultQuant, repo);
    cache.set(key, { data: card, fetched_at: now });
    return card;
  } catch (e) {
    if (hit) {
      return { ...(hit.data as ModelCard), stale: true };
    }
    throw e;
  }
}

export interface SearchResult {
  results: ModelCard[];
  stale?: boolean;
}

export async function searchModels(q: string, limit: number = 50): Promise<SearchResult> {
  const key = `search:${q}:${limit}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.fetched_at < TTL_MS) {
    return { results: hit.data as ModelCard[] };
  }
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('library', 'gguf');
  url.searchParams.set('search', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  try {
    const res = await fetch(url.toString(), { headers: authHeaders() });
    if (!res.ok) throw new Error(`HF ${res.status}`);
    const arr = (await res.json()) as HfModelResponse[];
    const cards = arr.map((d) => mapToCard(d, 'Q4_K_M', d.modelId ?? ''));
    cache.set(key, { data: cards, fetched_at: now });
    return { results: cards };
  } catch (e) {
    if (hit) {
      return { results: hit.data as ModelCard[], stale: true };
    }
    throw e;
  }
}

export function isInstalled(installedNames: string[], repo: string): boolean {
  const repoTail = repo.split('/').pop() ?? '';
  const needle = repoTail.replace(/-GGUF$/i, '').toLowerCase();
  const repoLower = repo.toLowerCase();
  return installedNames.some((n) => {
    const ln = n.toLowerCase();
    return ln.startsWith(needle) || ln.includes(`hf.co/${repoLower}`);
  });
}

// Test-only: reset the cache between unit tests.
export function __clearCacheForTest(opts?: { keepStale?: boolean }): void {
  if (opts?.keepStale) {
    // Mark all entries as expired but keep them — so the next call falls into
    // the stale-fallback branch (cache.has is true, age >= TTL_MS).
    for (const [k, v] of cache) {
      cache.set(k, { ...v, fetched_at: Date.now() - TTL_MS - 1000 });
    }
    return;
  }
  cache.clear();
}
```

- [ ] **Step 2.4: Run tests**

```
npm test -- catalogService
```

Expected: 7 passed.

- [ ] **Step 2.5: Commit**

```
git add backend/src/services/catalogService.ts \
        backend/src/__tests__/unit/catalogService.test.ts
git commit -m "feat(catalog): HF API client + cache + status heuristic"
```

---

### Task 3: catalogController + routes

**Files:**
- Create: `backend/src/controllers/catalogController.ts`
- Create: `backend/src/routes/catalog.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 3.1: Implement controller**

Create `backend/src/controllers/catalogController.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HTTP handlers for /api/catalog/*. Auth via requireUser (router-level).
import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  fetchModelMetadata,
  searchModels,
  type ModelCard,
} from '../services/catalogService.js';
import { getProviderServiceConfig } from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_PATH = join(__dirname, '../data/curated-models.json');

interface CuratedSpec {
  sections: Array<{
    key: string;
    label: string;
    default_quant: string;
    models: string[];
  }>;
}

let curatedSpecCache: CuratedSpec | null = null;

async function loadCuratedSpec(): Promise<CuratedSpec> {
  if (curatedSpecCache) return curatedSpecCache;
  const txt = await readFile(CURATED_PATH, 'utf-8');
  curatedSpecCache = JSON.parse(txt) as CuratedSpec;
  return curatedSpecCache;
}

export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = await loadCuratedSpec();
  const sections = await Promise.all(
    spec.sections.map(async (s) => {
      const cards = await Promise.all(
        s.models.map((repo) =>
          fetchModelMetadata(repo, s.default_quant).catch(() => null),
        ),
      );
      return {
        key: s.key,
        label: s.label,
        default_quant: s.default_quant,
        models: cards.filter((c): c is ModelCard => c !== null),
      };
    }),
  );
  res.json({ sections });
}

export async function getSearch(req: Request, res: Response): Promise<void> {
  const q = (req.query.q as string | undefined)?.trim() ?? '';
  if (!q) {
    res.status(400).json({ error: 'q required' });
    return;
  }
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 50));
  try {
    const r = await searchModels(q, limit);
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: 'hf_unreachable', detail: (e as Error).message });
  }
}

export async function getInstalled(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) {
    res.json({ models: [] });
    return;
  }
  try {
    const token = decryptSecret(cfg.service_token_enc);
    const url = new URL('/models/status', cfg.service_url);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      res.json({ models: [] });
      return;
    }
    const data = (await r.json()) as { loaded?: string[] };
    res.json({ models: data.loaded ?? [] });
  } catch {
    res.json({ models: [] });
  }
}
```

- [ ] **Step 3.2: Implement routes**

Create `backend/src/routes/catalog.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { getCurated, getSearch, getInstalled } from '../controllers/catalogController.js';

const router = Router();
router.use(requireUser);
router.get('/curated', getCurated);
router.get('/search', getSearch);
router.get('/installed', getInstalled);
export default router;
```

- [ ] **Step 3.3: Mount in app.ts**

Modify `backend/src/app.ts`. Find the section with other `app.use('/api/...', ...Routes)` calls. Add the import at the top:

```typescript
import catalogRoutes from './routes/catalog.js';
```

And the mount line near the others:

```typescript
app.use('/api/catalog', catalogRoutes);
```

- [ ] **Step 3.4: TypeScript check + tests**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npx tsc --noEmit 2>&1 | head -5
npm test 2>&1 | tail -5
```

Expected: TS clean, tests pass (minus the pre-existing failure).

- [ ] **Step 3.5: Boot smoke**

```
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=:memory: PORT=3097 npx tsx src/server.ts > /tmp/catalog-boot.log 2>&1 &
SERVER_PID=$!
sleep 3
grep -iE "running on|catalog|error" /tmp/catalog-boot.log | head -5
kill $SERVER_PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/catalog-boot.log
```

Expected: "Server running on http://localhost:3097", no errors.

- [ ] **Step 3.6: Commit**

```
git add backend/src/controllers/catalogController.ts \
        backend/src/routes/catalog.ts \
        backend/src/app.ts
git commit -m "feat(catalog): controllers, routes, app.ts mount"
```

---

## Phase 2 — Frontend

### Task 4: catalogApi.ts — typed client

**Files:**
- Create: `frontend/src/services/catalogApi.ts`

- [ ] **Step 4.1: Implement client**

Create `frontend/src/services/catalogApi.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { apiCall } from './api';

export interface ModelCard {
  repo: string;
  size_b: number | null;
  quant_count: number;
  downloads: number;
  source_label: string;
  description: string;
  default_quant: string;
  ollama_command: string;
  stale?: boolean;
}

export interface CuratedSection {
  key: string;
  label: string;
  default_quant: string;
  models: ModelCard[];
}

export interface CuratedResponse {
  sections: CuratedSection[];
}

export interface SearchResponse {
  results: ModelCard[];
  stale?: boolean;
}

export interface InstalledResponse {
  models: string[];
}

export function getCurated(): Promise<CuratedResponse> {
  return apiCall<CuratedResponse>('/catalog/curated');
}

export function searchCatalog(
  q: string, limit: number = 50, signal?: AbortSignal,
): Promise<SearchResponse> {
  const url = `/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  return apiCall<SearchResponse>(url, { signal });
}

export function getInstalled(): Promise<InstalledResponse> {
  return apiCall<InstalledResponse>('/catalog/installed');
}

// Mirrors the backend heuristic; used by ModelCard to decide on the badge.
export function isInstalled(installedNames: string[], repo: string): boolean {
  const repoTail = repo.split('/').pop() ?? '';
  const needle = repoTail.replace(/-GGUF$/i, '').toLowerCase();
  const repoLower = repo.toLowerCase();
  return installedNames.some((n) => {
    const ln = n.toLowerCase();
    return ln.startsWith(needle) || ln.includes(`hf.co/${repoLower}`);
  });
}
```

- [ ] **Step 4.2: Verify `apiCall` accepts AbortSignal**

Read `frontend/src/services/api.ts` to check if its `apiCall(path, init)` already forwards `init.signal` to fetch. If yes, no change needed. If not, the field is silently ignored — UI still works, just no cancellation. Adjust `apiCall` only if it strips the `init` object.

If you find `apiCall` does `{ ...init, credentials: ..., headers: ... }`, the signal passes through fine. That is the pattern from Sub-A's `apiCall`.

- [ ] **Step 4.3: TS check**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npx tsc --noEmit 2>&1 | grep catalogApi | head
```

Expected: no errors related to catalogApi.

- [ ] **Step 4.4: Commit**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d"
git add frontend/src/services/catalogApi.ts
git commit -m "feat(catalog-frontend): typed API client"
```

---

### Task 5: ModelCard component

**Files:**
- Create: `frontend/src/components/ModelCard.tsx`

- [ ] **Step 5.1: Implement**

Create `frontend/src/components/ModelCard.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useState } from 'react';
import type { ModelCard as ModelCardType } from '../services/catalogApi';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

export default function ModelCard({
  card,
  isInstalled,
}: {
  card: ModelCardType;
  isInstalled: boolean;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(card.ollama_command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers blocking clipboard: select the text in a hidden input.
      const ta = document.createElement('textarea');
      ta.value = card.ollama_command;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { /* user has to copy manually */ }
      finally { document.body.removeChild(ta); }
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-start justify-between gap-2">
        <a
          href={`https://huggingface.co/${card.repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium font-mono text-blue-700 hover:underline break-all"
        >
          {card.repo}
        </a>
        {isInstalled ? (
          <span className="shrink-0 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
            ✓ installiert
          </span>
        ) : (
          <span className="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            – nicht inst.
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
        {card.size_b != null && <span>{card.size_b}B</span>}
        <span>{card.quant_count} quants</span>
        <span>{formatNumber(card.downloads)} DL</span>
        <span className="text-gray-500">{card.source_label}</span>
      </div>
      {card.description && (
        <p
          className="mt-2 text-xs text-gray-700 line-clamp-1"
          title={card.description}
        >
          {card.description}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all font-mono">
          {card.ollama_command}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
          aria-label="Kopieren"
        >
          {copied ? '✓ Kopiert' : '📋 Kopieren'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Commit**

```
git add frontend/src/components/ModelCard.tsx
git commit -m "feat(catalog-frontend): ModelCard component"
```

---

### Task 6: CatalogSection component

**Files:**
- Create: `frontend/src/components/CatalogSection.tsx`

- [ ] **Step 6.1: Implement**

Create `frontend/src/components/CatalogSection.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useState } from 'react';
import ModelCard from './ModelCard';
import {
  isInstalled as checkInstalled,
  type CuratedSection as CuratedSectionType,
} from '../services/catalogApi';

export default function CatalogSection({
  section,
  installedNames,
}: {
  section: CuratedSectionType;
  installedNames: string[];
}): React.ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left mb-2"
      >
        <h2 className="text-lg font-semibold text-gray-900">{section.label}</h2>
        <span className="text-sm text-gray-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {section.models.map((card) => (
            <ModelCard
              key={card.repo}
              card={card}
              isInstalled={checkInstalled(installedNames, card.repo)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6.2: Commit**

```
git add frontend/src/components/CatalogSection.tsx
git commit -m "feat(catalog-frontend): CatalogSection component"
```

---

### Task 7: CatalogPage

**Files:**
- Create: `frontend/src/pages/CatalogPage.tsx`

- [ ] **Step 7.1: Implement**

Create `frontend/src/pages/CatalogPage.tsx`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useRef, useState } from 'react';
import {
  getCurated,
  searchCatalog,
  getInstalled,
  isInstalled as checkInstalled,
  type CuratedResponse,
  type ModelCard as ModelCardType,
} from '../services/catalogApi';
import ModelCard from '../components/ModelCard';
import CatalogSection from '../components/CatalogSection';

export default function CatalogPage(): React.ReactElement {
  const [curated, setCurated] = useState<CuratedResponse | null>(null);
  const [installedNames, setInstalledNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModelCardType[] | null>(null);
  const [searchStale, setSearchStale] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Initial load: curated + installed in parallel
  useEffect(() => {
    void Promise.all([getCurated(), getInstalled()]).then(([c, inst]) => {
      setCurated(c);
      setInstalledNames(inst.models);
    }).catch(() => {});
  }, []);

  // Debounced search effect
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setSearchResults(null);
      setSearchStale(false);
      setSearchError(null);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearching(true);
      setSearchError(null);
      searchCatalog(q, 50, ctrl.signal)
        .then((r) => {
          setSearchResults(r.results);
          setSearchStale(r.stale ?? false);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setSearchError((e as Error).message);
          setSearchResults([]);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Modell-Katalog</h1>
      <p className="text-sm text-gray-600 mb-4">
        Stöbere durch Hugging Face GGUF-Modelle und kopiere den{' '}
        <code className="font-mono">ollama run …</code>-Befehl, um sie auf
        deinem Ollama auszuprobieren.
      </p>

      <div className="mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Suche in HF GGUF Modellen…"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      {searchStale && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs p-2 rounded mb-3">
          Daten älter als 30 min — HF gerade nicht erreichbar.
        </div>
      )}

      {searchResults !== null ? (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Such-Treffer für „{query}" ({searchResults.length})
          </h2>
          {searching && <div className="text-sm text-gray-500">Suche läuft…</div>}
          {searchError && (
            <div className="text-sm text-red-700">Fehler: {searchError}</div>
          )}
          {searchResults.length === 0 && !searching && (
            <div className="text-sm text-gray-500 italic">
              Keine Modelle gefunden.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults.map((card) => (
              <ModelCard
                key={card.repo}
                card={card}
                isInstalled={checkInstalled(installedNames, card.repo)}
              />
            ))}
          </div>
        </section>
      ) : curated ? (
        <>
          {curated.sections.map((s) => (
            <CatalogSection key={s.key} section={s} installedNames={installedNames} />
          ))}
        </>
      ) : (
        <div className="text-sm text-gray-500">Lade Katalog…</div>
      )}
    </div>
  );
}
```

- [ ] **Step 7.2: Commit**

```
git add frontend/src/pages/CatalogPage.tsx
git commit -m "feat(catalog-frontend): CatalogPage with curated + search"
```

---

### Task 8: Wire route + nav into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 8.1: Inspect current routing**

Read `frontend/src/App.tsx` to understand routing pattern (react-router-dom? own switch?) and nav structure.

- [ ] **Step 8.2: Add the route**

Add import at the top of `App.tsx`:

```typescript
import CatalogPage from './pages/CatalogPage';
```

Find the `<Routes>` block (react-router-dom is the existing stack — based on Sub-A frontend). Add the new route alongside the others:

```tsx
<Route path="/catalog" element={<RequireAuth><CatalogPage /></RequireAuth>} />
```

(Match the wrapper used by other authenticated routes — likely `RequireAuth`.)

- [ ] **Step 8.3: Add nav entry**

Find the navigation menu component (likely inline in `App.tsx` or in `components/Header.tsx`/`UserMenu.tsx`). Add a `Link to="/catalog"` next to the other nav items with the label "Modell-Katalog".

Example pattern (adjust to match existing markup):

```tsx
<Link to="/catalog" className="...same-classes-as-other-nav-items">
  Modell-Katalog
</Link>
```

- [ ] **Step 8.4: Vite build smoke**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npx vite build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 8.5: Commit**

```
git add frontend/src/App.tsx
git commit -m "feat(catalog-frontend): mount /catalog route + nav link"
```

---

## Phase 3 — E2E + Deploy

### Task 9: Local E2E smoke

- [ ] **Step 9.1: Start both dev servers**

```
# T1
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  npm run dev
```

```
# T2
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npm run dev
```

- [ ] **Step 9.2: Browser test**

Open `http://localhost:5173`, log in via magic link, navigate to "Modell-Katalog":

1. Three sections (Code / Chat / Reasoning) render with model cards
2. At least one model shows "✓ installiert" badge (assuming local Ollama is running with qwen3-coder or similar)
3. Type "deepseek" in the search → list of matches replaces the curated sections
4. Click a copy button → toast/state flip; paste into terminal verifies the `hf.co/...:Q4_K_M` string

If any of these fail, debug before deploying.

- [ ] **Step 9.3: Final build artifacts**

```
cd backend && npm run build 2>&1 | tail -3
cd ../frontend && npm run build 2>&1 | tail -3
```

Both should succeed.

---

### Task 10: Deploy to VPS

(Mirrors the deploy playbook from Sub-A and A.1. All steps require explicit user approval before running against the VPS.)

- [ ] **Step 10.1: Merge + push**

```
cd "/Library/WebServer/Documents/KI Usage tracker"
git fetch origin main
git checkout main
git merge --ff-only claude/priceless-kapitsa-81ec8d
git push origin main
```

- [ ] **Step 10.2: VPS deploy**

```
ssh ionos-vps 'set -e
cd /var/www/wolfinisoftware/claudetracker
git pull --ff-only origin main
cd backend
rm -rf dist.backup && cp -r dist dist.backup
npm install --no-audit --no-fund
npx tsc
cd ../frontend
rm -rf dist.backup && cp -r dist dist.backup
npm install --legacy-peer-deps --no-audit --no-fund
npx vite build
systemctl restart claudetracker-backend
sleep 3
systemctl is-active claudetracker-backend
tail -10 /var/log/claudetracker-backend.log
'
```

- [ ] **Step 10.3: Smoke production**

```
echo "frontend HTML:"
curl -s -o /dev/null -w "%{http_code}\n" https://wolfinisoftware.de/claudetracker/
echo "catalog API without auth (expect 401):"
curl -s -o /dev/null -w "%{http_code}\n" https://wolfinisoftware.de/claudetracker/api/catalog/curated
echo "new bundle live?"
JS=$(curl -s https://wolfinisoftware.de/claudetracker/ | grep -oE "assets/index-[A-Za-z0-9_-]+\.js" | head -1)
echo "bundle: $JS"
echo "contains 'Modell-Katalog':"
curl -s "https://wolfinisoftware.de/claudetracker/$JS" | grep -c "Modell-Katalog"
```

Expected: 200, 401, bundle contains "Modell-Katalog".

- [ ] **Step 10.4: User UI smoke on prod**

1. Open <https://wolfinisoftware.de/claudetracker/catalog>
2. 3 curated sections render
3. Search "qwen" returns trefferliste, sortiert by downloads
4. Copy a command, run on VPS via `ssh ionos-vps "ollama run hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M"` (1 GB, fast)
5. Reload `/catalog` — newly installed model now has "✓ installiert" badge

---

## Final Checks

- [ ] Backend tests all green: `cd backend && npm test 2>&1 | tail -3`
- [ ] Frontend build clean: `cd frontend && npm run build 2>&1 | tail -3`
- [ ] Production smoke (Task 10.3-10.4) green
- [ ] At least one curated model marked installed in prod UI (sanity check that heuristic works against your live data)
