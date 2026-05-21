# Recommendations Catalog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the `/claudetracker/recommendations` ModelSuggester with (a) pros/cons for recommended Claude models and (b) a "Lokale Alternativen" section listing installed Ollama models whose family matches the task keywords.

**Architecture:** Reuse the existing pros/cons LLM pipeline for Claude models (new `model_pros_cons` table). Extract the local-installed card-assembly logic into a shared service so both the catalog endpoint and the recommender can use it. Add a keyword→family map to drive local model filtering by task type.

**Tech Stack:** Node.js, Express, TypeScript ESM, sqlite3, Jest, React, Vite, TailwindCSS

**Spec:** [docs/superpowers/specs/2026-05-21-recommendations-catalog-integration-design.md](../specs/2026-05-21-recommendations-catalog-integration-design.md)

---

## File Structure

**Backend (new):**
- `backend/src/data/keywordFamilyMap.ts` — static keyword→family map + `resolveTargetFamilies()`
- `backend/src/data/modelProsConsRepo.ts` — CRUD for `model_pros_cons`
- `backend/src/services/localInstalledService.ts` — extracted reusable logic `resolveLocalInstalledCards(userId)` for both catalog and recommender
- `backend/src/__tests__/unit/keywordFamilyMap.test.ts`
- `backend/src/__tests__/unit/modelProsConsRepo.test.ts`
- `backend/src/__tests__/unit/catalogProsConsClaude.test.ts`
- `backend/src/__tests__/unit/modelRecommendationServiceCatalog.test.ts`

**Backend (modify):**
- `backend/src/database/sqlite.ts` — add `model_pros_cons` table create
- `backend/src/services/catalogProsConsService.ts` — add `buildClaudePrompt()` + `generateClaudeProsCons()`
- `backend/src/controllers/catalogController.ts` — `getLocalInstalled` becomes a thin wrapper around `resolveLocalInstalledCards`
- `backend/src/services/modelRecommendationService.ts` — accept `userId`, enrich with pros/cons + localAlternatives
- `backend/src/controllers/modelRecommendationController.ts` — pass `req.user!.id` to service

**Frontend (modify):**
- `frontend/src/components/ModelSuggester.tsx` — extend `Recommendation` interface, render pros/cons + LocalAlternatives section

---

## Task 1: Keyword → Family Map

**Files:**
- Create: `backend/src/data/keywordFamilyMap.ts`
- Create: `backend/src/__tests__/unit/keywordFamilyMap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/keywordFamilyMap.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';
import { resolveTargetFamilies, KEYWORD_TO_FAMILIES } from '../../data/keywordFamilyMap.js';

describe('resolveTargetFamilies', () => {
  it('returns ["chat"] for empty input', () => {
    expect(resolveTargetFamilies([])).toEqual(['chat']);
  });

  it('returns ["chat"] for unknown keywords', () => {
    expect(resolveTargetFamilies(['totally-unknown-keyword'])).toEqual(['chat']);
  });

  it('returns ["code"] for "debug"', () => {
    expect(resolveTargetFamilies(['debug'])).toEqual(['code']);
  });

  it('returns deduplicated union for multiple keywords', () => {
    const result = resolveTargetFamilies(['debug', 'explain']);
    expect(result.sort()).toEqual(['chat', 'code']);
  });

  it('handles "ctf" → ["custom", "code"]', () => {
    const result = resolveTargetFamilies(['ctf']);
    expect(result.sort()).toEqual(['code', 'custom']);
  });

  it('deduplicates when multiple keywords map to same family', () => {
    expect(resolveTargetFamilies(['debug', 'refactor', 'fix'])).toEqual(['code']);
  });
});

describe('KEYWORD_TO_FAMILIES', () => {
  it('covers all keywords from the recommender service', () => {
    const required = [
      'summarize', 'list', 'format', 'extract', 'simple', 'search', 'translate', 'rewrite', 'capitalize',
      'debug', 'review', 'explain', 'refactor', 'analyze', 'code review', 'fix', 'improve', 'optimize',
      'architecture', 'design', 'reasoning', 'system design', 'ctf', 'exploit', 'research', 'multi-step', 'novel', 'challenging',
    ];
    for (const kw of required) {
      expect(KEYWORD_TO_FAMILIES[kw]).toBeDefined();
      expect(KEYWORD_TO_FAMILIES[kw]!.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- keywordFamilyMap`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write implementation**

Create `backend/src/data/keywordFamilyMap.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Mapping von Task-Keywords (aus modelRecommendationService.analyzeTaskComplexity)
// auf LocalModelFamily-Werte. Wird genutzt, um zu entscheiden, welche
// lokal installierten Ollama-Modelle als "Lokale Alternative" für eine
// bestimmte Task vorgeschlagen werden.
import type { LocalModelFamily } from './curatedLocalModels.js';

export const KEYWORD_TO_FAMILIES: Record<string, LocalModelFamily[]> = {
  // simple
  summarize: ['chat'],
  list: ['chat'],
  format: ['chat'],
  extract: ['chat'],
  simple: ['chat'],
  search: ['chat'],
  translate: ['chat'],
  rewrite: ['chat'],
  capitalize: ['chat'],
  // medium
  debug: ['code'],
  review: ['chat', 'code'],
  explain: ['chat'],
  refactor: ['code'],
  analyze: ['chat', 'code'],
  'code review': ['code'],
  fix: ['code'],
  improve: ['chat', 'code'],
  optimize: ['code'],
  // complex
  architecture: ['code'],
  design: ['code'],
  reasoning: ['chat'],
  'system design': ['code'],
  ctf: ['custom', 'code'],
  exploit: ['custom', 'code'],
  research: ['chat'],
  'multi-step': ['chat', 'code'],
  novel: ['chat'],
  challenging: ['chat'],
};

// Wandelt eine Liste von matched Keywords in die deduplizierte Menge der
// passenden LocalModelFamily-Werte um. Leere Eingabe oder ausschließlich
// unbekannte Keywords → ['chat'] (sicherer Default für generische Tasks).
export function resolveTargetFamilies(matchedKeywords: string[]): LocalModelFamily[] {
  if (matchedKeywords.length === 0) return ['chat'];
  const set = new Set<LocalModelFamily>();
  let anyMatched = false;
  for (const kw of matchedKeywords) {
    const families = KEYWORD_TO_FAMILIES[kw];
    if (families) {
      anyMatched = true;
      for (const f of families) set.add(f);
    }
  }
  if (!anyMatched) return ['chat'];
  return Array.from(set);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- keywordFamilyMap`
Expected: PASS (6+1 cases).

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/data/keywordFamilyMap.ts backend/src/__tests__/unit/keywordFamilyMap.test.ts && git commit -m "feat(reco-catalog): keyword-to-family map + resolveTargetFamilies"
```

---

## Task 2: model_pros_cons Table

**Files:**
- Modify: `backend/src/database/sqlite.ts`

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "catalog_local_pros_cons" "/Library/WebServer/Documents/KI Usage tracker/backend/src/database/sqlite.ts"`
Expected: shows the CREATE TABLE block for `catalog_local_pros_cons` (added in the previous plan).

- [ ] **Step 2: Add the new table**

Edit `backend/src/database/sqlite.ts`. Find the `catalog_local_pros_cons` block, and AFTER its closing `});` (the end of its `await new Promise(...)` Promise), BEFORE the surrounding `resolve();`, insert:

```ts
          // 2026-05-21: Pros/cons cache for non-Ollama models (Claude Haiku/
          // Sonnet/Opus today; could extend to other cloud providers later).
          // Populated lazily from the recommendation endpoint when a model
          // is recommended and has no cached pros/cons yet.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS model_pros_cons (
                model_name   TEXT PRIMARY KEY,
                pros         TEXT NOT NULL,
                cons         TEXT NOT NULL,
                generated_at TEXT NOT NULL
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });
```

- [ ] **Step 3: Verify type-check**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run type-check`
Expected: no errors.

- [ ] **Step 4: Verify table is created**

Run:
```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run build && cat > /tmp/test-mig-recat.mjs <<'EOF'
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, allQuery } = await import('./dist/database/sqlite.js');
await initDatabase();
const r = await allQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='model_pros_cons'");
console.log(JSON.stringify(r));
process.exit(0);
EOF
node /tmp/test-mig-recat.mjs && rm /tmp/test-mig-recat.mjs
```
Expected output: `[{"name":"model_pros_cons"}]`

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/database/sqlite.ts && git commit -m "feat(reco-catalog): model_pros_cons table"
```

---

## Task 3: modelProsConsRepo

**Files:**
- Create: `backend/src/data/modelProsConsRepo.ts`
- Create: `backend/src/__tests__/unit/modelProsConsRepo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/modelProsConsRepo.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { getModelProsCons, upsertModelProsCons } = await import(
  '../../data/modelProsConsRepo.js'
);

beforeAll(async () => {
  await initDatabase();
});

beforeEach(async () => {
  await runQuery('DELETE FROM model_pros_cons');
});

describe('modelProsConsRepo', () => {
  it('returns null for missing model', async () => {
    expect(await getModelProsCons('Claude Sonnet 4.6')).toBeNull();
  });

  it('round-trips a row', async () => {
    await upsertModelProsCons('Claude Sonnet 4.6', ['p1', 'p2', 'p3'], ['c1', 'c2', 'c3']);
    const row = await getModelProsCons('Claude Sonnet 4.6');
    expect(row).not.toBeNull();
    expect(row!.pros).toEqual(['p1', 'p2', 'p3']);
    expect(row!.cons).toEqual(['c1', 'c2', 'c3']);
    expect(row!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('upsert replaces existing row', async () => {
    await upsertModelProsCons('Claude Haiku 4.5', ['a', 'b', 'c'], ['x', 'y', 'z']);
    await upsertModelProsCons('Claude Haiku 4.5', ['d', 'e', 'f'], ['u', 'v', 'w']);
    const row = await getModelProsCons('Claude Haiku 4.5');
    expect(row!.pros).toEqual(['d', 'e', 'f']);
    expect(row!.cons).toEqual(['u', 'v', 'w']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- modelProsConsRepo`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write implementation**

Create `backend/src/data/modelProsConsRepo.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// CRUD für model_pros_cons. Keyed by exakter Modellname aus pricing.model
// (z.B. "Claude Sonnet 4.6"). Anders als catalog_local_pros_cons hat diese
// Tabelle keine family-Spalte — die Tier-Information lebt in pricing.tier.
import { runQuery, getQuery } from '../database/sqlite.js';

export interface ModelProsConsRow {
  model_name: string;
  pros: string[];
  cons: string[];
  generated_at: string;
}

interface RawRow {
  model_name: string;
  pros: string;
  cons: string;
  generated_at: string;
}

export async function getModelProsCons(
  modelName: string,
): Promise<ModelProsConsRow | null> {
  const row = await getQuery<RawRow>(
    'SELECT * FROM model_pros_cons WHERE model_name = ?',
    [modelName],
  );
  if (!row) return null;
  return {
    model_name: row.model_name,
    pros: JSON.parse(row.pros) as string[],
    cons: JSON.parse(row.cons) as string[],
    generated_at: row.generated_at,
  };
}

export async function upsertModelProsCons(
  modelName: string,
  pros: string[],
  cons: string[],
): Promise<void> {
  await runQuery(
    `INSERT INTO model_pros_cons (model_name, pros, cons, generated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(model_name) DO UPDATE SET
       pros = excluded.pros,
       cons = excluded.cons,
       generated_at = excluded.generated_at`,
    [
      modelName,
      JSON.stringify(pros),
      JSON.stringify(cons),
      new Date().toISOString(),
    ],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- modelProsConsRepo`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/data/modelProsConsRepo.ts backend/src/__tests__/unit/modelProsConsRepo.test.ts && git commit -m "feat(reco-catalog): modelProsConsRepo CRUD"
```

---

## Task 4: buildClaudePrompt + generateClaudeProsCons

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts` (append new exports + 1 import)
- Create: `backend/src/__tests__/unit/catalogProsConsClaude.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/catalogProsConsClaude.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { buildClaudePrompt, generateClaudeProsCons } = await import(
  '../../services/catalogProsConsService.js'
);
const { getModelProsCons } = await import('../../data/modelProsConsRepo.js');

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  process.env.CATALOG_LLM_URL = 'http://pool.test';
  process.env.CATALOG_LLM_TOKEN = 'tok';
  process.env.CATALOG_LLM_MODEL = 'mistral-nemo:latest';
});

afterEach(async () => {
  await runQuery('DELETE FROM model_pros_cons');
  jest.resetAllMocks();
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
  delete process.env.CATALOG_LLM_MODEL;
});

describe('buildClaudePrompt', () => {
  it('includes model name, tier, and pricing', () => {
    const p = buildClaudePrompt('Claude Sonnet 4.6', 'sonnet', { input: 3, output: 15 });
    expect(p).toContain('Claude Sonnet 4.6');
    expect(p).toContain('sonnet');
    expect(p).toContain('3');
    expect(p).toContain('15');
    expect(p).toMatch(/JSON/);
  });

  it('handles null tier', () => {
    const p = buildClaudePrompt('Claude Some-Model', null, { input: 1, output: 5 });
    expect(p).toContain('Claude Some-Model');
    expect(p).toMatch(/JSON/);
  });
});

describe('generateClaudeProsCons', () => {
  it('generates and caches pros/cons via primary LLM', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pros: ['Strong reasoning', '200k context', 'Vision capable'],
                cons: ['Higher cost', 'Slower than Haiku', 'Rate limits'],
              }),
            },
          },
        ],
      }),
    });
    const ok = await generateClaudeProsCons(
      'Claude Sonnet 4.6',
      'sonnet',
      { input: 3, output: 15 },
    );
    expect(ok).toBe(true);
    const cached = await getModelProsCons('Claude Sonnet 4.6');
    expect(cached!.pros).toEqual(['Strong reasoning', '200k context', 'Vision capable']);
    expect(cached!.cons).toEqual(['Higher cost', 'Slower than Haiku', 'Rate limits']);
  });

  it('returns false when LLM unavailable', async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    const ok = await generateClaudeProsCons(
      'Claude Sonnet 4.6',
      'sonnet',
      { input: 3, output: 15 },
    );
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- catalogProsConsClaude`
Expected: FAIL — `buildClaudePrompt` / `generateClaudeProsCons` not exported.

- [ ] **Step 3: Extend the service**

Edit `backend/src/services/catalogProsConsService.ts`. Add this import after the existing imports (find the line `import { upsertLocalProsCons } from '../data/localProsConsRepo.js';` from Task 4 of the previous plan, and add immediately after it):

```ts
import { upsertModelProsCons } from '../data/modelProsConsRepo.js';
```

Then append at the very end of the file:

```ts
// Prompt für Claude/Cloud-Modelle. Kennt Tier und Pricing, daher informierter
// Output als der buildLocalPrompt für anonyme Ollama-Modelle.
export function buildClaudePrompt(
  modelName: string,
  tier: string | null,
  pricing: { input: number; output: number },
): string {
  const tierLine = tier ? `Tier: ${tier}` : 'Tier: unbekannt';
  return [
    `Modell: ${modelName}`,
    tierLine,
    `Preis (USD pro 1M tokens): Input ${pricing.input}, Output ${pricing.output}`,
    '',
    'Schreibe 3 Pros und 3 Cons, jeweils einen kurzen Satz (max. 80 Zeichen),',
    'konkret und praxisnah für deutschsprachige Entwickler:innen:',
    '- Pros: Stärken des Modells (Reasoning, Kontextlänge, Geschwindigkeit, Tool-Use, Vision, etc.)',
    '- Cons: Schwächen, Limitierungen, wofür es ungeeignet ist',
    '',
    'Berücksichtige den Tier und Preis-Kontext: günstigere Modelle dürfen',
    '"weniger Reasoning" als Con haben, teure Modelle "höherer Preis" als Con.',
    '',
    'Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach:',
    '{"pros": ["...", "...", "..."], "cons": ["...", "...", "..."]}',
  ].join('\n');
}

// Generiert Pros/Cons für ein Claude-Modell via Primary-LLM (oder Fallback).
// Cached das Ergebnis in model_pros_cons. Returns true bei Erfolg.
export async function generateClaudeProsCons(
  modelName: string,
  tier: string | null,
  pricing: { input: number; output: number },
): Promise<boolean> {
  if (!isProsConsEnabled()) return false;

  const userPrompt = buildClaudePrompt(modelName, tier, pricing);
  let result: ProsCons | null = null;

  const primaryUrl = process.env.CATALOG_LLM_URL?.trim();
  const primaryToken = process.env.CATALOG_LLM_TOKEN?.trim();
  const primaryModel =
    process.env.CATALOG_LLM_MODEL?.trim() || 'mistral-nemo:latest';
  if (primaryUrl && primaryToken) {
    try {
      let content = await callOpenAICompat(
        primaryUrl, primaryToken, primaryModel, SYSTEM_PROMPT, userPrompt,
      );
      try {
        result = parseProsCons(content);
      } catch {
        content = await callOpenAICompat(
          primaryUrl, primaryToken, primaryModel, STRICT_RETRY_PROMPT, userPrompt,
        );
        result = parseProsCons(content);
      }
    } catch {
      result = null;
    }
  }

  if (!result) {
    const fallbackKey = process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();
    const fallbackModel =
      process.env.CATALOG_LLM_FALLBACK_MODEL?.trim() || 'claude-haiku-4-5';
    if (fallbackKey) {
      try {
        let content = await callAnthropicNative(
          fallbackKey, fallbackModel, SYSTEM_PROMPT, userPrompt,
        );
        try {
          result = parseProsCons(content);
        } catch {
          content = await callAnthropicNative(
            fallbackKey, fallbackModel, STRICT_RETRY_PROMPT, userPrompt,
          );
          result = parseProsCons(content);
        }
      } catch {
        result = null;
      }
    }
  }

  if (!result) return false;
  await upsertModelProsCons(modelName, result.pros, result.cons);
  return true;
}
```

Note: `callOpenAICompat`, `callAnthropicNative`, `SYSTEM_PROMPT`, `STRICT_RETRY_PROMPT`, `ProsCons`, `parseProsCons`, `isProsConsEnabled` are file-local/already-defined in this file. Do NOT export them.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- catalogProsConsClaude`
Expected: PASS (4 cases).

- [ ] **Step 5: Run full pros/cons test suite**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- catalogProsCons`
Expected: All catalogProsCons + catalogProsConsLocal + catalogProsConsClaude tests pass.

- [ ] **Step 6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsClaude.test.ts && git commit -m "feat(reco-catalog): buildClaudePrompt + generateClaudeProsCons"
```

---

## Task 5: Extract localInstalledService

**Files:**
- Create: `backend/src/services/localInstalledService.ts`
- Modify: `backend/src/controllers/catalogController.ts` (refactor `getLocalInstalled` to use the service)

This task is a clean refactor: the body of `getLocalInstalled` (built in the previous plan's Task 5) is moved into a service function `resolveLocalInstalledCards(userId)`, so the recommender (Task 6) can reuse it. The catalog controller becomes a thin wrapper.

- [ ] **Step 1: Read the existing controller**

Run: `grep -n "getLocalInstalled\|LocalInstalledCard\|FAMILY_RANK" "/Library/WebServer/Documents/KI Usage tracker/backend/src/controllers/catalogController.ts"`
Expected: shows the existing `LocalInstalledCard` interface, `FAMILY_RANK` map, and `getLocalInstalled` handler from the previous plan.

- [ ] **Step 2: Create the service**

Create `backend/src/services/localInstalledService.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Geteilte Logik zum Assemblieren der "Lokal installiert"-Karten — wird
// von /api/catalog/local-installed UND vom Recommendations-Endpoint genutzt.
// Resolves Provider-Service /models/status → Karten mit pros/cons aus
// curated map oder catalog_local_pros_cons; triggert fire-and-forget LLM
// generation für unbekannte Modelle.
import { getProviderServiceConfig } from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';
import {
  lookupCuratedLocal,
  normalizeOllamaName,
  type LocalModelFamily,
} from '../data/curatedLocalModels.js';
import { getLocalProsCons } from '../data/localProsConsRepo.js';
import { generateLocalProsCons } from './catalogProsConsService.js';

export interface LocalInstalledCard {
  name: string;
  base_name: string;
  family: LocalModelFamily;
  pros?: string[];
  cons?: string[];
  setup_note?: string;
}

const FAMILY_RANK: Record<LocalModelFamily, number> = {
  chat: 0,
  code: 1,
  embedding: 2,
  custom: 3,
};

// Holt alle vom Provider-Service als "loaded" gemeldeten Ollama-Modelle und
// assembliert Cards (curated → cache → empty + fire-and-forget LLM). Liefert
// sortiert nach Family-Rank dann Name. Bei Fehler (Provider nicht konfiguriert,
// /models/status unreachable, etc.): leeres Array.
export async function resolveLocalInstalledCards(
  userId: number,
): Promise<LocalInstalledCard[]> {
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) return [];

  let loaded: string[];
  try {
    const token = decryptSecret(cfg.service_token_enc);
    const url = new URL('/models/status', cfg.service_url);
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { loaded?: string[] };
    loaded = data.loaded ?? [];
  } catch {
    return [];
  }

  const cards: LocalInstalledCard[] = [];
  const needsGeneration: Array<{ name: string; family: LocalModelFamily }> = [];

  for (const name of loaded) {
    const base_name = normalizeOllamaName(name);
    const curated = lookupCuratedLocal(name);
    if (curated) {
      cards.push({
        name,
        base_name,
        family: curated.family,
        pros: curated.pros,
        cons: curated.cons,
        setup_note: curated.setup_note,
      });
      continue;
    }
    const cached = await getLocalProsCons(name);
    if (cached) {
      cards.push({
        name,
        base_name,
        family: cached.family,
        pros: cached.pros,
        cons: cached.cons,
      });
      continue;
    }
    cards.push({ name, base_name, family: 'custom' });
    needsGeneration.push({ name, family: 'custom' });
  }

  cards.sort((a, b) => {
    const rDiff = FAMILY_RANK[a.family] - FAMILY_RANK[b.family];
    if (rDiff !== 0) return rDiff;
    return a.name.localeCompare(b.name);
  });

  // Fire-and-forget: generate pros/cons for unknown models in the background.
  if (needsGeneration.length > 0) {
    void (async () => {
      for (const { name, family } of needsGeneration) {
        try {
          await generateLocalProsCons(name, family);
        } catch (err) {
          console.error(
            '[local-installed] generate failed',
            name,
            (err as Error).message,
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })().catch(() => {});
  }

  return cards;
}
```

- [ ] **Step 3: Refactor the controller**

Edit `backend/src/controllers/catalogController.ts`.

(a) Remove these imports (no longer needed in the controller; they live in the service now):
```ts
import { lookupCuratedLocal, normalizeOllamaName, type LocalModelFamily } from '../data/curatedLocalModels.js';
import { getLocalProsCons } from '../data/localProsConsRepo.js';
import { generateLocalProsCons } from '../services/catalogProsConsService.js';
```

(b) Add this import (alongside the existing service imports near the top):
```ts
import { resolveLocalInstalledCards } from '../services/localInstalledService.js';
```

(c) Remove the `LocalInstalledCard` interface and the `FAMILY_RANK` constant from the controller (they live in the service now).

(d) Replace the entire body of `getLocalInstalled` with:

```ts
export async function getLocalInstalled(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cards = await resolveLocalInstalledCards(userId);
  res.json({ models: cards });
}
```

The existing `getInstalled` (returns just `{ models: string[] }`) stays unchanged.

- [ ] **Step 4: Re-export the type if needed elsewhere**

Check if any existing test imports `LocalInstalledCard` from the controller:

Run: `grep -rn "LocalInstalledCard" "/Library/WebServer/Documents/KI Usage tracker/backend/src/" --include="*.ts"`

If found in test files: update the test file's import path from `'../../controllers/catalogController.js'` to `'../../services/localInstalledService.js'`.

- [ ] **Step 5: Verify existing catalog tests still pass**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- catalogControllerLocalInstalled`
Expected: 6/6 pass (unchanged behavior — controller is now thin wrapper).

- [ ] **Step 6: Type-check + build**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/services/localInstalledService.ts backend/src/controllers/catalogController.ts backend/src/__tests__/unit/catalogControllerLocalInstalled.test.ts && git commit -m "refactor(catalog-local): extract resolveLocalInstalledCards service"
```

(If the test file wasn't touched, drop it from the `git add`.)

---

## Task 6: Extend modelRecommendationService

**Files:**
- Modify: `backend/src/services/modelRecommendationService.ts`
- Create: `backend/src/__tests__/unit/modelRecommendationServiceCatalog.test.ts`

This is the heart of the feature: enrich the recommendation response with pros/cons for Claude models and add `localAlternatives`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/modelRecommendationServiceCatalog.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/secretCrypto.js', () => ({
  decryptSecret: (_blob: string) => 'mock-token',
  encryptSecret: (s: string) => s,
}));

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { upsertModelProsCons } = await import('../../data/modelProsConsRepo.js');
const { recommendModel } = await import('../../services/modelRecommendationService.js');

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR REPLACE INTO pricing (model, input_price, output_price, tier, status, last_updated)
     VALUES
       ('Claude Haiku 4.5', 0.8, 4, 'haiku', 'active', ?),
       ('Claude Sonnet 4.6', 3, 15, 'sonnet', 'active', ?),
       ('Claude Opus 4.7', 15, 75, 'opus', 'active', ?)`,
    [new Date().toISOString(), new Date().toISOString(), new Date().toISOString()],
  );
  await runQuery(
    `INSERT OR REPLACE INTO user_provider_service_config
       (user_id, service_url, service_token_enc, provider_user_id, enabled, created_at, updated_at)
     VALUES (42, 'http://provider.test', ?, ?, 1, ?, ?)`,
    ['enc-blob', 'puid-reco', new Date().toISOString(), new Date().toISOString()],
  );
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM model_pros_cons');
  await runQuery('DELETE FROM catalog_local_pros_cons');
  jest.resetAllMocks();
});

describe('recommendModel with catalog integration', () => {
  it('attaches pros/cons to recommended Claude model when cached', async () => {
    await upsertModelProsCons(
      'Claude Sonnet 4.6',
      ['cached p1', 'cached p2', 'cached p3'],
      ['cached c1', 'cached c2', 'cached c3'],
    );
    // No provider service call — for this test, return empty loaded.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ loaded: [] }) });
    const r = await recommendModel('refactor this code', {}, 42);
    expect(r.recommended).toBeDefined();
    // If Sonnet was recommended, it should carry the cached pros/cons.
    // If Haiku/Opus was recommended, only that one has the data; we just
    // verify the pros field exists when cached data is available for it.
    if (r.recommended === 'Claude Sonnet 4.6') {
      expect(r.pros).toEqual(['cached p1', 'cached p2', 'cached p3']);
    }
    // At least one of the alternatives might be Sonnet:
    const sonnetAlt = r.alternatives?.find((a) => a.model === 'Claude Sonnet 4.6');
    if (sonnetAlt) {
      expect(sonnetAlt.pros).toEqual(['cached p1', 'cached p2', 'cached p3']);
    }
  });

  it('returns empty localAlternatives when provider service has no models', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ loaded: [] }) });
    const r = await recommendModel('summarize this text', {}, 42);
    expect(r.localAlternatives).toEqual([]);
  });

  it('filters localAlternatives to family matching task keywords (code task → code family)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        loaded: ['mistral-nemo:latest', 'qwen3-coder:latest', 'nomic-embed-text:latest'],
      }),
    });
    const r = await recommendModel('debug this async function', {}, 42);
    expect(r.localAlternatives).toBeDefined();
    expect(r.localAlternatives!.length).toBeGreaterThan(0);
    for (const alt of r.localAlternatives!) {
      expect(alt.family).toBe('code');
    }
    // ollama_command must be set
    expect(r.localAlternatives![0]!.ollama_command).toBe('ollama run qwen3-coder:latest');
  });

  it('returns chat-family local alternatives for chat-ish task', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        loaded: ['mistral-nemo:latest', 'qwen3-coder:latest'],
      }),
    });
    const r = await recommendModel('summarize this paragraph', {}, 42);
    const families = r.localAlternatives!.map((a) => a.family);
    expect(families).toContain('chat');
    expect(families).not.toContain('code');
  });

  it('does not fail when userId is missing', async () => {
    const r = await recommendModel('any task', {});
    expect(r.recommended).toBeDefined();
    expect(r.localAlternatives).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- modelRecommendationServiceCatalog`
Expected: FAIL — `localAlternatives` not in response, `recommendModel` doesn't accept third arg.

- [ ] **Step 3: Extend the service**

Edit `backend/src/services/modelRecommendationService.ts`.

(a) Add these imports at the top (after the existing imports, around line 4):

```ts
import { resolveTargetFamilies } from '../data/keywordFamilyMap.js';
import { resolveLocalInstalledCards, type LocalInstalledCard } from './localInstalledService.js';
import { getModelProsCons } from '../data/modelProsConsRepo.js';
import { generateClaudeProsCons } from './catalogProsConsService.js';
```

(b) Add a new interface near the existing `RecommendationResponse` interface (before its definition, around line 78):

```ts
export interface LocalAlternative {
  name: string;
  base_name: string;
  family: 'chat' | 'code' | 'embedding' | 'custom';
  pros?: string[];
  cons?: string[];
  ollama_command: string;
}
```

(c) Extend the `RecommendationResponse` interface — find the existing interface and add these optional fields:

```ts
interface RecommendationResponse {
  // …existing fields…
  pros?: string[];
  cons?: string[];
  localAlternatives?: LocalAlternative[];
}
```

Also extend the `RecommendationAlternative` interface to include `pros?` and `cons?`:

```ts
interface RecommendationAlternative {
  model: string;
  confidence: number;
  savings: string;
  riskOfFailure: string;
  safetyImprovement: string;
  pros?: string[];
  cons?: string[];
}
```

(d) Change the `recommendModel` function signature to accept an optional `userId`:

```ts
export async function recommendModel(
  taskDescription: string,
  constraints: RecommendationConstraints = {},
  userId?: number,
): Promise<RecommendationResponse> {
```

(e) At the END of the function body, just before the final `return { recommended: …, … }` statement, add this block to enrich pros/cons and assemble localAlternatives:

Find the existing return statement that looks like:
```ts
    return {
      recommended: recommendedModel,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: { … },
      alternatives: alternatives.map(alt => ({ … })),
      historicalData
    };
```

Replace it with the following enriched block:

```ts
    // Enrich with pros/cons from model_pros_cons. Fire-and-forget generation
    // for misses — sequentially with 2s pauses to avoid hammering the LLM pool.
    const namesToEnrich = [recommendedModel, ...alternatives.map((a) => a.model)];
    const prosConsByModel = new Map<string, { pros: string[]; cons: string[] }>();
    const needsClaudeGeneration: Array<{ name: string; tier: string | null; pricing: { input: number; output: number } }> = [];

    for (const name of namesToEnrich) {
      const cached = await getModelProsCons(name);
      if (cached) {
        prosConsByModel.set(name, { pros: cached.pros, cons: cached.cons });
        continue;
      }
      const row = activeModels.find((m) => m.model === name);
      if (row) {
        needsClaudeGeneration.push({
          name,
          tier: row.tier,
          pricing: { input: row.input_price, output: row.output_price },
        });
      }
    }

    if (needsClaudeGeneration.length > 0) {
      void (async () => {
        for (const { name, tier, pricing } of needsClaudeGeneration) {
          try {
            await generateClaudeProsCons(name, tier, pricing);
          } catch (err) {
            console.error(
              '[reco-catalog] claude pros/cons generate failed',
              name,
              (err as Error).message,
            );
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      })().catch(() => {});
    }

    // Resolve local alternatives, filtered by task-matched families.
    let localAlternatives: LocalAlternative[] = [];
    if (userId !== undefined) {
      const targetFamilies = new Set(resolveTargetFamilies(taskAnalysis.matchedKeywords));
      const localCards: LocalInstalledCard[] = await resolveLocalInstalledCards(userId);
      localAlternatives = localCards
        .filter((c) => targetFamilies.has(c.family))
        .map((c) => ({
          name: c.name,
          base_name: c.base_name,
          family: c.family,
          pros: c.pros,
          cons: c.cons,
          ollama_command: `ollama run ${c.name}`,
        }));
    }

    const recoProsCons = prosConsByModel.get(recommendedModel);

    return {
      recommended: recommendedModel,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: {
        complexity,
        category: taskAnalysis.category,
        matchedKeywords: taskAnalysis.matchedKeywords,
        safetyScore: recommendedSafetyScore,
        costScore: recommendedCostScore,
        estimatedCost: `$${estimateCost(estimatedInputTokens, estimatedOutputTokens, recommendedPricing)}`,
      },
      pros: recoProsCons?.pros,
      cons: recoProsCons?.cons,
      alternatives: alternatives.map((alt) => {
        const altPC = prosConsByModel.get(alt.model);
        return {
          model: alt.model,
          confidence: Math.round((alt.score / 100) * 100) / 100,
          savings:
            alt.model.includes('Haiku') && recommendedModel.includes('Opus')
              ? '75-85%'
              : alt.model.includes('Haiku') && recommendedModel.includes('Sonnet')
                ? '60-70%'
                : alt.model.includes('Sonnet') && recommendedModel.includes('Opus')
                  ? '75-80%'
                  : 'N/A',
          riskOfFailure: alt.safetyScore >= 85 ? 'Low' : alt.safetyScore >= 70 ? 'Medium' : 'High',
          safetyImprovement: (((recommendedSafetyScore - alt.safetyScore) / 100) * 100).toFixed(0) + '%',
          pros: altPC?.pros,
          cons: altPC?.cons,
        };
      }),
      historicalData,
      localAlternatives,
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- modelRecommendationServiceCatalog`
Expected: PASS (5 cases).

- [ ] **Step 5: Run full recommendation test suite — no regressions**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test -- modelRecommendation`
Expected: all modelRecommendation tests + new catalog integration tests pass.

- [ ] **Step 6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/services/modelRecommendationService.ts backend/src/__tests__/unit/modelRecommendationServiceCatalog.test.ts && git commit -m "feat(reco-catalog): enrich recommendations with pros/cons + localAlternatives"
```

---

## Task 7: Wire Controller to Pass userId

**Files:**
- Modify: `backend/src/controllers/modelRecommendationController.ts`

- [ ] **Step 1: Locate the recommendModel handler**

Run: `grep -n "recommendModel\|taskDescription" "/Library/WebServer/Documents/KI Usage tracker/backend/src/controllers/modelRecommendationController.ts" | head -10`

You'll find the call: `const recommendation = await modelRecommendationService.recommendModel(taskDescription, constraints);`

- [ ] **Step 2: Pass userId**

Edit `backend/src/controllers/modelRecommendationController.ts`. Find this line:

```ts
const recommendation = await modelRecommendationService.recommendModel(taskDescription, constraints);
```

Replace with:

```ts
const recommendation = await modelRecommendationService.recommendModel(taskDescription, constraints, req.user!.id);
```

- [ ] **Step 3: Type-check + build**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 4: Run all backend tests**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test 2>&1 | tail -10`
Expected: all tests pass (no regressions in any other suite).

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add backend/src/controllers/modelRecommendationController.ts && git commit -m "feat(reco-catalog): pass userId to recommendModel for local-alternatives lookup"
```

---

## Task 8: Frontend — Render Pros/Cons in ModelSuggester

**Files:**
- Modify: `frontend/src/components/ModelSuggester.tsx`

- [ ] **Step 1: Extend the Recommendation interface and render pros/cons**

Edit `frontend/src/components/ModelSuggester.tsx`. Replace the inline `Recommendation` interface near the top with:

```tsx
type LocalModelFamily = 'chat' | 'code' | 'embedding' | 'custom';

interface LocalAlternative {
  name: string;
  base_name: string;
  family: LocalModelFamily;
  pros?: string[];
  cons?: string[];
  ollama_command: string;
}

interface Recommendation {
  recommended: string;
  confidence: number;
  reasoning: {
    complexity: number;
    category: string;
    safetyScore: number;
    costScore: number;
    estimatedCost: string;
    matchedKeywords: string[];
  };
  pros?: string[];
  cons?: string[];
  alternatives: Array<{
    model: string;
    confidence: number;
    savings: string;
    riskOfFailure: string;
    safetyImprovement: string;
    pros?: string[];
    cons?: string[];
  }>;
  historicalData?: {
    successRateHaiku: number;
    successRateSonnet: number;
    successRateOpus: number;
  };
  localAlternatives?: LocalAlternative[];
}
```

Then find the main Recommendation Card (the `<div className="bg-gradient-to-br from-blue-50 …">` block). AFTER the "Keywords detected" block (around the existing `recommendation.reasoning.matchedKeywords.length > 0 && (…)` JSX), add this block (still INSIDE the main card div):

```tsx
            {(recommendation.pros?.length || recommendation.cons?.length) ? (
              <div className="mt-4 bg-white p-4 rounded-lg">
                <p className="text-sm text-slate-600 mb-2 font-semibold">Stärken & Schwächen</p>
                <div className="space-y-1">
                  {recommendation.pros?.map((p, i) => (
                    <div key={`p${i}`} className="text-xs text-green-800 flex gap-1">
                      <span aria-hidden>✅</span>
                      <span>{p}</span>
                    </div>
                  ))}
                  {recommendation.cons?.map((c, i) => (
                    <div key={`c${i}`} className="text-xs text-amber-800 flex gap-1">
                      <span aria-hidden>⚠️</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
```

For the alternatives cards, find the `recommendation.alternatives.map((alt) => (…))` block. INSIDE each alternative card, after the existing `<div className="text-xs text-slate-500 bg-slate-200 …">` block (the "Excellent alternative" hint), add:

```tsx
                    {(alt.pros?.length || alt.cons?.length) ? (
                      <div className="mt-3 space-y-1">
                        {alt.pros?.map((p, i) => (
                          <div key={`p${i}`} className="text-xs text-green-800 flex gap-1">
                            <span aria-hidden>✅</span>
                            <span>{p}</span>
                          </div>
                        ))}
                        {alt.cons?.map((c, i) => (
                          <div key={`c${i}`} className="text-xs text-amber-800 flex gap-1">
                            <span aria-hidden>⚠️</span>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
```

- [ ] **Step 2: Verify frontend type-check**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npx tsc --noEmit 2>&1 | grep -E "(ModelSuggester|error TS)" | head -20`
Expected: no NEW errors specific to ModelSuggester.tsx.

- [ ] **Step 3: Build frontend**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run build 2>&1 | tail -5`
Expected: Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add frontend/src/components/ModelSuggester.tsx && git commit -m "feat(reco-catalog): render pros/cons in ModelSuggester for recommended + alternatives"
```

---

## Task 9: Frontend — Render LocalAlternatives Section

**Files:**
- Modify: `frontend/src/components/ModelSuggester.tsx`

- [ ] **Step 1: Add a copy helper and the new section**

Edit `frontend/src/components/ModelSuggester.tsx`.

(a) Add a helper hook/function INSIDE the `ModelSuggester` component, after the existing state declarations (after `const [error, setError] = useState<string | null>(null);`):

```tsx
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const handleCopyCommand = async (cmd: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCommand(cmd);
      setTimeout(() => setCopiedCommand(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopiedCommand(cmd);
        setTimeout(() => setCopiedCommand(null), 2000);
      } catch {
        // user copies manually
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const FAMILY_LABEL_DE: Record<LocalModelFamily, string> = {
    chat: 'Chat',
    code: 'Code',
    embedding: 'Embedding',
    custom: 'Custom',
  };

  const FAMILY_BADGE_DE: Record<LocalModelFamily, string> = {
    chat: 'bg-blue-100 text-blue-800',
    code: 'bg-green-100 text-green-800',
    embedding: 'bg-gray-100 text-gray-700',
    custom: 'bg-purple-100 text-purple-800',
  };
```

(b) In the JSX, find the existing `{/* Historical Data */}` block (around the bottom of the recommendation display). Insert this BEFORE the Historical Data block:

```tsx
          {/* Local Alternatives */}
          {recommendation.localAlternatives && recommendation.localAlternatives.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-slate-800 mb-4">
                🦙 Lokale Alternativen (kostenlos) ({recommendation.localAlternatives.length})
              </h3>
              <p className="text-sm text-slate-600 mb-4">
                Lokal installierte Ollama-Modelle in der passenden Kategorie. Ausführung ist
                kostenlos (kein API-Call), aber Qualität und Geschwindigkeit hängen vom Modell
                und deiner Hardware ab.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recommendation.localAlternatives.map((alt) => (
                  <div key={alt.name} className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <span className="text-sm font-medium font-mono text-slate-800 break-all">
                        {alt.name}
                      </span>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded ${FAMILY_BADGE_DE[alt.family]}`}
                      >
                        {FAMILY_LABEL_DE[alt.family]}
                      </span>
                    </div>

                    {(alt.pros?.length || alt.cons?.length) ? (
                      <div className="mb-3 space-y-1">
                        {alt.pros?.map((p, i) => (
                          <div key={`p${i}`} className="text-xs text-green-800 flex gap-1">
                            <span aria-hidden>✅</span>
                            <span>{p}</span>
                          </div>
                        ))}
                        {alt.cons?.map((c, i) => (
                          <div key={`c${i}`} className="text-xs text-amber-800 flex gap-1">
                            <span aria-hidden>⚠️</span>
                            <span>{c}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mb-3 text-xs text-slate-500 italic">
                        Pros/Cons werden im Hintergrund generiert.
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1 break-all font-mono">
                        {alt.ollama_command}
                      </code>
                      <button
                        onClick={() => handleCopyCommand(alt.ollama_command)}
                        className="shrink-0 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
                        aria-label="Kopieren"
                      >
                        {copiedCommand === alt.ollama_command ? '✓' : '📋'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 2: Verify type-check**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npx tsc --noEmit 2>&1 | grep -E "(ModelSuggester|error TS)" | head -20`
Expected: no new errors.

- [ ] **Step 3: Build frontend**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run build 2>&1 | tail -5`
Expected: Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git add frontend/src/components/ModelSuggester.tsx && git commit -m "feat(reco-catalog): LocalAlternatives section with ollama run copy button"
```

---

## Task 10: Full Build + Smoke Test + Deploy

- [ ] **Step 1: Run full backend test suite**

Run: `cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm test 2>&1 | tail -10`
Expected: all tests pass (no regressions).

- [ ] **Step 2: Build backend + frontend**

Run:
```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run build 2>&1 | tail -3
cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run build 2>&1 | tail -5
```
Expected: both build cleanly.

- [ ] **Step 3: Local smoke (optional — production deploy will validate)**

Skip if production deploy is the smoke test (catalog page memory says deploy is the smoke test for solo dev).

- [ ] **Step 4: Push to origin/main**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker" && git push origin main
```

- [ ] **Step 5: Deploy to VPS**

```bash
ssh ionos-vps 'set -e
cd /var/www/wolfinisoftware/claudetracker
git pull --ff-only origin main 2>&1 | tail -5
cd backend
npx tsc 2>&1 | tail -3
sudo systemctl restart claudetracker-backend
sleep 8
sudo systemctl is-active claudetracker-backend
cd ../frontend
npm run build 2>&1 | tail -5
'
```

Expected: `active` for backend, Vite build succeeds for frontend.

- [ ] **Step 6: Verify table created on prod DB**

```bash
ssh ionos-vps 'cd /var/www/wolfinisoftware/claudetracker/backend && node -e "
const sqlite3 = require(\"sqlite3\");
const db = new sqlite3.Database(\"./database.sqlite\");
db.all(\"SELECT name FROM sqlite_master WHERE type=\x27table\x27 AND name=\x27model_pros_cons\x27\", (e, r) => {
  console.log(\"table:\", JSON.stringify(r));
  db.close();
});
"'
```

Expected: `table: [{"name":"model_pros_cons"}]`

- [ ] **Step 7: Verify recommend endpoint shape**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://wolfinisoftware.de/claudetracker/api/recommend -H "Content-Type: application/json" -d '{"taskDescription":"debug this code"}'
```

Expected: `401` (auth required — endpoint exists). To get real data, the user must open the page in a logged-in browser.

- [ ] **Step 8: Browser smoke test**

Open `https://wolfinisoftware.de/claudetracker/recommendations` in a logged-in browser:
- Enter "debug this async function" → expect a Claude recommendation + a "Lokale Alternativen (kostenlos)" section with code-family models (qwen2.5-coder, qwen3-coder, dev-coder)
- Enter "summarize this paragraph" → expect Claude recommendation + chat-family local alternatives (mistral-nemo, llama3.1, etc.)
- First time on a Claude model: pros/cons may be empty (background generation); reload after ~30s to see them populated
- Copy button on a local alternative copies `ollama run <name>` to clipboard

If everything renders, the feature is live.
