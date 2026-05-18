# HF Background-Cache (Sub-Projekt B.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the curated HF model metadata fetch from a per-page-load roundtrip to a daily 4 AM cron that writes to a new `catalog_hf_cache` table. `/api/catalog/curated` reads from DB; live HF stays as a cold-start fallback. Frontend footer shows the oldest fetched_at as "letzte Aktualisierung vor X".

**Architecture:** Additive table + cron job in `server.ts` next to the existing schedulers. Controller reads cache rows and merges with the in-code curated meta (pros/cons/setup_note) before responding. Search path remains unchanged (live HF + 30-min in-memory cache).

**Tech Stack:** Node.js/TypeScript + node-sqlite3 + Jest (backend), React + TypeScript + Vite (frontend), node-cron.

**Spec:** [docs/superpowers/specs/2026-05-18-hf-background-cache-design.md](../specs/2026-05-18-hf-background-cache-design.md)

---

## Task 1: Add `catalog_hf_cache` table

**Files:**
- Modify: `backend/src/database/sqlite.ts`

- [ ] **Step 1.1: Read sqlite.ts to find the right insertion point**

Open `backend/src/database/sqlite.ts`. Find the block that creates `provider_service_user_ids` (added in Sub-A.1). The new table block goes immediately AFTER its index creation but BEFORE `resolve();` at the bottom of `initDatabase()`.

- [ ] **Step 1.2: Insert table creation block**

Append after the existing `idx_psuid_user_enabled` index creation:

```typescript
// Sub-B.1: HF metadata cache. Filled daily by the catalogCacheRefresh cron
// (and once on startup if empty). Page-load reads from here instead of
// hitting the HF API for each curated model.
await new Promise<void>((res, rej) => {
  database.run(
    `CREATE TABLE IF NOT EXISTS catalog_hf_cache (
      repo        TEXT PRIMARY KEY,
      data_json   TEXT NOT NULL,
      fetched_at  TEXT NOT NULL,
      last_error  TEXT
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

Expected: all tests pass (minus the pre-existing auth-flow failure).

- [ ] **Step 1.4: Commit**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d"
git add backend/src/database/sqlite.ts
git commit -m "feat(catalog-cache): add catalog_hf_cache table"
```

---

## Task 2: catalogCacheRepo (CRUD helpers)

**Files:**
- Create: `backend/src/data/catalogCacheRepo.ts`
- Create: `backend/src/__tests__/unit/catalogCacheRepo.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `backend/src/__tests__/unit/catalogCacheRepo.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  upsertCardCache,
  recordCacheError,
  getCachedCard,
  getOldestFetchedAt,
} = await import('../../data/catalogCacheRepo.js');

const sampleCard = {
  repo: 'bartowski/X-GGUF',
  size_b: 7,
  quant_count: 12,
  downloads: 1000,
  source_label: 'Bartowski',
  description: 'sample',
  default_quant: 'Q4_K_M',
  ollama_command: 'ollama run hf.co/bartowski/X-GGUF:Q4_K_M',
};

beforeAll(async () => {
  await initDatabase();
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_hf_cache');
});

describe('catalogCacheRepo', () => {
  it('upsertCardCache writes a new row and overwrites on conflict', async () => {
    await upsertCardCache('bartowski/X-GGUF', sampleCard, null);
    const after1 = await getCachedCard('bartowski/X-GGUF');
    expect(after1?.card.downloads).toBe(1000);
    expect(after1?.last_error).toBeNull();

    // Update with different downloads
    await upsertCardCache('bartowski/X-GGUF', { ...sampleCard, downloads: 2000 }, null);
    const after2 = await getCachedCard('bartowski/X-GGUF');
    expect(after2?.card.downloads).toBe(2000);
  });

  it('recordCacheError sets last_error without touching data_json', async () => {
    await upsertCardCache('bartowski/X-GGUF', sampleCard, null);
    await recordCacheError('bartowski/X-GGUF', 'HF 500');
    const after = await getCachedCard('bartowski/X-GGUF');
    expect(after?.last_error).toBe('HF 500');
    expect(after?.card.downloads).toBe(1000);  // unchanged
  });

  it('getCachedCard returns null for unknown repo', async () => {
    const r = await getCachedCard('does/not/exist');
    expect(r).toBeNull();
  });

  it('getOldestFetchedAt returns null for empty table', async () => {
    const r = await getOldestFetchedAt();
    expect(r).toBeNull();
  });

  it('getOldestFetchedAt returns the earliest fetched_at', async () => {
    // Manually insert with controlled timestamps
    await runQuery(
      `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at, last_error)
       VALUES ('a', ?, '2026-05-01T00:00:00', NULL),
              ('b', ?, '2026-05-02T00:00:00', NULL)`,
      [JSON.stringify(sampleCard), JSON.stringify(sampleCard)],
    );
    const oldest = await getOldestFetchedAt();
    expect(oldest).toBe('2026-05-01T00:00:00');
  });
});
```

- [ ] **Step 2.2: Run to verify fail**

```
cd backend && npm test -- catalogCacheRepo
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the repo**

Create `backend/src/data/catalogCacheRepo.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { runQuery, getQuery } from '../database/sqlite.js';
import type { ModelCard } from '../services/catalogService.js';

export interface CacheRow {
  repo: string;
  card: ModelCard;
  fetched_at: string;
  last_error: string | null;
}

export async function upsertCardCache(
  repo: string, card: ModelCard, lastError: string | null,
): Promise<void> {
  await runQuery(
    `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at, last_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       data_json = excluded.data_json,
       fetched_at = excluded.fetched_at,
       last_error = excluded.last_error`,
    [repo, JSON.stringify(card), new Date().toISOString(), lastError],
  );
}

export async function recordCacheError(repo: string, error: string): Promise<void> {
  // Only updates last_error; preserves data_json and fetched_at so old data
  // stays visible while we track the recent refresh failure.
  await runQuery(
    `UPDATE catalog_hf_cache SET last_error = ? WHERE repo = ?`,
    [error, repo],
  );
}

export async function getCachedCard(repo: string): Promise<CacheRow | null> {
  const row = await getQuery<{
    repo: string;
    data_json: string;
    fetched_at: string;
    last_error: string | null;
  }>('SELECT * FROM catalog_hf_cache WHERE repo = ?', [repo]);
  if (!row) return null;
  return {
    repo: row.repo,
    card: JSON.parse(row.data_json) as ModelCard,
    fetched_at: row.fetched_at,
    last_error: row.last_error,
  };
}

export async function getOldestFetchedAt(): Promise<string | null> {
  const row = await getQuery<{ fetched_at: string | null }>(
    'SELECT MIN(fetched_at) AS fetched_at FROM catalog_hf_cache',
  );
  return row?.fetched_at ?? null;
}
```

- [ ] **Step 2.4: Run tests**

```
npm test -- catalogCacheRepo
```

Expected: 5 passed.

- [ ] **Step 2.5: Commit**

```
git add backend/src/data/catalogCacheRepo.ts \
        backend/src/__tests__/unit/catalogCacheRepo.test.ts
git commit -m "feat(catalog-cache): add CRUD helpers for catalog_hf_cache"
```

---

## Task 3: catalogCacheRefresh (cron logic)

**Files:**
- Create: `backend/src/services/catalogCacheRefresh.ts`
- Create: `backend/src/__tests__/unit/catalogCacheRefresh.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `backend/src/__tests__/unit/catalogCacheRefresh.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { getCachedCard } = await import('../../data/catalogCacheRepo.js');
const { refreshCuratedHfCache, isCacheEmpty } = await import(
  '../../services/catalogCacheRefresh.js'
);

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_hf_cache');
  jest.resetAllMocks();
});

describe('refreshCuratedHfCache', () => {
  it('refreshes all curated models successfully', async () => {
    // 8 curated models total; just return a minimal HF response for each.
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({
        modelId: extractRepoFromUrl(url),
        downloads: 100,
        siblings: [{ rfilename: 'q4.gguf' }],
      }),
    }));
    const r = await refreshCuratedHfCache();
    expect(r.refreshed).toBeGreaterThanOrEqual(8);
    expect(r.failed).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it('records last_error for individual failures, keeps going', async () => {
    let i = 0;
    fetchMock.mockImplementation(async (url: string) => {
      i++;
      // Fail the 3rd call with 500, succeed others.
      if (i === 3) return { ok: false, status: 500 };
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });
    const r = await refreshCuratedHfCache();
    expect(r.failed).toBe(1);
    expect(r.refreshed).toBeGreaterThanOrEqual(7);
    expect(r.errors).toHaveLength(1);
  });

  it('treats HF 404 as a recoverable per-row failure', async () => {
    // First call 404, rest succeeds.
    let i = 0;
    fetchMock.mockImplementation(async (url: string) => {
      i++;
      if (i === 1) return { ok: false, status: 404 };
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(url),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });
    const r = await refreshCuratedHfCache();
    expect(r.failed).toBe(1);
    expect(r.errors[0]?.error).toMatch(/404/);
  });
});

describe('isCacheEmpty', () => {
  it('returns true when no rows exist', async () => {
    expect(await isCacheEmpty()).toBe(true);
  });

  it('returns false once any curated repo is cached', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        modelId: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
        downloads: 100, siblings: [{ rfilename: 'q4.gguf' }],
      }),
    });
    await refreshCuratedHfCache();
    expect(await isCacheEmpty()).toBe(false);
  });
});

// Tiny helper to extract repo from HF api URL like
// https://huggingface.co/api/models/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF
function extractRepoFromUrl(url: string): string {
  const m = url.match(/api\/models\/(.+)$/);
  if (!m) return 'unknown/unknown';
  // Decode percent-encoding (catalogService encodes each side separately)
  return decodeURIComponent(m[1]!).replace(/%2F/gi, '/');
}
```

- [ ] **Step 3.2: Run to verify fail**

```
npm test -- catalogCacheRefresh
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the service**

Create `backend/src/services/catalogCacheRefresh.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Daily refresh of HF metadata for the curated catalog models.
// Per-repo error handling: a failing repo doesn't stop the loop. The
// existing DB row keeps its data_json and gets last_error stamped.
import { fetchModelMetadata } from './catalogService.js';
import { CURATED_MODELS } from '../data/curatedModels.js';
import {
  upsertCardCache,
  recordCacheError,
  getCachedCard,
} from '../data/catalogCacheRepo.js';

export interface RefreshSummary {
  refreshed: number;
  failed: number;
  errors: Array<{ repo: string; error: string }>;
}

export async function refreshCuratedHfCache(): Promise<RefreshSummary> {
  const allRepos = CURATED_MODELS.sections.flatMap((s) =>
    s.models.map((m) => ({ repo: m.repo, default_quant: s.default_quant })),
  );
  const summary: RefreshSummary = { refreshed: 0, failed: 0, errors: [] };
  for (const { repo, default_quant } of allRepos) {
    try {
      const card = await fetchModelMetadata(repo, default_quant);
      if (card === null) {
        // 404 from HF — record but keep any older data.
        const msg = 'HF 404 (not found)';
        await recordCacheError(repo, msg);
        summary.failed++;
        summary.errors.push({ repo, error: msg });
        continue;
      }
      // Strip the stale flag if catalogService set it; the cron should write
      // fresh values only.
      const cleanCard = { ...card };
      delete cleanCard.stale;
      await upsertCardCache(repo, cleanCard, null);
      summary.refreshed++;
    } catch (e) {
      const msg = (e as Error).message;
      await recordCacheError(repo, msg);
      summary.failed++;
      summary.errors.push({ repo, error: msg });
    }
  }
  return summary;
}

export async function isCacheEmpty(): Promise<boolean> {
  const firstSection = CURATED_MODELS.sections[0];
  if (!firstSection) return true;
  const firstModel = firstSection.models[0];
  if (!firstModel) return true;
  const sample = await getCachedCard(firstModel.repo);
  return sample === null;
}
```

- [ ] **Step 3.4: Run tests**

```
npm test -- catalogCacheRefresh
```

Expected: 5 passed.

- [ ] **Step 3.5: Commit**

```
git add backend/src/services/catalogCacheRefresh.ts \
        backend/src/__tests__/unit/catalogCacheRefresh.test.ts
git commit -m "feat(catalog-cache): add refreshCuratedHfCache + isCacheEmpty"
```

---

## Task 4: Controller reads from cache

**Files:**
- Modify: `backend/src/controllers/catalogController.ts`

- [ ] **Step 4.1: Modify `getCurated`**

Open `backend/src/controllers/catalogController.ts`. Add the new import at the top:

```typescript
import { getCachedCard, getOldestFetchedAt } from '../data/catalogCacheRepo.js';
```

Replace the existing `getCurated` function body with:

```typescript
export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = CURATED_MODELS;
  const sections = await Promise.all(
    spec.sections.map(async (s) => {
      const cards = await Promise.all(
        s.models.map(async (m): Promise<ModelCard | null> => {
          // DB-first read. Cold-start fallback to live HF if the row is missing.
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
  const oldest = await getOldestFetchedAt();
  res.json({ sections, fetched_at: oldest });
}
```

- [ ] **Step 4.2: TypeScript check + tests**

```
npx tsc --noEmit 2>&1 | head -5
npm test 2>&1 | tail -5
```

Expected: TS clean. Tests still pass (minus pre-existing). The catalogService tests are unchanged, the new cache tests pass.

- [ ] **Step 4.3: Boot smoke**

```
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=:memory: PORT=3095 npx tsx src/server.ts > /tmp/b1-boot.log 2>&1 &
PID=$!
sleep 3
grep -iE "Server running|error" /tmp/b1-boot.log | head -5
curl -s -o /dev/null -w "/api/catalog/curated (no auth): %{http_code}\n" http://127.0.0.1:3095/api/catalog/curated
kill $PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/b1-boot.log
```

Expected: "Server running", 401.

- [ ] **Step 4.4: Commit**

```
git add backend/src/controllers/catalogController.ts
git commit -m "feat(catalog-cache): controller reads from DB cache, live HF as fallback"
```

---

## Task 5: Cron + initial prime in server.ts

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 5.1: Add imports**

In `backend/src/server.ts`, add to the existing imports near the top:

```typescript
import {
  refreshCuratedHfCache,
  isCacheEmpty,
} from './services/catalogCacheRefresh.js';
```

- [ ] **Step 5.2: Add cron + initial-prime block**

Find the existing block where other crons are scheduled (e.g. `cron.schedule('*/15 * * * *', ...)` for provider-service-sync). Add this block right after that:

```typescript
    // Sub-B.1: Daily refresh of HF metadata for curated catalog models at 04:00.
    // Offset from the 02:00 pricing cron to avoid network spikes.
    cron.schedule('0 4 * * *', async () => {
      try {
        console.log('[catalog-cache] starting daily refresh');
        const r = await refreshCuratedHfCache();
        console.log(`[catalog-cache] refreshed=${r.refreshed} failed=${r.failed}`);
        for (const e of r.errors) {
          console.warn(`[catalog-cache] ${e.repo}: ${e.error}`);
        }
      } catch (err) {
        console.error('[catalog-cache] cron error', err);
      }
    });
    console.log('Catalog HF cache refresh scheduled daily at 04:00');

    // On startup: prime the cache if empty so the first page-load
    // doesn't have to fall back to live HF for every model.
    isCacheEmpty().then((empty) => {
      if (empty) {
        console.log('[catalog-cache] cache empty on startup — priming');
        refreshCuratedHfCache()
          .then((r) => console.log(
            `[catalog-cache] primed: refreshed=${r.refreshed} failed=${r.failed}`,
          ))
          .catch((err) => console.error('[catalog-cache] prime error', err));
      }
    }).catch((err) => console.error('[catalog-cache] empty-check error', err));
```

- [ ] **Step 5.3: Run TS + boot smoke**

```
npx tsc --noEmit 2>&1 | head -5
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=/tmp/b1-prime.sqlite PORT=3094 npx tsx src/server.ts > /tmp/b1-prime.log 2>&1 &
PID=$!
sleep 5  # give the initial prime time to run a couple HF calls
grep -E "catalog-cache|catalog HF cache" /tmp/b1-prime.log
kill $PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/b1-prime.log /tmp/b1-prime.sqlite
```

Expected output contains: `Catalog HF cache refresh scheduled daily at 04:00`, `[catalog-cache] cache empty on startup — priming`, and after a few seconds `[catalog-cache] primed: refreshed=8 failed=0`.

- [ ] **Step 5.4: Commit**

```
git add backend/src/server.ts
git commit -m "feat(catalog-cache): daily 04:00 cron + initial prime on startup"
```

---

## Task 6: Frontend — fetched_at in response + footer

**Files:**
- Modify: `frontend/src/services/catalogApi.ts`
- Modify: `frontend/src/pages/CatalogPage.tsx`

- [ ] **Step 6.1: Add fetched_at to CuratedResponse**

In `frontend/src/services/catalogApi.ts`, find the `CuratedResponse` interface:

```typescript
export interface CuratedResponse {
  sections: CuratedSection[];
}
```

Replace with:

```typescript
export interface CuratedResponse {
  sections: CuratedSection[];
  fetched_at?: string | null;
}
```

- [ ] **Step 6.2: Add relative-time helper and footer to CatalogPage**

Open `frontend/src/pages/CatalogPage.tsx`. Add this helper function at the top of the file (after the imports, before the component):

```typescript
function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return iso;
  const diffMin = Math.round((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  return `vor ${diffD} ${diffD === 1 ? 'Tag' : 'Tagen'}`;
}
```

Then, inside the returned JSX, just before the closing `</div>` of the outermost wrapper, add:

```tsx
      {curated?.fetched_at && (
        <div className="mt-8 text-xs text-gray-400 text-right">
          Daten von Hugging Face — letzte Aktualisierung: {relativeTime(curated.fetched_at)}
        </div>
      )}
```

- [ ] **Step 6.3: Vite build smoke**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/frontend"
npx vite build 2>&1 | tail -5
```

Expected: build succeeds, new bundle hash.

- [ ] **Step 6.4: Commit**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d"
git add frontend/src/services/catalogApi.ts frontend/src/pages/CatalogPage.tsx
git commit -m "feat(catalog-cache): show fetched_at as relative time in catalog footer"
```

---

## Task 7: Local E2E smoke + Deploy

- [ ] **Step 7.1: Full backend tests + build**

```
cd "/Library/WebServer/Documents/KI Usage tracker/.claude/worktrees/priceless-kapitsa-81ec8d/backend"
npm test 2>&1 | tail -5
npm run build 2>&1 | tail -3
```

Expected: tests green minus pre-existing failure; build clean.

- [ ] **Step 7.2: Local server smoke with real HF calls**

```
rm -f /tmp/b1-e2e.sqlite
SECRETS_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
  DATABASE_PATH=/tmp/b1-e2e.sqlite PORT=3093 npx tsx src/server.ts > /tmp/b1-e2e.log 2>&1 &
PID=$!
sleep 15  # initial prime needs ~10s to make 8 sequential HF calls
echo "--- log excerpt ---"
grep -E "catalog-cache" /tmp/b1-e2e.log | head -10
echo "--- DB rows after prime ---"
node -e "
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('/tmp/b1-e2e.sqlite');
db.all('SELECT repo, fetched_at, last_error FROM catalog_hf_cache', (err, rows) => {
  console.log('rows:', rows.length);
  for (const r of rows) console.log('  ', r.repo, r.fetched_at, r.last_error ?? 'ok');
  db.close();
});
"
kill $PID 2>/dev/null; wait 2>/dev/null
rm -f /tmp/b1-e2e.sqlite /tmp/b1-e2e.log
```

Expected: 8 rows, all `ok` (no `last_error`), fresh `fetched_at`.

- [ ] **Step 7.3: Merge + push**

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
cd ../frontend
rm -rf dist.backup && cp -r dist dist.backup
npx vite build 2>&1 | tail -3
systemctl restart claudetracker-backend
sleep 15  # let initial prime run
echo "--- catalog-cache log ---"
grep "catalog-cache" /var/log/claudetracker-backend.log | tail -5
echo "--- DB check ---"
cd backend && node -e "
const sqlite3 = require(\"sqlite3\");
const db = new sqlite3.Database(\"/var/www/wolfinisoftware/claudetracker/backend/database.sqlite\");
db.all(\"SELECT repo, fetched_at, last_error FROM catalog_hf_cache\", (err, rows) => {
  console.log(\"rows:\", rows.length);
  for (const r of rows) console.log(\"  \", r.repo, r.fetched_at, r.last_error ?? \"ok\");
  db.close();
});
"
'
```

Expected: 8 rows freshly written, status `ok`, log shows "primed: refreshed=8 failed=0".

- [ ] **Step 7.5: Production smoke**

```
echo "frontend /catalog HTML:"
curl -s -o /dev/null -w "  %{http_code}\n" https://wolfinisoftware.de/claudetracker/catalog
echo ""
JS=$(curl -s https://wolfinisoftware.de/claudetracker/ | grep -oE "assets/index-[A-Za-z0-9_-]+\.js" | head -1)
echo "live bundle: $JS"
echo "contains 'letzte Aktualisierung':"
curl -s "https://wolfinisoftware.de/claudetracker/$JS" | grep -c "letzte Aktualisierung"
```

Expected: 200, bundle contains the new footer string.

- [ ] **Step 7.6: User UI smoke on prod**

1. Open <https://wolfinisoftware.de/claudetracker/catalog>
2. Curated sections load (should feel snappier than before — no HF roundtrip)
3. Footer shows "Daten von Hugging Face — letzte Aktualisierung: gerade eben" (or vor wenigen Min., depending on exact deploy timing)
4. Reload — should be even snappier (in-memory cache + DB)

---

## Final Checks

- [ ] All backend tests green (minus 1 pre-existing): `cd backend && npm test 2>&1 | tail -3`
- [ ] Frontend build clean: `cd frontend && npm run build 2>&1 | tail -3`
- [ ] Initial prime ran on prod (log line "primed: refreshed=8 failed=0")
- [ ] DB has 8 catalog_hf_cache rows
- [ ] Footer on /catalog shows fresh timestamp
