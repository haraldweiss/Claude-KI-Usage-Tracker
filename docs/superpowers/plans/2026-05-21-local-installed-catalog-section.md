# Local Installed Catalog Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Lokal installiert" section to the catalog page listing all Ollama-installed models with 3 pros + 3 cons each, sourced via hybrid curated map → SQLite cache → LLM fallback.

**Architecture:** New backend endpoint `GET /api/catalog/local-installed` fetches model list from the existing provider-service `/models/status`, then resolves pros/cons per-model via three-stage lookup (curated map → `catalog_local_pros_cons` table → fire-and-forget LLM via existing `catalogProsConsService`). New frontend section renders these above HF-curated sections, hidden when search is active.

**Tech Stack:** Node.js, Express, TypeScript ESM, sqlite3, Jest, React, Vite, TailwindCSS

**Spec:** [docs/superpowers/specs/2026-05-21-local-installed-catalog-section-design.md](../specs/2026-05-21-local-installed-catalog-section-design.md)

---

## File Structure

**Backend (new):**
- `backend/src/data/curatedLocalModels.ts` — static map + `normalizeOllamaName()`
- `backend/src/data/localProsConsRepo.ts` — CRUD for `catalog_local_pros_cons`
- `backend/src/__tests__/unit/curatedLocalModels.test.ts`
- `backend/src/__tests__/unit/localProsConsRepo.test.ts`
- `backend/src/__tests__/unit/catalogControllerLocalInstalled.test.ts`

**Backend (modify):**
- `backend/src/database/sqlite.ts` — add table create in `initDatabase()` (next-to `catalog_hf_cache`)
- `backend/src/services/catalogProsConsService.ts` — add `buildLocalPrompt()` + `generateLocalProsCons()`
- `backend/src/controllers/catalogController.ts` — add `getLocalInstalled` handler
- `backend/src/routes/catalog.ts` — register route

**Frontend (new):**
- `frontend/src/components/LocalModelCard.tsx`
- `frontend/src/components/LocalInstalledSection.tsx`

**Frontend (modify):**
- `frontend/src/services/catalogApi.ts` — add types + `getLocalInstalled()`
- `frontend/src/pages/CatalogPage.tsx` — render new section

---

## Task 1: Normalize Ollama Name + Curated Map (Data Layer)

**Files:**
- Create: `backend/src/data/curatedLocalModels.ts`
- Create: `backend/src/__tests__/unit/curatedLocalModels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/curatedLocalModels.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';
import {
  normalizeOllamaName,
  CURATED_LOCAL_MODELS,
  lookupCuratedLocal,
} from '../../data/curatedLocalModels.js';

describe('normalizeOllamaName', () => {
  it.each([
    ['mistral-nemo:latest', 'mistral-nemo'],
    ['mistral-nemo:12b-instruct-2407-q5_K_M', 'mistral-nemo'],
    ['mistral-nemo-cc:latest', 'mistral-nemo'],
    ['deepseek-r1:8b', 'deepseek-r1'],
    ['llama3.1:8b-instruct-q5_K_M', 'llama3.1'],
    ['nomic-embed-text:latest', 'nomic-embed-text'],
    ['qwen3-coder:latest', 'qwen3-coder'],
    ['qwen3-coder-cc:latest', 'qwen3-coder'],
    ['anubclaw/dev-coder:q5', 'dev-coder'],
    ['hf.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M', 'qwen2.5-coder'],
    ['hf.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2:Q4_K_M', 'supergemma'],
    ['hf.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M', 'llama3.1'],
    ['soc-analyst:latest', 'soc-analyst'],
    ['qwen3.6:latest', 'qwen3.6'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeOllamaName(input)).toBe(expected);
  });
});

describe('CURATED_LOCAL_MODELS', () => {
  it('every entry has exactly 3 pros and 3 cons', () => {
    for (const [name, entry] of Object.entries(CURATED_LOCAL_MODELS)) {
      expect(entry.pros).toHaveLength(3);
      expect(entry.cons).toHaveLength(3);
      expect(['chat', 'code', 'embedding', 'custom']).toContain(entry.family);
      for (const p of [...entry.pros, ...entry.cons]) {
        expect(p.length).toBeLessThanOrEqual(80);
        expect(p.length).toBeGreaterThan(5);
      }
    }
    expect(Object.keys(CURATED_LOCAL_MODELS)).toContain('mistral-nemo');
    expect(Object.keys(CURATED_LOCAL_MODELS)).toContain('deepseek-r1');
    expect(Object.keys(CURATED_LOCAL_MODELS)).toContain('nomic-embed-text');
  });
});

describe('lookupCuratedLocal', () => {
  it('returns entry for known name', () => {
    expect(lookupCuratedLocal('mistral-nemo:latest')).toMatchObject({ family: 'chat' });
  });
  it('returns entry for HF-prefixed name', () => {
    expect(
      lookupCuratedLocal('hf.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M'),
    ).toMatchObject({ family: 'code' });
  });
  it('returns null for unknown', () => {
    expect(lookupCuratedLocal('some-random-custom-model:latest')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- curatedLocalModels`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write implementation**

Create `backend/src/data/curatedLocalModels.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Statische Pros/Cons-Lookup für lokal installierte Ollama-Modelle.
// Fallback wenn nicht im Cache + nicht curated: catalogProsConsService LLM-Pfad.

export type LocalModelFamily = 'chat' | 'code' | 'embedding' | 'custom';

export interface CuratedLocalEntry {
  family: LocalModelFamily;
  pros: string[];
  cons: string[];
  setup_note?: string;
}

// Reihenfolge im Objekt = Fallback-Reihenfolge bei Prefix-Match.
// Längere Keys ZUERST eintragen, damit 'qwen2.5-coder' vor 'qwen' trifft.
export const CURATED_LOCAL_MODELS: Record<string, CuratedLocalEntry> = {
  'deepseek-r1': {
    family: 'chat',
    pros: [
      'Starkes Reasoning-Modell mit Chain-of-Thought',
      'Vergleichbar mit GPT-4 bei Mathe- und Logikaufgaben',
      'Komplett offline lauffähig, keine API-Kosten',
    ],
    cons: [
      'Antworten enthalten oft sichtbares "thinking"-Markup',
      '8B-Variante deutlich schwächer als 70B/671B',
      'Langsamer als nicht-Reasoning-Modelle bei Trivial-Tasks',
    ],
  },
  'qwen2.5-coder': {
    family: 'code',
    pros: [
      'Beste Open-Source-Coder-Familie 2025, viele Sprachen',
      '32B-Variante schlägt GPT-4o bei vielen Code-Benchmarks',
      'FIM (Fill-In-Middle) für IDE-Integration optimiert',
    ],
    cons: [
      '32B braucht ≥24 GB RAM/VRAM für sinnvolle Tokens/s',
      'Deutsche Kommentare/Docstrings teilweise unsauber',
      'Schwächer bei sehr neuen Frameworks (Knowledge-Cutoff)',
    ],
  },
  'qwen3-coder': {
    family: 'code',
    pros: [
      'Nachfolger von Qwen2.5-Coder mit besseren Tool-Calls',
      'Native Function-Calling-Unterstützung',
      'Sehr gut bei Multi-File-Refactoring und Diffs',
    ],
    cons: [
      'Größerer Speicherbedarf als Qwen2.5-Coder',
      'Tool-Format weicht teils von Claude/OpenAI ab',
      'Manchmal über-eifrig beim Aufrufen nicht-existenter Tools',
    ],
  },
  'mistral-nemo': {
    family: 'chat',
    pros: [
      '12B-Modell mit 128k Kontext-Fenster',
      'Sehr gutes Deutsch und Französisch',
      'Apache-2.0-Lizenz, kommerziell frei nutzbar',
    ],
    cons: [
      'Code-Generierung schwächer als spezialisierte Coder',
      'Halluziniert bei sehr langen Kontexten (>80k)',
      'Keine native Tool-Use-Optimierung',
    ],
  },
  'llama3.1': {
    family: 'chat',
    pros: [
      'Meta-Llama mit 128k Kontext, sehr breit getestet',
      'Sehr gute Allzweck-Qualität bei 8B Größe',
      'Hervorragende Tool-Calling-Unterstützung',
    ],
    cons: [
      'Custom-Lizenz, nicht 100% Open Source',
      'Deutsche Antworten oft hölzern oder mit Anglizismen',
      'Bei 8B Faktualität schwächer als bei 70B',
    ],
  },
  'llama3': {
    family: 'chat',
    pros: [
      'Vorgänger von Llama-3.1, ausgereift und stabil',
      'Sehr verbreitet — viele Forks und Tools verfügbar',
      'Schnell auf Consumer-Hardware bei 8B',
    ],
    cons: [
      'Nur 8k Kontext (vs. 128k bei Llama-3.1)',
      'Veraltet — 3.1 ist in fast jeder Hinsicht besser',
      'Schwächer bei strukturiertem Output (JSON)',
    ],
  },
  'nomic-embed-text': {
    family: 'embedding',
    pros: [
      'Schnelles 137M-Embedding-Modell für RAG',
      'Bessere Qualität als OpenAI text-embedding-ada-002',
      'Apache-2.0, klein genug für CPU-Inferenz',
    ],
    cons: [
      'Kein Chat — nur für Vektor-Embeddings nutzbar',
      'Nur englisch-optimiert, Deutsch schwächer',
      '768-Dim-Output zu groß für sehr große Datasets',
    ],
    setup_note: 'Nutzung: ollama embeddings nomic-embed-text "text…"',
  },
  'supergemma': {
    family: 'chat',
    pros: [
      'Gemma-Variante ohne Refusal-Training',
      'Sehr direkt bei Sicherheits- und Pen-Test-Themen',
      'Solide deutsche Sprachqualität',
    ],
    cons: [
      'Uncensored — Output muss vor Weiterleitung gefiltert werden',
      '26B braucht ≥16 GB RAM/VRAM',
      'Schwächer bei Code-Generierung als Qwen-Coder',
    ],
  },
  'gemma': {
    family: 'chat',
    pros: [
      'Googles offene Modell-Familie, hohe Faktualität',
      'Mehrsprachig stark, gut für RAG-Pipelines',
      'Kleine Varianten (2B) für Edge-Hardware',
    ],
    cons: [
      'Strikte Safety-Filter, viele Refusals',
      'Custom Gemma-Lizenz, nicht klassisches OSI-OS',
      'Schwächer bei mathematischem Reasoning',
    ],
  },
  'dev-coder': {
    family: 'code',
    pros: [
      'Custom-Build für lokale Dev-Workflows',
      'Auf eigene Codebase fine-getuned',
      'Schneller als generische Coder bei vertrauten Tasks',
    ],
    cons: [
      'Nicht öffentlich dokumentiert — nur lokal nutzbar',
      'Stagniert wenn nicht regelmäßig neu trainiert',
      'Keine externe Qualitäts-Benchmarks verfügbar',
    ],
  },
  'soc-analyst': {
    family: 'custom',
    pros: [
      'Spezialisiert auf Security-Operations-Analyse',
      'Versteht SIEM-Logs und Alert-Triage-Kontext',
      'Strukturierte Incident-Berichte als Output',
    ],
    cons: [
      'Custom-Build, keine externe Qualitätssicherung',
      'Nicht für allgemeine Chat-Aufgaben geeignet',
      'Trainingsdaten und Lizenz proprietär',
    ],
  },
  'soc-detect': {
    family: 'custom',
    pros: [
      'Auf Threat-Detection und IOC-Analyse trainiert',
      'Erkennt MITRE-ATT&CK-Patterns in Log-Snippets',
      'Komplett lokal — keine Daten verlassen das System',
    ],
    cons: [
      'Custom-Build ohne öffentliche Benchmarks',
      'False-Positives bei ungewöhnlichen Log-Formaten',
      'Wissen veraltet — neue CVEs nicht im Training',
    ],
  },
};

// Reihenfolge der Lookup-Keys: längster Match zuerst, damit
// 'qwen2.5-coder' nicht fälschlich auf 'qwen' verkürzt wird.
const SORTED_KEYS = Object.keys(CURATED_LOCAL_MODELS).sort(
  (a, b) => b.length - a.length,
);

// Wandelt einen Ollama-Modellnamen in den Lookup-Key der curated Map um.
// Schritte: hf.co-Prefix strippen, ":tag"-Suffix entfernen, "-cc"/"-gguf"/
// "-uncensored"-Suffixe entfernen, Versions-Suffixe wie "4-26b" trimmen,
// lowercase. Liefert den Basis-Familiennamen.
export function normalizeOllamaName(name: string): string {
  let s = name.trim().toLowerCase();

  // Strip hf.co/<owner>/ prefix
  s = s.replace(/^hf\.co\/[^/]+\//, '');
  // Strip <owner>/ prefix (e.g. anubclaw/dev-coder)
  if (s.includes('/')) {
    s = s.substring(s.indexOf('/') + 1);
  }
  // Strip :tag suffix
  s = s.replace(/:.*$/, '');
  // Strip common suffixes
  s = s
    .replace(/-gguf-v\d+$/, '')
    .replace(/-gguf$/, '')
    .replace(/-uncensored$/, '')
    .replace(/-instruct$/, '')
    .replace(/-cc$/, '');
  // Meta-llama-3.1-8b → llama3.1   (strip "meta-" prefix and "-Nb" size)
  s = s.replace(/^meta-/, '');
  s = s.replace(/-(\d+(\.\d+)?)b(-.*)?$/, '');
  // "llama-3.1" → "llama3.1"
  s = s.replace(/^llama-(\d)/, 'llama$1');
  // "supergemma4-26b" → matched above; remaining "supergemma4" → "supergemma"
  s = s.replace(/^supergemma\d+$/, 'supergemma');

  // Try exact match against sorted keys (longest first).
  // This handles partial prefixes like "qwen2.5-coder-32b" → "qwen2.5-coder".
  for (const key of SORTED_KEYS) {
    if (s === key || s.startsWith(key + '-') || s.startsWith(key + '.')) {
      return key;
    }
  }
  return s;
}

export function lookupCuratedLocal(name: string): CuratedLocalEntry | null {
  const key = normalizeOllamaName(name);
  return CURATED_LOCAL_MODELS[key] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- curatedLocalModels`
Expected: PASS (all `normalizeOllamaName` cases + curated entries valid + lookup cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/data/curatedLocalModels.ts backend/src/__tests__/unit/curatedLocalModels.test.ts
git commit -m "feat(catalog-local): curated pros/cons map + normalizeOllamaName"
```

---

## Task 2: SQLite Table for Local Pros/Cons Cache

**Files:**
- Modify: `backend/src/database/sqlite.ts` (insert after `catalog_latest_uploads` block around line 470)

- [ ] **Step 1: Read current sqlite.ts table-creation block**

Run: `grep -n "catalog_latest_uploads" backend/src/database/sqlite.ts`
Expected: shows the table-create block ending around line 470.

- [ ] **Step 2: Add the new table creation**

Edit `backend/src/database/sqlite.ts`. Find the `catalog_latest_uploads` block ending with the `await new Promise<void>(...)` and `resolve()` call. Insert BEFORE the `resolve()`:

```ts
          // 2026-05-21: Local Ollama models pros/cons cache. Populated lazily
          // by getLocalInstalled() controller when a model is neither curated
          // nor already cached. Key is the exact Ollama model name (e.g.
          // "mistral-nemo-cc:latest"), so customer-specific tags persist
          // even when normalize() would collapse them.
          await new Promise<void>((res, rej) => {
            database.run(
              `CREATE TABLE IF NOT EXISTS catalog_local_pros_cons (
                model_name   TEXT PRIMARY KEY,
                pros         TEXT NOT NULL,
                cons         TEXT NOT NULL,
                family       TEXT NOT NULL,
                generated_at TEXT NOT NULL
              )`,
              (tErr: Error | null) => (tErr ? rej(tErr) : res())
            );
          });
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 4: Verify table is created (smoke test via init)**

Run: `cd backend && cat > /tmp/test-migration.mjs <<'EOF'
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, allQuery } = await import('./dist/database/sqlite.js');
await initDatabase();
const r = await allQuery("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_local_pros_cons'");
console.log(JSON.stringify(r));
process.exit(0);
EOF
npm run build && node /tmp/test-migration.mjs`

Expected: `[{"name":"catalog_local_pros_cons"}]`

- [ ] **Step 5: Commit**

```bash
git add backend/src/database/sqlite.ts
git commit -m "feat(catalog-local): catalog_local_pros_cons table"
```

---

## Task 3: localProsConsRepo

**Files:**
- Create: `backend/src/data/localProsConsRepo.ts`
- Create: `backend/src/__tests__/unit/localProsConsRepo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/localProsConsRepo.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  getLocalProsCons,
  upsertLocalProsCons,
} = await import('../../data/localProsConsRepo.js');

beforeAll(async () => {
  await initDatabase();
});

beforeEach(async () => {
  await runQuery('DELETE FROM catalog_local_pros_cons');
});

describe('localProsConsRepo', () => {
  it('returns null for missing model', async () => {
    expect(await getLocalProsCons('nope:latest')).toBeNull();
  });

  it('round-trips a row', async () => {
    await upsertLocalProsCons('foo:latest', ['p1', 'p2', 'p3'], ['c1', 'c2', 'c3'], 'chat');
    const row = await getLocalProsCons('foo:latest');
    expect(row).not.toBeNull();
    expect(row!.pros).toEqual(['p1', 'p2', 'p3']);
    expect(row!.cons).toEqual(['c1', 'c2', 'c3']);
    expect(row!.family).toBe('chat');
    expect(row!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('upsert replaces existing row', async () => {
    await upsertLocalProsCons('foo:latest', ['a', 'b', 'c'], ['x', 'y', 'z'], 'chat');
    await upsertLocalProsCons('foo:latest', ['d', 'e', 'f'], ['u', 'v', 'w'], 'code');
    const row = await getLocalProsCons('foo:latest');
    expect(row!.pros).toEqual(['d', 'e', 'f']);
    expect(row!.family).toBe('code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- localProsConsRepo`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write implementation**

Create `backend/src/data/localProsConsRepo.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// CRUD für catalog_local_pros_cons. Gespeichert wird per exakt-Match auf
// den Ollama-Modellnamen (z.B. "mistral-nemo-cc:latest"), nicht auf den
// normalisierten Basis-Namen — so können verschiedene Tags/Custom-Builds
// unterschiedliche Pros/Cons haben falls vom LLM differenziert generiert.
import { runQuery, getQuery } from '../database/sqlite.js';
import type { LocalModelFamily } from './curatedLocalModels.js';

export interface LocalProsConsRow {
  model_name: string;
  pros: string[];
  cons: string[];
  family: LocalModelFamily;
  generated_at: string;
}

interface RawRow {
  model_name: string;
  pros: string;
  cons: string;
  family: string;
  generated_at: string;
}

export async function getLocalProsCons(
  modelName: string,
): Promise<LocalProsConsRow | null> {
  const row = await getQuery<RawRow>(
    'SELECT * FROM catalog_local_pros_cons WHERE model_name = ?',
    [modelName],
  );
  if (!row) return null;
  return {
    model_name: row.model_name,
    pros: JSON.parse(row.pros) as string[],
    cons: JSON.parse(row.cons) as string[],
    family: row.family as LocalModelFamily,
    generated_at: row.generated_at,
  };
}

export async function upsertLocalProsCons(
  modelName: string,
  pros: string[],
  cons: string[],
  family: LocalModelFamily,
): Promise<void> {
  await runQuery(
    `INSERT INTO catalog_local_pros_cons (model_name, pros, cons, family, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(model_name) DO UPDATE SET
       pros = excluded.pros,
       cons = excluded.cons,
       family = excluded.family,
       generated_at = excluded.generated_at`,
    [
      modelName,
      JSON.stringify(pros),
      JSON.stringify(cons),
      family,
      new Date().toISOString(),
    ],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- localProsConsRepo`
Expected: PASS (3 test cases).

- [ ] **Step 5: Commit**

```bash
git add backend/src/data/localProsConsRepo.ts backend/src/__tests__/unit/localProsConsRepo.test.ts
git commit -m "feat(catalog-local): localProsConsRepo CRUD"
```

---

## Task 4: LLM-Fallback for Local Models (extend catalogProsConsService)

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts` (add new exported functions at end)
- Create: `backend/src/__tests__/unit/catalogProsConsLocal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/catalogProsConsLocal.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { buildLocalPrompt, generateLocalProsCons } = await import(
  '../../services/catalogProsConsService.js'
);
const { getLocalProsCons } = await import('../../data/localProsConsRepo.js');

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
  await runQuery('DELETE FROM catalog_local_pros_cons');
  jest.resetAllMocks();
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
  delete process.env.CATALOG_LLM_MODEL;
});

describe('buildLocalPrompt', () => {
  it('includes model name and family hint', () => {
    const p = buildLocalPrompt('mystery-coder:latest', 'code');
    expect(p).toContain('mystery-coder:latest');
    expect(p).toContain('code');
    expect(p).toMatch(/JSON/);
  });
});

describe('generateLocalProsCons', () => {
  it('generates and caches pros/cons via primary LLM', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pros: ['Pro 1', 'Pro 2', 'Pro 3'],
                cons: ['Con 1', 'Con 2', 'Con 3'],
              }),
            },
          },
        ],
      }),
    });
    const ok = await generateLocalProsCons('mystery:latest', 'custom');
    expect(ok).toBe(true);
    const cached = await getLocalProsCons('mystery:latest');
    expect(cached!.pros).toEqual(['Pro 1', 'Pro 2', 'Pro 3']);
    expect(cached!.family).toBe('custom');
  });

  it('returns false when LLM unavailable', async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    const ok = await generateLocalProsCons('mystery:latest', 'custom');
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- catalogProsConsLocal`
Expected: FAIL — `buildLocalPrompt` / `generateLocalProsCons` not exported.

- [ ] **Step 3: Extend the service**

Edit `backend/src/services/catalogProsConsService.ts`. Add these imports at the top (after the existing imports):

```ts
import type { LocalModelFamily } from '../data/curatedLocalModels.js';
import { upsertLocalProsCons } from '../data/localProsConsRepo.js';
```

Then append at the end of the file:

```ts
// Prompt-Template für lokale Ollama-Modelle, die NICHT aus HuggingFace kommen
// (z.B. Custom-Builds wie "mistral-nemo-cc"). Anders als buildPrompt() für
// HF-Cards kennen wir hier nur Name + Family-Hint, keine HF-Description.
export function buildLocalPrompt(modelName: string, family: LocalModelFamily): string {
  return [
    `Modell-Name (Ollama): ${modelName}`,
    `Kategorie: ${family}`,
    '',
    'Schreibe 3 Pros und 3 Cons, jeweils einen kurzen Satz (max. 80 Zeichen),',
    'konkret und praxisnah für deutschsprachige Entwickler:innen:',
    '- Pros: Anwendungsfälle, Stärken, was das Modell gut macht',
    '- Cons: Schwächen, Limitierungen, wofür es ungeeignet ist',
    '',
    'Wenn der Modell-Name auf eine bekannte Familie hinweist (z.B. "mistral-nemo-cc"',
    'als Custom-Variante von Mistral Nemo), nutze dein Wissen über die Familie.',
    '',
    'Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach:',
    '{"pros": ["...", "...", "..."], "cons": ["...", "...", "..."]}',
  ].join('\n');
}

// Generiert Pros/Cons für ein lokales Ollama-Modell via Primary-LLM (oder
// Fallback). Cached das Ergebnis in catalog_local_pros_cons. Failure ist
// nicht fatal — der nächste Page-Load triggert einen Retry. Returns true
// bei Erfolg, false bei Skip/Failure.
export async function generateLocalProsCons(
  modelName: string,
  family: LocalModelFamily,
): Promise<boolean> {
  if (!isProsConsEnabled()) return false;

  const userPrompt = buildLocalPrompt(modelName, family);
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
  await upsertLocalProsCons(modelName, result.pros, result.cons, family);
  return true;
}
```

Note: `callOpenAICompat`, `callAnthropicNative`, `SYSTEM_PROMPT`, `STRICT_RETRY_PROMPT`, `ProsCons`, `parseProsCons`, `isProsConsEnabled` already exist in this file. If `callOpenAICompat` / `callAnthropicNative` / `SYSTEM_PROMPT` / `STRICT_RETRY_PROMPT` are not exported yet, do NOT export them publicly — they're file-internal. Just use them since you're adding to the same file.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- catalogProsConsLocal`
Expected: PASS (3 test cases).

- [ ] **Step 5: Run full backend test suite to confirm no regressions**

Run: `cd backend && npm test -- catalogProsCons`
Expected: All catalogProsCons + catalogProsConsLocal tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsLocal.test.ts
git commit -m "feat(catalog-local): buildLocalPrompt + generateLocalProsCons"
```

---

## Task 5: Backend Controller getLocalInstalled

**Files:**
- Modify: `backend/src/controllers/catalogController.ts` (add new exported function)
- Modify: `backend/src/routes/catalog.ts` (register route)
- Create: `backend/src/__tests__/unit/catalogControllerLocalInstalled.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/catalogControllerLocalInstalled.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import type { Request, Response } from 'express';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { upsertLocalProsCons } = await import('../../data/localProsConsRepo.js');
const { getLocalInstalled } = await import('../../controllers/catalogController.js');

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
  // Seed a provider service config for user_id=1
  await runQuery(
    `INSERT OR REPLACE INTO user_provider_service_config
       (user_id, service_url, service_token_enc, enabled, created_at, updated_at)
     VALUES (1, 'http://provider.test', ?, 1, ?, ?)`,
    [
      // Use the same encryption helper the prod code uses, OR seed with
      // a pre-encrypted blob. For unit tests we mock decryptSecret instead.
      'enc-blob',
      new Date().toISOString(),
      new Date().toISOString(),
    ],
  );
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_local_pros_cons');
  jest.resetAllMocks();
});

function fakeReq(): Request {
  return { user: { id: 1 } } as unknown as Request;
}
function fakeRes(): { res: Response; jsonBody: unknown; status: number } {
  const ref: { res: Response; jsonBody: unknown; status: number } = {
    res: undefined as unknown as Response,
    jsonBody: undefined,
    status: 200,
  };
  ref.res = {
    status(code: number) { ref.status = code; return ref.res; },
    json(body: unknown) { ref.jsonBody = body; return ref.res; },
  } as unknown as Response;
  return ref;
}

describe('getLocalInstalled', () => {
  it('returns curated entry for known model name', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded: ['mistral-nemo:latest'] }),
    });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ name: string; family: string; pros: string[] }> };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]!.name).toBe('mistral-nemo:latest');
    expect(body.models[0]!.family).toBe('chat');
    expect(body.models[0]!.pros.length).toBe(3);
  });

  it('returns cached entry when curated misses but cache hits', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded: ['custom-unknown:latest'] }),
    });
    await upsertLocalProsCons(
      'custom-unknown:latest',
      ['cached p1', 'cached p2', 'cached p3'],
      ['cached c1', 'cached c2', 'cached c3'],
      'custom',
    );
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ name: string; pros: string[] }> };
    expect(body.models[0]!.pros[0]).toBe('cached p1');
  });

  it('returns card without pros/cons when both miss', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded: ['totally-new:latest'] }),
    });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ name: string; pros?: string[] }> };
    expect(body.models[0]!.name).toBe('totally-new:latest');
    expect(body.models[0]!.pros).toBeUndefined();
  });

  it('sorts by family: chat < code < embedding < custom', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        loaded: ['nomic-embed-text:latest', 'qwen3-coder:latest', 'mistral-nemo:latest', 'soc-analyst:latest'],
      }),
    });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    const body = r.jsonBody as { models: Array<{ family: string }> };
    expect(body.models.map((m) => m.family)).toEqual(['chat', 'code', 'embedding', 'custom']);
  });

  it('returns empty array when provider service not configured', async () => {
    await runQuery('UPDATE user_provider_service_config SET enabled = 0 WHERE user_id = 1');
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    expect((r.jsonBody as { models: unknown[] }).models).toEqual([]);
    await runQuery('UPDATE user_provider_service_config SET enabled = 1 WHERE user_id = 1');
  });

  it('returns empty array when /models/status fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const r = fakeRes();
    await getLocalInstalled(fakeReq(), r.res);
    expect((r.jsonBody as { models: unknown[] }).models).toEqual([]);
  });
});
```

Note: this test seeds `service_token_enc = 'enc-blob'`. The controller will call `decryptSecret()` on it. For the test to work without real crypto, we need to mock `decryptSecret` — see Step 3 below for the controller pattern that's already established (it tolerates decrypt errors via the surrounding try/catch).

Actually — re-check: the existing `getInstalled` controller does `const token = decryptSecret(cfg.service_token_enc);` and wraps in try/catch. If `decryptSecret('enc-blob')` throws, the outer catch returns `{ models: [] }`. So this test pattern needs an additional mock OR the test must seed a real encrypted blob.

To keep this simple: mock `decryptSecret` in the test using Jest module mocking BEFORE the dynamic import. Update the imports section of the test:

```ts
jest.unstable_mockModule('../../utils/secretCrypto.js', () => ({
  decryptSecret: (_blob: string) => 'mock-token',
  encryptSecret: (s: string) => s,
}));

process.env.DATABASE_PATH = ':memory:';
const { initDatabase, runQuery } = await import('../../database/sqlite.js');
// … rest of imports
```

The `jest.unstable_mockModule` call MUST come before the dynamic imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- catalogControllerLocalInstalled`
Expected: FAIL — `getLocalInstalled` not exported (or returns wrong shape).

- [ ] **Step 3: Implement the controller**

Edit `backend/src/controllers/catalogController.ts`. Add imports at the top (after existing imports):

```ts
import { lookupCuratedLocal, normalizeOllamaName, type LocalModelFamily } from '../data/curatedLocalModels.js';
import { getLocalProsCons } from '../data/localProsConsRepo.js';
import { generateLocalProsCons } from '../services/catalogProsConsService.js';
```

Append a new exported function at the end:

```ts
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

export async function getLocalInstalled(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) {
    res.json({ models: [] });
    return;
  }

  let loaded: string[];
  try {
    const token = decryptSecret(cfg.service_token_enc);
    const url = new URL('/models/status', cfg.service_url);
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      res.json({ models: [] });
      return;
    }
    const data = (await r.json()) as { loaded?: string[] };
    loaded = data.loaded ?? [];
  } catch {
    res.json({ models: [] });
    return;
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
    // Unknown — default to 'custom' family, mark for fire-and-forget generation
    cards.push({ name, base_name, family: 'custom' });
    needsGeneration.push({ name, family: 'custom' });
  }

  cards.sort((a, b) => {
    const rDiff = FAMILY_RANK[a.family] - FAMILY_RANK[b.family];
    if (rDiff !== 0) return rDiff;
    return a.name.localeCompare(b.name);
  });

  res.json({ models: cards });

  // Fire-and-forget: generate pros/cons for unknown models in the background,
  // rate-limited via the same pause-pattern as the search endpoint.
  if (needsGeneration.length > 0) {
    void (async () => {
      for (const { name, family } of needsGeneration) {
        try {
          await generateLocalProsCons(name, family);
        } catch (err) {
          console.error(
            '[catalog-local] generate failed',
            name,
            (err as Error).message,
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })().catch(() => {});
  }
}
```

Now register the route. Edit `backend/src/routes/catalog.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getCurated,
  getSearch,
  getInstalled,
  getLocalInstalled,
} from '../controllers/catalogController.js';

const router = Router();
router.use(requireUser);
router.get('/curated', getCurated);
router.get('/search', getSearch);
router.get('/installed', getInstalled);
router.get('/local-installed', getLocalInstalled);
export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- catalogControllerLocalInstalled`
Expected: PASS (6 test cases).

- [ ] **Step 5: Verify type-check passes**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/catalogController.ts backend/src/routes/catalog.ts backend/src/__tests__/unit/catalogControllerLocalInstalled.test.ts
git commit -m "feat(catalog-local): GET /api/catalog/local-installed endpoint"
```

---

## Task 6: Frontend API Service

**Files:**
- Modify: `frontend/src/services/catalogApi.ts`

- [ ] **Step 1: Add types and fetch function**

Edit `frontend/src/services/catalogApi.ts`. Append at the end of the file:

```ts
export type LocalModelFamily = 'chat' | 'code' | 'embedding' | 'custom';

export interface LocalModelCard {
  name: string;
  base_name: string;
  family: LocalModelFamily;
  pros?: string[];
  cons?: string[];
  setup_note?: string;
}

export interface LocalInstalledResponse {
  models: LocalModelCard[];
}

export function getLocalInstalled(): Promise<LocalInstalledResponse> {
  return apiCall<LocalInstalledResponse>('/catalog/local-installed');
}
```

- [ ] **Step 2: Verify frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/catalogApi.ts
git commit -m "feat(catalog-local): frontend API client for local-installed"
```

---

## Task 7: LocalModelCard Component

**Files:**
- Create: `frontend/src/components/LocalModelCard.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/LocalModelCard.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useState } from 'react';
import type { LocalModelCard as LocalModelCardType, LocalModelFamily } from '../services/catalogApi';

const FAMILY_LABEL: Record<LocalModelFamily, string> = {
  chat: 'Chat',
  code: 'Code',
  embedding: 'Embedding',
  custom: 'Custom',
};

const FAMILY_BADGE: Record<LocalModelFamily, string> = {
  chat: 'bg-blue-100 text-blue-800',
  code: 'bg-green-100 text-green-800',
  embedding: 'bg-gray-100 text-gray-700',
  custom: 'bg-purple-100 text-purple-800',
};

export default function LocalModelCard({
  card,
}: {
  card: LocalModelCardType;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const runCommand = `ollama run ${card.name}`;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(runCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = runCommand;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // user copies manually
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium font-mono text-gray-900 break-all">
          {card.name}
        </span>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded ${FAMILY_BADGE[card.family]}`}
        >
          {FAMILY_LABEL[card.family]}
        </span>
      </div>

      {(card.pros?.length || card.cons?.length || card.setup_note) ? (
        <div className="mt-2 space-y-1">
          {card.pros?.map((p, i) => (
            <div key={`p${i}`} className="text-xs text-green-800 flex gap-1">
              <span aria-hidden>✅</span>
              <span>{p}</span>
            </div>
          ))}
          {card.cons?.map((c, i) => (
            <div key={`c${i}`} className="text-xs text-amber-800 flex gap-1">
              <span aria-hidden>⚠️</span>
              <span>{c}</span>
            </div>
          ))}
          {card.setup_note && (
            <div className="text-xs text-blue-900 flex gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-1 mt-1">
              <span aria-hidden>🔧</span>
              <span>{card.setup_note}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-xs text-gray-500 italic">
          Pros/Cons werden im Hintergrund generiert — beim nächsten Laden verfügbar.
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all font-mono">
          {runCommand}
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

- [ ] **Step 2: Verify frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LocalModelCard.tsx
git commit -m "feat(catalog-local): LocalModelCard component"
```

---

## Task 8: LocalInstalledSection Component

**Files:**
- Create: `frontend/src/components/LocalInstalledSection.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/LocalInstalledSection.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React from 'react';
import LocalModelCard from './LocalModelCard';
import type { LocalModelCard as LocalModelCardType } from '../services/catalogApi';

export default function LocalInstalledSection({
  models,
}: {
  models: LocalModelCardType[];
}): React.ReactElement | null {
  if (models.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        Lokal installiert ({models.length})
      </h2>
      <p className="text-xs text-gray-600 mb-3">
        Aus <code className="font-mono">ollama list</code> — sortiert nach Kategorie.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {models.map((card) => (
          <LocalModelCard key={card.name} card={card} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LocalInstalledSection.tsx
git commit -m "feat(catalog-local): LocalInstalledSection component"
```

---

## Task 9: Integrate Section into CatalogPage

**Files:**
- Modify: `frontend/src/pages/CatalogPage.tsx`

- [ ] **Step 1: Modify CatalogPage**

Edit `frontend/src/pages/CatalogPage.tsx`. Replace the file content with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useRef, useState } from 'react';
import {
  getCurated,
  searchCatalog,
  getInstalled,
  getLocalInstalled,
  isInstalled as checkInstalled,
  type CuratedResponse,
  type ModelCard as ModelCardType,
  type LocalModelCard as LocalModelCardType,
} from '../services/catalogApi';
import ModelCard from '../components/ModelCard';
import CatalogSection from '../components/CatalogSection';
import LocalInstalledSection from '../components/LocalInstalledSection';

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

export default function CatalogPage(): React.ReactElement {
  const [curated, setCurated] = useState<CuratedResponse | null>(null);
  const [installedNames, setInstalledNames] = useState<string[]>([]);
  const [localModels, setLocalModels] = useState<LocalModelCardType[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModelCardType[] | null>(null);
  const [searchStale, setSearchStale] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    void Promise.all([getCurated(), getInstalled(), getLocalInstalled()])
      .then(([c, inst, local]) => {
        setCurated(c);
        setInstalledNames(inst.models);
        setLocalModels(local.models);
      })
      .catch(() => {});
  }, []);

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

  const searchActive = searchResults !== null;

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

      <div className="mb-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
        💡 <strong>Hinweis:</strong> Nicht alle{' '}
        <code className="font-mono">hf.co/…</code>-Pulls klappen sauber — wenn
        Ollama "not compatible with llama.cpp" meldet, gibt es das Modell oft
        auch direkt in der offiziellen{' '}
        <a
          href="https://ollama.com/library"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          Ollama-Library
        </a>{' '}
        (z.B. <code className="font-mono">ollama run deepseek-r1:8b</code>).
      </div>

      {searchStale && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs p-2 rounded mb-3">
          Daten älter als 30 min — HF gerade nicht erreichbar.
        </div>
      )}

      {!searchActive && <LocalInstalledSection models={localModels} />}

      {searchActive ? (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Such-Treffer für „{query}" ({searchResults!.length})
          </h2>
          {searching && <div className="text-sm text-gray-500">Suche läuft…</div>}
          {searchError && (
            <div className="text-sm text-red-700">Fehler: {searchError}</div>
          )}
          {searchResults!.length === 0 && !searching && (
            <div className="text-sm text-gray-500 italic">
              Keine Modelle gefunden.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults!.map((card) => (
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

      {curated?.fetched_at && (
        <div className="mt-8 text-xs text-gray-400 text-right">
          Daten von Hugging Face — letzte Aktualisierung: {relativeTime(curated.fetched_at)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CatalogPage.tsx
git commit -m "feat(catalog-local): render LocalInstalledSection on CatalogPage"
```

---

## Task 10: Manual Smoke Test + Full Build Verification

- [ ] **Step 1: Run backend full test suite**

Run: `cd backend && npm test`
Expected: all tests pass (no regressions in existing catalog tests).

- [ ] **Step 2: Build backend**

Run: `cd backend && npm run build`
Expected: TypeScript compiles cleanly to `dist/`.

- [ ] **Step 3: Build frontend**

Run: `cd frontend && npm run build`
Expected: Vite production build succeeds.

- [ ] **Step 4: Local smoke test**

Start backend and frontend locally:
```bash
cd backend && npm run dev &
cd frontend && npm run dev &
```

Open `http://localhost:5173/catalog` in browser.
- Verify the "Lokal installiert (N)" section appears above HF sections
- Verify family badges render (Chat/Code/Embedding/Custom in correct colors)
- Verify curated models (`mistral-nemo:*`, `deepseek-r1:*`, etc.) show pros/cons immediately
- Verify custom models (`mistral-nemo-cc:latest`, `dev-coder`, `soc-*`) initially show pros/cons (curated matches) or a "wird generiert…" hint
- Type in search box → confirm Local section disappears, HF search results show
- Clear search → confirm Local section returns

Stop both processes.

- [ ] **Step 5: Deploy to production VPS**

Reference: [memory/project_production_architecture.md](../../../../.claude/projects/-Library-WebServer-Documents-KI-Usage-tracker/memory/project_production_architecture.md) for the deployment flow. Apache + port 3001 + systemd unit + `/claudetracker/` subpath. Confirm:
- Backend rebuilt and systemd unit restarted on VPS
- Frontend assets uploaded to `/claudetracker/` document root
- DB migration applied automatically on backend startup (`catalog_local_pros_cons` table created)

- [ ] **Step 6: Production verification**

Open `https://wolfinisoftware.de/claudetracker/catalog`.
- Section "Lokal installiert" rendert
- Mindestens 5 Modelle aus `ollama list` mit Pros/Cons sichtbar
- Page-Reload nach ~1 min: zuvor unbekannte Custom-Modelle haben nun LLM-generierte Pros/Cons (statt "wird generiert…")

- [ ] **Step 7: Final commit (if any cleanup needed)**

If smoke test surfaces a small fix, commit it. Otherwise no-op.
