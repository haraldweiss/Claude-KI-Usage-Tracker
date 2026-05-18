# Latest Uploads Section (Sub-Projekt B.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th dynamic section "Frisch hochgeladen" to the catalog. The same 04:00 cron that refreshes the curated HF cache (B.1) also queries HF for the top 6 latest Bartowski + MaziyarPanahi GGUF uploads and writes them to a new `catalog_latest_uploads` index table. Backend response gets one more section; frontend renders it automatically.

**Architecture:** Reuse B.1's `catalog_hf_cache` table for per-model metadata. New small ordering table `catalog_latest_uploads` (position 1-6 → repo). Two new functions: `fetchLatestUploads(author)` in catalogService, `refreshLatestUploads()` in catalogCacheRefresh. Atomic DELETE+INSERT on the index table during refresh.

**Tech Stack:** Node.js/TypeScript + node-sqlite3 + Jest (backend), Hugging Face Hub API.

**Spec:** [docs/superpowers/specs/2026-05-18-latest-uploads-section-design.md](../specs/2026-05-18-latest-uploads-section-design.md)

---

## Task 1: Add `catalog_latest_uploads` table

**Files:**
- Modify: `backend/src/database/sqlite.ts`

- [ ] **Step 1.1: Find insertion point**

Open `backend/src/database/sqlite.ts`. Find the block that creates `catalog_hf_cache` (added in Sub-B.1). The new table block goes immediately after that, before `resolve();`.

- [ ] **Step 1.2: Insert table creation**

Append after the existing `catalog_hf_cache` CREATE TABLE:

```typescript
// Sub-B.2: index table for the dynamic "Latest Uploads" section. Holds the
// top 6 repos by lastModified across the configured quanters. Refreshed
// daily by catalogCacheRefresh.refreshLatestUploads(). Metadata for each
// repo lives in catalog_hf_cache.
await new Promise<void>((res, rej) => {
  database.run(
    `CREATE TABLE IF NOT EXISTS catalog_latest_uploads (
      position    INTEGER PRIMARY KEY,
      repo        TEXT NOT NULL,
      fetched_at  TEXT NOT NULL
    )`,
    (tErr: Error | null) => (tErr ? rej(tErr) : res())
  );
});
```

- [ ] **Step 1.3: Run backend tests (no regression)**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npm test 2>&1 | tail -5
```

Expected: pre-existing pass count holds (one pre-existing failure unrelated).

- [ ] **Step 1.4: Commit**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d"
git add backend/src/database/sqlite.ts
git commit -m "feat(catalog-latest): add catalog_latest_uploads table"
```

---

## Task 2: latestUploadsRepo

**Files:**
- Create: `backend/src/data/latestUploadsRepo.ts`
- Create: `backend/src/__tests__/unit/latestUploadsRepo.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `backend/src/__tests__/unit/latestUploadsRepo.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { replaceLatestUploads, listLatestUploads } = await import(
  '../../data/latestUploadsRepo.js'
);

beforeAll(async () => {
  await initDatabase();
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_latest_uploads');
});

describe('latestUploadsRepo', () => {
  it('replaceLatestUploads writes rows with sequential positions', async () => {
    await replaceLatestUploads(['a/x', 'b/y', 'c/z']);
    const rows = await listLatestUploads();
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.repo)).toEqual(['a/x', 'b/y', 'c/z']);
    expect(rows[0]?.fetched_at).toMatch(/^2\d{3}-/);
  });

  it('replaceLatestUploads replaces (not appends) on second call', async () => {
    await replaceLatestUploads(['a/x', 'b/y', 'c/z']);
    await replaceLatestUploads(['p/q', 'r/s']);
    const rows = await listLatestUploads();
    expect(rows.map((r) => r.repo)).toEqual(['p/q', 'r/s']);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it('replaceLatestUploads with empty array clears the table', async () => {
    await replaceLatestUploads(['a/x', 'b/y']);
    await replaceLatestUploads([]);
    const rows = await listLatestUploads();
    expect(rows).toHaveLength(0);
  });

  it('listLatestUploads orders by position ASC', async () => {
    await runQuery(
      `INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES
       (3, 'c/z', '2026-05-18T00:00:00'),
       (1, 'a/x', '2026-05-18T00:00:00'),
       (2, 'b/y', '2026-05-18T00:00:00')`,
    );
    const rows = await listLatestUploads();
    expect(rows.map((r) => r.repo)).toEqual(['a/x', 'b/y', 'c/z']);
  });
});
```

- [ ] **Step 2.2: Run to verify fail**

```
cd backend && npm test -- latestUploadsRepo
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the repo**

Create `backend/src/data/latestUploadsRepo.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Index over catalog_hf_cache for the dynamic "Latest Uploads" section.
import { runQuery, allQuery } from '../database/sqlite.js';

export interface LatestUploadRow {
  position: number;
  repo: string;
  fetched_at: string;
}

export async function replaceLatestUploads(repos: string[]): Promise<void> {
  // Atomic replacement: clear all, then insert new ordering.
  // sqlite3's serialize ordering guarantees the DELETE finishes before INSERTs.
  const now = new Date().toISOString();
  await runQuery('DELETE FROM catalog_latest_uploads');
  for (let i = 0; i < repos.length; i++) {
    await runQuery(
      'INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES (?, ?, ?)',
      [i + 1, repos[i], now],
    );
  }
}

export async function listLatestUploads(): Promise<LatestUploadRow[]> {
  return allQuery<LatestUploadRow>(
    'SELECT position, repo, fetched_at FROM catalog_latest_uploads ORDER BY position ASC',
  );
}
```

- [ ] **Step 2.4: Run tests**

```
npm test -- latestUploadsRepo
```

Expected: 4 passed.

- [ ] **Step 2.5: Commit**

```
git add backend/src/data/latestUploadsRepo.ts \
        backend/src/__tests__/unit/latestUploadsRepo.test.ts
git commit -m "feat(catalog-latest): add CRUD helpers for catalog_latest_uploads"
```

---

## Task 3: `fetchLatestUploads` in catalogService

**Files:**
- Modify: `backend/src/services/catalogService.ts`
- Modify: `backend/src/__tests__/unit/catalogService.test.ts` (extend)

- [ ] **Step 3.1: Add types + function to catalogService**

Open `backend/src/services/catalogService.ts`. Below the `HfModelResponse` interface, add:

```typescript
export interface HfModelDto {
  id?: string;            // e.g. "bartowski/X-GGUF"
  modelId?: string;       // sometimes used instead of id
  lastModified?: string;  // ISO 8601
}
```

At the end of the file (after `__clearCacheForTest`), add:

```typescript
export async function fetchLatestUploads(
  author: string, limit: number = 15,
): Promise<HfModelDto[]> {
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('author', author);
  url.searchParams.set('library', 'gguf');
  url.searchParams.set('sort', 'lastModified');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`HF ${res.status}`);
  return (await res.json()) as HfModelDto[];
}
```

- [ ] **Step 3.2: Add test**

In `backend/src/__tests__/unit/catalogService.test.ts`, add at the bottom:

```typescript
const { fetchLatestUploads } = await import('../../services/catalogService.js');

describe('fetchLatestUploads', () => {
  it('queries HF with author + sort=lastModified', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'bartowski/A-GGUF', lastModified: '2026-05-17T10:00:00' },
        { id: 'bartowski/B-GGUF', lastModified: '2026-05-16T10:00:00' },
      ],
    });
    const r = await fetchLatestUploads('bartowski', 10);
    expect(r).toHaveLength(2);
    expect(r[0]?.id).toBe('bartowski/A-GGUF');
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('author=bartowski');
    expect(String(url)).toContain('sort=lastModified');
    expect(String(url)).toContain('direction=-1');
    expect(String(url)).toContain('limit=10');
  });

  it('throws on HF error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(fetchLatestUploads('bartowski')).rejects.toThrow(/HF 500/);
  });
});
```

- [ ] **Step 3.3: Run tests**

```
npm test -- catalogService
```

Expected: 11 passed (9 existing + 2 new).

- [ ] **Step 3.4: Commit**

```
git add backend/src/services/catalogService.ts \
        backend/src/__tests__/unit/catalogService.test.ts
git commit -m "feat(catalog-latest): add fetchLatestUploads HF API query"
```

---

## Task 4: `refreshLatestUploads` in catalogCacheRefresh

**Files:**
- Modify: `backend/src/services/catalogCacheRefresh.ts`
- Modify: `backend/src/__tests__/unit/catalogCacheRefresh.test.ts`

- [ ] **Step 4.1: Add tests first**

In `backend/src/__tests__/unit/catalogCacheRefresh.test.ts`, append at the bottom (after the existing `describe('isCacheEmpty', …)` block):

```typescript
const { refreshLatestUploads } = await import(
  '../../services/catalogCacheRefresh.js'
);
const { listLatestUploads } = await import('../../data/latestUploadsRepo.js');

describe('refreshLatestUploads', () => {
  function authorListMock(author: string, repos: Array<[string, string]>) {
    return async (url: string) => {
      if (url.includes(`author=${author}`) && url.includes('sort=lastModified')) {
        return {
          ok: true,
          json: async () => repos.map(([id, lastModified]) => ({ id, lastModified })),
        };
      }
      // Detail-fetch by repo:
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    };
  }

  function extractRepoFromUrl(url: string): string {
    const m = url.match(/api\/models\/([^?]+)$/);
    return m ? decodeURIComponent(m[1]!).replace(/%2F/gi, '/') : 'unknown/unknown';
  }

  it('picks top 6 across both quanters, sorted by lastModified DESC', async () => {
    // Bartowski: 4 recent uploads; MaziyarPanahi: 4 — together 8, top 6 wins.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('author=bartowski') && url.includes('sort=lastModified')) {
        return {
          ok: true,
          json: async () => [
            { id: 'bartowski/A-GGUF', lastModified: '2026-05-18T12:00:00' },
            { id: 'bartowski/B-GGUF', lastModified: '2026-05-18T10:00:00' },
            { id: 'bartowski/C-GGUF', lastModified: '2026-05-18T08:00:00' },
            { id: 'bartowski/D-GGUF', lastModified: '2026-05-16T08:00:00' },
          ],
        };
      }
      if (url.includes('author=MaziyarPanahi') && url.includes('sort=lastModified')) {
        return {
          ok: true,
          json: async () => [
            { id: 'MaziyarPanahi/W-GGUF', lastModified: '2026-05-18T11:00:00' },
            { id: 'MaziyarPanahi/X-GGUF', lastModified: '2026-05-18T09:00:00' },
            { id: 'MaziyarPanahi/Y-GGUF', lastModified: '2026-05-17T09:00:00' },
            { id: 'MaziyarPanahi/Z-GGUF', lastModified: '2026-05-15T09:00:00' },
          ],
        };
      }
      // Detail call for each repo:
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });

    const r = await refreshLatestUploads();
    expect(r.failed).toBe(0);
    expect(r.refreshed).toBe(6);

    const rows = await listLatestUploads();
    expect(rows).toHaveLength(6);
    // Top by lastModified DESC: A (12), W (11), B (10), X (09), C (08), Y (17 09)
    expect(rows.map((x) => x.repo)).toEqual([
      'bartowski/A-GGUF',
      'MaziyarPanahi/W-GGUF',
      'bartowski/B-GGUF',
      'MaziyarPanahi/X-GGUF',
      'bartowski/C-GGUF',
      'MaziyarPanahi/Y-GGUF',
    ]);
  });

  it('dedups duplicate repos across quanters', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('author=bartowski') && url.includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'shared/X-GGUF', lastModified: '2026-05-18T12:00:00' },
        ]};
      }
      if (url.includes('author=MaziyarPanahi') && url.includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'shared/X-GGUF', lastModified: '2026-05-17T12:00:00' },
        ]};
      }
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });

    await refreshLatestUploads();
    const rows = await listLatestUploads();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repo).toBe('shared/X-GGUF');
  });

  it('keeps going if one quanter fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('author=bartowski') && url.includes('sort=lastModified')) {
        return { ok: false, status: 500 };
      }
      if (url.includes('author=MaziyarPanahi') && url.includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'MaziyarPanahi/M1-GGUF', lastModified: '2026-05-18T12:00:00' },
          { id: 'MaziyarPanahi/M2-GGUF', lastModified: '2026-05-17T12:00:00' },
        ]};
      }
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });

    const r = await refreshLatestUploads();
    expect(r.errors.some((e) => e.repo === 'author:bartowski')).toBe(true);
    expect(r.refreshed).toBe(2);
    const rows = await listLatestUploads();
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 4.2: Run to verify fail**

```
npm test -- catalogCacheRefresh
```

Expected: FAIL — `refreshLatestUploads` not exported.

- [ ] **Step 4.3: Implement refreshLatestUploads**

In `backend/src/services/catalogCacheRefresh.ts`, add imports at the top:

```typescript
import { fetchLatestUploads, fetchModelMetadata } from './catalogService.js';
import { replaceLatestUploads } from '../data/latestUploadsRepo.js';
```

(Note: `fetchModelMetadata` is already imported. If `fetchLatestUploads` isn't yet — add it.)

Append the new function at the bottom of the file:

```typescript
const LATEST_QUANTERS = ['bartowski', 'MaziyarPanahi'];
const LATEST_TOP_N = 6;

export async function refreshLatestUploads(): Promise<RefreshSummary> {
  const summary: RefreshSummary = { refreshed: 0, failed: 0, errors: [] };

  // 1. Query both quanters' latest uploads. Failures per author do not abort.
  const merged: Array<{ repo: string; lastModified: string }> = [];
  for (const author of LATEST_QUANTERS) {
    try {
      const list = await fetchLatestUploads(author, 15);
      for (const m of list) {
        const repo = m.id ?? m.modelId;
        if (repo && m.lastModified) {
          merged.push({ repo, lastModified: m.lastModified });
        }
      }
    } catch (e) {
      summary.errors.push({ repo: `author:${author}`, error: (e as Error).message });
      summary.failed++;
    }
  }

  // 2. Sort by lastModified DESC, dedup by repo, take top N.
  const seen = new Set<string>();
  const top = merged
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    .filter((m) => {
      if (seen.has(m.repo)) return false;
      seen.add(m.repo);
      return true;
    })
    .slice(0, LATEST_TOP_N);

  // 3. Ensure each repo's metadata is in catalog_hf_cache. Per-repo errors do
  //    not stop the loop — failing repo still ends up in latest list with
  //    cache miss (Page-load fallback to live HF later).
  for (const m of top) {
    try {
      const card = await fetchModelMetadata(m.repo, 'Q4_K_M');
      if (card === null) {
        summary.failed++;
        summary.errors.push({ repo: m.repo, error: 'HF 404' });
        continue;
      }
      const clean = { ...card };
      delete clean.stale;
      await upsertCardCache(m.repo, clean, null);
      summary.refreshed++;
    } catch (e) {
      summary.failed++;
      summary.errors.push({ repo: m.repo, error: (e as Error).message });
    }
  }

  // 4. Atomic replacement of the index table.
  await replaceLatestUploads(top.map((m) => m.repo));

  return summary;
}
```

- [ ] **Step 4.4: Run tests**

```
npm test -- catalogCacheRefresh
```

Expected: 8 passed (5 existing + 3 new).

- [ ] **Step 4.5: Commit**

```
git add backend/src/services/catalogCacheRefresh.ts \
        backend/src/__tests__/unit/catalogCacheRefresh.test.ts
git commit -m "feat(catalog-latest): refreshLatestUploads pulls top 6 from HF"
```

---

## Task 5: Controller returns 4th section

**Files:**
- Modify: `backend/src/controllers/catalogController.ts`

- [ ] **Step 5.1: Add imports**

At the top of `backend/src/controllers/catalogController.ts`, alongside the existing imports:

```typescript
import { listLatestUploads } from '../data/latestUploadsRepo.js';
```

- [ ] **Step 5.2: Extend getCurated**

Find the current `getCurated` function. Replace it with this extended version:

```typescript
export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = CURATED_MODELS;

  // 3 static sections (unchanged)
  const staticSections = await Promise.all(
    spec.sections.map(async (s) => {
      const cards = await Promise.all(
        s.models.map(async (m): Promise<ModelCard | null> => {
          const cached = await getCachedCard(m.repo);
          let card: ModelCard | null;
          if (cached) {
            card = cached.card;
          } else {
            card = await fetchModelMetadata(m.repo, s.default_quant).catch(() => null);
          }
          if (!card) return null;
          return {
            ...card,
            pros: m.pros,
            cons: m.cons,
            setup_note: m.setup_note,
          };
        }),
      );
      return {
        key: s.key,
        label: s.label,
        default_quant: s.default_quant,
        models: cards.filter((c): c is ModelCard => c !== null),
      };
    }),
  );

  // 4th dynamic section: latest uploads
  const latestRows = await listLatestUploads();
  const latestCards = await Promise.all(latestRows.map(async (r): Promise<ModelCard | null> => {
    const cached = await getCachedCard(r.repo);
    if (cached) return cached.card;
    // Cold-start fallback — unlikely once cron has run, but graceful
    return fetchModelMetadata(r.repo, 'Q4_K_M').catch(() => null);
  }));
  const latestSection = {
    key: 'latest',
    label: 'Frisch hochgeladen',
    default_quant: 'Q4_K_M',
    models: latestCards.filter((c): c is ModelCard => c !== null),
  };

  const oldest = await getOldestFetchedAt();
  res.json({ sections: [...staticSections, latestSection], fetched_at: oldest });
}
```

- [ ] **Step 5.3: TypeScript check + tests**

```
npx tsc --noEmit 2>&1 | head -5
npm test 2>&1 | tail -5
```

Expected: TS clean. Tests pass minus the pre-existing failure.

- [ ] **Step 5.4: Commit**

```
git add backend/src/controllers/catalogController.ts
git commit -m "feat(catalog-latest): controller returns 4th dynamic section"
```

---

## Task 6: Cron + initial-prime in server.ts

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 6.1: Update import**

Find the import for `refreshCuratedHfCache, isCacheEmpty` and extend it:

```typescript
import {
  refreshCuratedHfCache,
  refreshLatestUploads,
  isCacheEmpty,
} from './services/catalogCacheRefresh.js';
```

- [ ] **Step 6.2: Update cron schedule**

Find the existing `cron.schedule('0 4 * * *', …)` block. Replace it with this extended version:

```typescript
cron.schedule('0 4 * * *', async () => {
  try {
    console.log('[catalog-cache] starting daily refresh');
    const r = await refreshCuratedHfCache();
    console.log(`[catalog-cache] curated refreshed=${r.refreshed} failed=${r.failed}`);
    const l = await refreshLatestUploads();
    console.log(`[catalog-cache] latest  refreshed=${l.refreshed} failed=${l.failed}`);
    for (const e of [...r.errors, ...l.errors]) {
      console.warn(`[catalog-cache] ${e.repo}: ${e.error}`);
    }
  } catch (err) {
    console.error('[catalog-cache] cron error', err);
  }
});
console.log('Catalog HF cache refresh scheduled daily at 04:00');
```

- [ ] **Step 6.3: Update initial-prime block**

Find the existing `isCacheEmpty().then(...)` block. Replace it with this version that primes both:

```typescript
isCacheEmpty().then((empty) => {
  if (empty) {
    console.log('[catalog-cache] cache empty on startup — priming');
    Promise.all([refreshCuratedHfCache(), refreshLatestUploads()])
      .then(([rc, rl]) => console.log(
        `[catalog-cache] primed: curated=${rc.refreshed}/${rc.failed} latest=${rl.refreshed}/${rl.failed}`,
      ))
      .catch((err) => console.error('[catalog-cache] prime error', err));
  }
}).catch((err) => console.error('[catalog-cache] empty-check error', err));
```

- [ ] **Step 6.4: TypeScript check + boot smoke**

```
npx tsc --noEmit 2>&1 | head -3
rm -f /tmp/b2-boot.sqlite
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=/tmp/b2-boot.sqlite PORT=3092 npx tsx src/server.ts > /tmp/b2-boot.log 2>&1 &
PID=$!
sleep 18
grep -E "catalog-cache|Catalog HF" /tmp/b2-boot.log
kill $PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/b2-boot.sqlite /tmp/b2-boot.log
```

Expected output contains:
- `Catalog HF cache refresh scheduled daily at 04:00`
- `[catalog-cache] cache empty on startup — priming`
- After ~15s: `[catalog-cache] primed: curated=8/0 latest=6/0`

- [ ] **Step 6.5: Commit**

```
git add backend/src/server.ts
git commit -m "feat(catalog-latest): cron + initial-prime cover both curated and latest"
```

---

## Task 7: Local E2E + Deploy

- [ ] **Step 7.1: Full tests + build**

```
cd backend
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -3
```

Expected: tests green minus pre-existing; build clean.

- [ ] **Step 7.2: E2E with live HF**

```
rm -f /tmp/b2-e2e.sqlite
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=/tmp/b2-e2e.sqlite PORT=3091 npx tsx src/server.ts > /tmp/b2-e2e.log 2>&1 &
PID=$!
sleep 20
echo "--- log ---"
grep "catalog-cache" /tmp/b2-e2e.log | head -10
echo "--- catalog_latest_uploads ---"
node -e "
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('/tmp/b2-e2e.sqlite');
db.all('SELECT position, repo FROM catalog_latest_uploads ORDER BY position', (err, rows) => {
  console.log('rows:', rows.length);
  for (const r of rows) console.log('  ', r.position, r.repo);
  db.close();
});
"
kill $PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/b2-e2e.sqlite /tmp/b2-e2e.log
```

Expected: 6 rows in catalog_latest_uploads, all with Bartowski/MaziyarPanahi authors, sorted as the freshest uploads of the day.

- [ ] **Step 7.3: Merge to main + push**

```
cd "/Library/WebServer/Documents/KI Usage tracker"
git fetch origin main
git merge --ff-only claude/priceless-kapitsa-81ec8d
git push origin main
```

- [ ] **Step 7.4: VPS deploy**

```
ssh ionos-vps 'set -e
cd /var/www/wolfinisoftware/claudetracker
git pull --ff-only origin main 2>&1 | tail -3
cd backend
rm -rf dist.backup && cp -r dist dist.backup
npx tsc 2>&1 | tail -3
systemctl restart claudetracker-backend
sleep 20
echo "--- catalog-cache logs ---"
grep "catalog-cache" /var/log/claudetracker-backend.log | tail -8
echo "--- catalog_latest_uploads on prod DB ---"
node -e "
const sqlite3 = require(\"sqlite3\");
const db = new sqlite3.Database(\"/var/www/wolfinisoftware/claudetracker/backend/database.sqlite\");
db.all(\"SELECT position, repo FROM catalog_latest_uploads ORDER BY position\", (err, rows) => {
  console.log(\"rows:\", rows.length);
  for (const r of rows) console.log(\"  \", r.position, r.repo);
  db.close();
});
"
'
```

Expected: 6 rows freshly written; log shows `primed: curated=8/0 latest=6/0`.

- [ ] **Step 7.5: Production smoke**

```
echo "frontend /catalog:"
curl -s -o /dev/null -w "  %{http_code}\n" https://wolfinisoftware.de/claudetracker/catalog
echo "API curated (no auth, expect 401):"
curl -s -o /dev/null -w "  %{http_code}\n" https://wolfinisoftware.de/claudetracker/api/catalog/curated
```

Expected: 200, 401.

- [ ] **Step 7.6: User UI smoke on prod**

1. Open <https://wolfinisoftware.de/claudetracker/catalog>
2. 4 sections render: Code / Chat / Reasoning / **Frisch hochgeladen**
3. The 4th section has 6 cards, all from Bartowski/MaziyarPanahi
4. Cards in the latest section have no Pros/Cons box (expected; that's B.3's job)
5. Each card has a copy-button with `:Q4_K_M` tag

---

## Final Checks

- [ ] All backend tests green minus 1 pre-existing: `cd backend && npm test 2>&1 | tail -3`
- [ ] Production has 6 rows in `catalog_latest_uploads`
- [ ] `/catalog` shows 4 sections live
- [ ] Cron schedule confirmed: log shows "scheduled daily at 04:00"
