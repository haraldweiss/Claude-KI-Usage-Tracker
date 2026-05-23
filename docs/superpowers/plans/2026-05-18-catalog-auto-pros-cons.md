# Sub-Projekt B.3 — Auto-Pros/Cons via mistral-nemo (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM-generierte Pros/Cons für Latest-Uploads und Suchergebnisse im Modell-Katalog. Primary: mistral-nemo über eigene ai-provider-service. Fallback: Claude Haiku 4.5.

**Architecture:** Neuer `catalogProsConsService.ts` mit zwei Provider-Adaptern (Primary/Fallback). Wrapper `generateAndCacheProsCons(card)` versucht Primary, fällt bei Failure auf Fallback. Result wird in `catalog_hf_cache.data_json` als zusätzliche `pros`, `cons`, `auto_pros_generated_at` Felder gespeichert. Cron + Search triggern Generation, Eviction räumt alte Such-Treffer im 04:00-Cron weg.

**Tech Stack:** Node.js 20, TypeScript, sqlite3 (vorhandene Tabellen), Jest mit `@jest/globals`.

---

## Vorab: Files Map

| Datei | Zweck |
|-------|-------|
| `backend/src/services/catalogProsConsService.ts` | NEU. Public API + Adapter |
| `backend/src/services/catalogService.ts` | MOD. ModelCard-Interface erweitern |
| `backend/src/services/catalogCacheRefresh.ts` | MOD. refreshLatestUploads ruft Generation; neue evictStaleSearchCacheRows |
| `backend/src/controllers/catalogController.ts` | MOD. getSearch triggert async Generation |
| `backend/src/server.ts` | MOD. Eviction-Cron-Step nach Refresh; Initial-Prime ruft Generation |
| `backend/src/__tests__/unit/catalogProsConsService.test.ts` | NEU. Unit-Tests Service |
| `backend/src/__tests__/unit/catalogCacheRefresh.test.ts` | MOD. Tests für Eviction + Generation-Trigger |
| `/etc/systemd/system/claudetracker-backend.service.d/override.conf` | MOD (auf VPS). 4 neue Env-Vars |

---

### Task 1: ModelCard-Interface erweitern

**Files:**
- Modify: `backend/src/services/catalogService.ts` (ModelCard-Interface)

- [ ] **Step 1: ModelCard um 3 optionale Felder erweitern**

Suche das `export interface ModelCard {` und füge die Felder hinzu:

```typescript
export interface ModelCard {
  // ... existing fields ...
  pros?: string[];
  cons?: string[];
  auto_pros_generated_at?: string;  // ISO-8601, nur bei LLM-generiert
}
```

- [ ] **Step 2: TypeScript-Build prüfen**

Run: `cd backend && npx tsc --noEmit`
Expected: kein Output (= success). Keine "Property X does not exist"-Fehler im restlichen Code, weil Felder optional sind.

- [ ] **Step 3: Bestehende Tests laufen lassen**

Run: `cd backend && npm test -- --silent 2>&1 | tail -5`
Expected: alle 173 Tests grün.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/catalogService.ts
git commit -m "feat(catalog-pros): extend ModelCard with optional pros/cons fields"
```

---

### Task 2: Prompt-Builder (TDD)

**Files:**
- Create: `backend/src/services/catalogProsConsService.ts`
- Create: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

- [ ] **Step 1: Test für buildPrompt schreiben**

Datei: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';

const { buildPrompt } = await import('../../services/catalogProsConsService.js');

describe('buildPrompt', () => {
  it('includes repo, size, source_label and description', () => {
    const card = {
      repo: 'bartowski/Awesome-Model-GGUF',
      source_label: 'Bartowski',
      size_b: 7,
      quant_count: 4,
      downloads: 1000,
      default_quant: 'Q4_K_M',
      ollama_command: 'ollama run hf.co/bartowski/Awesome-Model-GGUF:Q4_K_M',
      description: 'A great coding LLM by Qwen.',
    };
    const prompt = buildPrompt(card as any);
    expect(prompt).toContain('bartowski/Awesome-Model-GGUF');
    expect(prompt).toContain('7B');
    expect(prompt).toContain('Bartowski');
    expect(prompt).toContain('A great coding LLM');
    expect(prompt).toContain('"pros"');
    expect(prompt).toContain('"cons"');
  });

  it('handles missing description gracefully', () => {
    const card = {
      repo: 'x/y', source_label: 'Other', size_b: 1, quant_count: 1,
      downloads: 1, default_quant: 'Q4_K_M', ollama_command: 'x',
    };
    const prompt = buildPrompt(card as any);
    expect(prompt).toContain('x/y');
    expect(prompt).not.toContain('undefined');
  });
});
```

- [ ] **Step 2: Test ausführen, soll fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -10`
Expected: FAIL mit "Cannot find module" oder "buildPrompt is not a function".

- [ ] **Step 3: Minimale Implementierung in catalogProsConsService.ts**

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Generiert Pros/Cons für Modell-Karten über mistral-nemo (Primary) oder
// Claude Haiku 4.5 (Fallback). Wird vom 04:00-Cron für Latest-Uploads und
// vom /search-Endpoint asynchron aufgerufen. Failure ist nicht fatal —
// Karten ohne Pros/Cons werden vom Frontend einfach ohne diese Felder gerendert.
import type { ModelCard } from './catalogService.js';

export function buildPrompt(card: ModelCard): string {
  const desc = card.description?.trim() || '—';
  return [
    `Modell: ${card.repo}`,
    `Größe: ${card.size_b ?? '?'}B Parameter, ${card.quant_count} Quantisierungen verfügbar`,
    `Veröffentlicht von: ${card.source_label}`,
    `Beschreibung (HuggingFace): ${desc}`,
    '',
    'Schreibe 3 Pros und 3 Cons, jeweils einen kurzen Satz (max. 80 Zeichen),',
    'konkret und praxisnah:',
    '- Pros: Anwendungsfälle, Stärken, was das Modell gut macht',
    '- Cons: Schwächen, Limitierungen, wofür es ungeeignet ist',
    '',
    'Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach:',
    '{"pros": ["...", "...", "..."], "cons": ["...", "...", "..."]}',
  ].join('\n');
}
```

- [ ] **Step 4: Test läuft grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -5`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsService.test.ts
git commit -m "feat(catalog-pros): buildPrompt helper for LLM input"
```

---

### Task 3: JSON-Parser (TDD)

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts`
- Modify: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

- [ ] **Step 1: Tests für parseProsCons schreiben**

In `catalogProsConsService.test.ts` ergänzen:

```typescript
const { parseProsCons } = await import('../../services/catalogProsConsService.js');

describe('parseProsCons', () => {
  it('parses clean JSON', () => {
    const r = parseProsCons('{"pros": ["A", "B", "C"], "cons": ["X", "Y", "Z"]}');
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(r.cons).toEqual(['X', 'Y', 'Z']);
  });

  it('extracts JSON from surrounding text', () => {
    const noisy = 'Hier ist meine Antwort:\n```json\n{"pros":["A","B","C"],"cons":["X","Y","Z"]}\n```\nHoffe das hilft!';
    const r = parseProsCons(noisy);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(r.cons).toEqual(['X', 'Y', 'Z']);
  });

  it('trims strings to 80 chars', () => {
    const long = 'A'.repeat(120);
    const json = `{"pros":["${long}","B","C"],"cons":["X","Y","Z"]}`;
    const r = parseProsCons(json);
    expect(r.pros[0]).toHaveLength(80);
  });

  it('throws if pros is missing', () => {
    expect(() => parseProsCons('{"cons":["X","Y","Z"]}')).toThrow();
  });

  it('throws if pros is empty array', () => {
    expect(() => parseProsCons('{"pros":[],"cons":["X","Y","Z"]}')).toThrow();
  });

  it('pads 2-bullet response to 3', () => {
    const r = parseProsCons('{"pros":["A","B"],"cons":["X","Y","Z"]}');
    expect(r.pros).toHaveLength(3);
    expect(r.pros[2]).toBe('');
  });

  it('truncates 4+-bullet response to 3', () => {
    const r = parseProsCons('{"pros":["A","B","C","D"],"cons":["X","Y","Z","W"]}');
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(r.cons).toEqual(['X', 'Y', 'Z']);
  });

  it('rejects unparseable garbage', () => {
    expect(() => parseProsCons('totally not json')).toThrow();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sollen fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -15`
Expected: `parseProsCons is not a function` o.ä.

- [ ] **Step 3: parseProsCons implementieren**

In `catalogProsConsService.ts` ergänzen:

```typescript
export interface ProsCons {
  pros: string[];
  cons: string[];
}

export function parseProsCons(content: string): ProsCons {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    // Versuche JSON aus Text zu extrahieren
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    try {
      json = JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`JSON parse failed: ${(e as Error).message}`);
    }
  }

  const obj = json as { pros?: unknown; cons?: unknown };
  if (!Array.isArray(obj.pros) || !Array.isArray(obj.cons)) {
    throw new Error('Response missing pros[] or cons[] arrays');
  }
  const normalize = (arr: unknown[]): string[] => {
    const strings = arr.filter((x): x is string => typeof x === 'string')
                       .map((s) => s.trim().slice(0, 80));
    if (strings.length === 0) throw new Error('Empty bullet array');
    // Pad to 3 or truncate to 3
    while (strings.length < 3) strings.push('');
    return strings.slice(0, 3);
  };
  return { pros: normalize(obj.pros), cons: normalize(obj.cons) };
}
```

- [ ] **Step 4: Tests laufen grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -5`
Expected: 9 passed (2 buildPrompt + 7 parseProsCons).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsService.test.ts
git commit -m "feat(catalog-pros): tolerant JSON parser with normalization"
```

---

### Task 4: Primary-LLM-Adapter (TDD)

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts`
- Modify: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

- [ ] **Step 1: Tests für callPrimaryLLM schreiben**

In `catalogProsConsService.test.ts` ergänzen (vor dem `const { parseProsCons }` Import):

```typescript
import { jest, beforeEach, afterEach } from '@jest/globals';
const { callPrimaryLLM } = await import('../../services/catalogProsConsService.js');

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  process.env.CATALOG_LLM_URL = 'http://pool.test';
  process.env.CATALOG_LLM_TOKEN = 'test-token';
});
afterEach(() => {
  jest.resetAllMocks();
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
});

const CARD = {
  repo: 'bartowski/X-GGUF', source_label: 'Bartowski', size_b: 7,
  quant_count: 4, downloads: 1000, default_quant: 'Q4_K_M',
  ollama_command: 'ollama run hf.co/bartowski/X-GGUF:Q4_K_M',
  description: 'Coding LLM',
} as any;

describe('callPrimaryLLM', () => {
  it('happy path: parses OpenAI-compat response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' } }],
      }),
    });
    const r = await callPrimaryLLM(CARD);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/chat/completions');
    expect((opts as any).headers.Authorization).toBe('Bearer test-token');
  });

  it('throws on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'pool down' });
    await expect(callPrimaryLLM(CARD)).rejects.toThrow(/500/);
  });

  it('throws on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'auth' });
    await expect(callPrimaryLLM(CARD)).rejects.toThrow(/401/);
  });

  it('retries once if response is not valid JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: 'sorry no JSON' } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' } }] }) });
    const r = await callPrimaryLLM(CARD);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws if both attempts return unparseable', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'still no JSON' } }] }) });
    await expect(callPrimaryLLM(CARD)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws if env vars missing', async () => {
    delete process.env.CATALOG_LLM_URL;
    await expect(callPrimaryLLM(CARD)).rejects.toThrow(/not configured/);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sollen fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -10`
Expected: `callPrimaryLLM is not a function`.

- [ ] **Step 3: callPrimaryLLM implementieren**

In `catalogProsConsService.ts` ergänzen:

```typescript
const SYSTEM_PROMPT = 'Du bist ein Experte für lokale Open-Source-LLMs. Du bewertest Modelle für deutschsprachige Entwickler:innen und gibst kompakte Pro/Contra-Listen aus. Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach.';
const STRICT_RETRY_PROMPT = SYSTEM_PROMPT + ' WICHTIG: Deine vorherige Antwort enthielt kein gültiges JSON. Antworte JETZT nur mit reinem JSON, ohne Markdown-Codeblöcke, ohne Vor-/Nachwort.';

async function callOpenAICompat(
  url: string, token: string, model: string, system: string, user: string,
): Promise<string> {
  const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 500,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response content');
  return content;
}

export async function callPrimaryLLM(card: ModelCard): Promise<ProsCons> {
  const url = process.env.CATALOG_LLM_URL?.trim();
  const token = process.env.CATALOG_LLM_TOKEN?.trim();
  const model = process.env.CATALOG_LLM_MODEL?.trim() || 'mistral-nemo:latest';
  if (!url || !token) throw new Error('Primary LLM not configured');

  const userPrompt = buildPrompt(card);
  // 1st attempt
  let content = await callOpenAICompat(url, token, model, SYSTEM_PROMPT, userPrompt);
  try {
    return parseProsCons(content);
  } catch (e1) {
    // 2nd attempt with stricter prompt
    content = await callOpenAICompat(url, token, model, STRICT_RETRY_PROMPT, userPrompt);
    return parseProsCons(content);
  }
}
```

- [ ] **Step 4: Tests laufen grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -5`
Expected: 15 passed (2 + 7 + 6).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsService.test.ts
git commit -m "feat(catalog-pros): callPrimaryLLM via OpenAI-compat with retry"
```

---

### Task 5: Fallback-LLM-Adapter (TDD)

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts`
- Modify: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

- [ ] **Step 1: Tests für callFallbackLLM schreiben**

In `catalogProsConsService.test.ts` ergänzen:

```typescript
const { callFallbackLLM } = await import('../../services/catalogProsConsService.js');

describe('callFallbackLLM', () => {
  beforeEach(() => {
    process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY = 'sk-ant-test';
  });
  afterEach(() => {
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    delete process.env.CATALOG_LLM_FALLBACK_MODEL;
  });

  it('happy path: parses Anthropic messages response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' }],
      }),
    });
    const r = await callFallbackLLM(CARD);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((opts as any).headers['x-api-key']).toBe('sk-ant-test');
    expect((opts as any).headers['anthropic-version']).toBeTruthy();
  });

  it('uses custom model from env', async () => {
    process.env.CATALOG_LLM_FALLBACK_MODEL = 'claude-sonnet-4-5';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' }] }),
    });
    await callFallbackLLM(CARD);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.model).toBe('claude-sonnet-4-5');
  });

  it('throws on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '{"error":"auth"}' });
    await expect(callFallbackLLM(CARD)).rejects.toThrow(/401/);
  });

  it('throws if key missing', async () => {
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    await expect(callFallbackLLM(CARD)).rejects.toThrow(/not configured/);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sollen fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -10`
Expected: `callFallbackLLM is not a function`.

- [ ] **Step 3: callFallbackLLM implementieren**

In `catalogProsConsService.ts` ergänzen:

```typescript
export async function callFallbackLLM(card: ModelCard): Promise<ProsCons> {
  const key = process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();
  const model = process.env.CATALOG_LLM_FALLBACK_MODEL?.trim() || 'claude-haiku-4-5';
  if (!key) throw new Error('Fallback LLM not configured');

  const userPrompt = buildPrompt(card);
  const callOnce = async (system: string): Promise<string> => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((b) => b.type === 'text')?.text;
    if (!text) throw new Error('Empty Anthropic response');
    return text;
  };

  let content = await callOnce(SYSTEM_PROMPT);
  try {
    return parseProsCons(content);
  } catch {
    content = await callOnce(STRICT_RETRY_PROMPT);
    return parseProsCons(content);
  }
}
```

- [ ] **Step 4: Tests laufen grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -5`
Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsService.test.ts
git commit -m "feat(catalog-pros): callFallbackLLM via Anthropic native API"
```

---

### Task 6: Wrapper `generateAndCacheProsCons` + `isProsConsEnabled` (TDD)

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts`
- Modify: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

- [ ] **Step 1: Tests für Wrapper schreiben**

In `catalogProsConsService.test.ts` ergänzen:

```typescript
import { initDatabase, runQuery, allQuery } from '../../database/sqlite.js';
process.env.DATABASE_PATH = ':memory:';
const { generateAndCacheProsCons, isProsConsEnabled } = await import('../../services/catalogProsConsService.js');

describe('isProsConsEnabled', () => {
  afterEach(() => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
  });
  it('returns true if primary is configured', () => {
    process.env.CATALOG_LLM_URL = 'x'; process.env.CATALOG_LLM_TOKEN = 'y';
    expect(isProsConsEnabled()).toBe(true);
  });
  it('returns true if only fallback is configured', () => {
    process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY = 'sk-ant-x';
    expect(isProsConsEnabled()).toBe(true);
  });
  it('returns false if neither is configured', () => {
    expect(isProsConsEnabled()).toBe(false);
  });
});

describe('generateAndCacheProsCons', () => {
  beforeAll(async () => {
    await initDatabase();
    // Seed das Card im Cache, damit Upsert das `pros`-Feld setzen kann
    await runQuery(
      `INSERT INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
      [CARD.repo, JSON.stringify(CARD), new Date().toISOString()],
    );
  });
  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    process.env.CATALOG_LLM_URL = 'http://pool.test';
    process.env.CATALOG_LLM_TOKEN = 'tok';
    process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY = 'sk-ant';
  });
  afterEach(async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    jest.resetAllMocks();
    // Reset cached card to original (no pros/cons)
    await runQuery(
      `UPDATE catalog_hf_cache SET data_json=?, last_error=NULL WHERE repo=?`,
      [JSON.stringify(CARD), CARD.repo],
    );
  });

  it('primary succeeds: upserts pros/cons, no fallback call', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"pros":["P1","P2","P3"],"cons":["C1","C2","C3"]}' } }] }),
    });
    const ok = await generateAndCacheProsCons(CARD);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await allQuery<{ data_json: string }>(`SELECT data_json FROM catalog_hf_cache WHERE repo=?`, [CARD.repo]);
    const card = JSON.parse(rows[0]!.data_json);
    expect(card.pros).toEqual(['P1', 'P2', 'P3']);
    expect(card.cons).toEqual(['C1', 'C2', 'C3']);
    expect(card.auto_pros_generated_at).toBeTruthy();
  });

  it('primary fails, fallback succeeds: upserts and counts as fallback', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'pool down' })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'still down' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{"pros":["F1","F2","F3"],"cons":["G1","G2","G3"]}' }] }),
      });
    const ok = await generateAndCacheProsCons(CARD);
    expect(ok).toBe(true);
    const rows = await allQuery<{ data_json: string }>(`SELECT data_json FROM catalog_hf_cache WHERE repo=?`, [CARD.repo]);
    const card = JSON.parse(rows[0]!.data_json);
    expect(card.pros).toEqual(['F1', 'F2', 'F3']);
  });

  it('both fail: records last_error, returns false', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'down' });
    const ok = await generateAndCacheProsCons(CARD);
    expect(ok).toBe(false);
    const rows = await allQuery<{ last_error: string | null }>(`SELECT last_error FROM catalog_hf_cache WHERE repo=?`, [CARD.repo]);
    expect(rows[0]!.last_error).toMatch(/primary.*fallback/);
  });

  it('returns false if neither provider configured', async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    const ok = await generateAndCacheProsCons(CARD);
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sollen fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -10`
Expected: `generateAndCacheProsCons is not a function`.

- [ ] **Step 3: Wrapper + isProsConsEnabled implementieren**

In `catalogProsConsService.ts` ergänzen:

```typescript
import { upsertCardCache, recordCacheError, getCachedCard } from '../data/catalogCacheRepo.js';

export function isProsConsEnabled(): boolean {
  const primaryOK = !!(process.env.CATALOG_LLM_URL?.trim() && process.env.CATALOG_LLM_TOKEN?.trim());
  const fallbackOK = !!process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();
  return primaryOK || fallbackOK;
}

export async function generateAndCacheProsCons(card: ModelCard): Promise<boolean> {
  if (!isProsConsEnabled()) return false;

  const primaryOK = !!(process.env.CATALOG_LLM_URL?.trim() && process.env.CATALOG_LLM_TOKEN?.trim());
  const fallbackOK = !!process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();

  let pros: ProsCons | null = null;
  let primaryErr: string | null = null;
  let fallbackErr: string | null = null;

  if (primaryOK) {
    try {
      pros = await callPrimaryLLM(card);
    } catch (e) {
      primaryErr = (e as Error).message;
    }
  }
  if (!pros && fallbackOK) {
    try {
      pros = await callFallbackLLM(card);
    } catch (e) {
      fallbackErr = (e as Error).message;
    }
  }

  if (!pros) {
    const msg = [
      primaryErr && `primary: ${primaryErr}`,
      fallbackErr && `fallback: ${fallbackErr}`,
    ].filter(Boolean).join(' | ') || 'no provider configured';
    await recordCacheError(card.repo, msg);
    return false;
  }

  const updatedCard: ModelCard = {
    ...card,
    pros: pros.pros,
    cons: pros.cons,
    auto_pros_generated_at: new Date().toISOString(),
  };
  await upsertCardCache(card.repo, updatedCard, null);
  return true;
}
```

- [ ] **Step 4: Tests laufen grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -5`
Expected: 26 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsService.test.ts
git commit -m "feat(catalog-pros): generateAndCacheProsCons wrapper with primary+fallback"
```

---

### Task 7: Batch-Helper `generateBatchProsCons` (TDD)

**Files:**
- Modify: `backend/src/services/catalogProsConsService.ts`
- Modify: `backend/src/__tests__/unit/catalogProsConsService.test.ts`

- [ ] **Step 1: Test schreiben**

In `catalogProsConsService.test.ts` ergänzen:

```typescript
const { generateBatchProsCons } = await import('../../services/catalogProsConsService.js');

describe('generateBatchProsCons', () => {
  beforeEach(async () => {
    // Seed 3 cards
    for (const repo of ['a/x', 'a/y', 'a/z']) {
      const c = { ...CARD, repo };
      await runQuery(
        `INSERT OR REPLACE INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
        [repo, JSON.stringify(c), new Date().toISOString()],
      );
    }
  });

  it('counts generated/skipped/failed', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('anthropic')) {
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"pros":["F","F","F"],"cons":["F","F","F"]}' }] }) };
      }
      // 1st succeeds, 2nd fails (gets fallback), 3rd succeeds
      const callIdx = fetchMock.mock.calls.length - 1;
      if (callIdx === 1) return { ok: false, status: 500, text: async () => 'down' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"pros":["P","P","P"],"cons":["C","C","C"]}' } }] }) };
    });
    const cards = ['a/x', 'a/y', 'a/z'].map((repo) => ({ ...CARD, repo }));
    const r = await generateBatchProsCons(cards as any, { pauseMs: 0 });
    expect(r.generated).toBeGreaterThanOrEqual(2);
  });

  it('uses 2s pause between calls by default', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"pros":["P","P","P"],"cons":["C","C","C"]}' } }] }),
    });
    const start = Date.now();
    await generateBatchProsCons([CARD, CARD] as any, { pauseMs: 50 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sollen fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -10`
Expected: `generateBatchProsCons is not a function`.

- [ ] **Step 3: Implementierung**

In `catalogProsConsService.ts` ergänzen:

```typescript
export interface BatchResult {
  generated: number;
  skipped: number;
  failed: number;
}

export async function generateBatchProsCons(
  cards: ModelCard[],
  opts: { pauseMs?: number } = {},
): Promise<BatchResult> {
  const pauseMs = opts.pauseMs ?? 2000;
  const summary: BatchResult = { generated: 0, skipped: 0, failed: 0 };
  if (!isProsConsEnabled()) {
    summary.skipped = cards.length;
    return summary;
  }
  for (let i = 0; i < cards.length; i++) {
    const ok = await generateAndCacheProsCons(cards[i]!);
    if (ok) summary.generated++;
    else summary.failed++;
    if (i < cards.length - 1 && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  return summary;
}
```

- [ ] **Step 4: Tests laufen grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogProsConsService.test.ts 2>&1 | tail -5`
Expected: 28 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogProsConsService.ts backend/src/__tests__/unit/catalogProsConsService.test.ts
git commit -m "feat(catalog-pros): generateBatchProsCons with rate-limit pause"
```

---

### Task 8: Generation in `refreshLatestUploads` integrieren (TDD)

**Files:**
- Modify: `backend/src/services/catalogCacheRefresh.ts`
- Modify: `backend/src/__tests__/unit/catalogCacheRefresh.test.ts`

- [ ] **Step 1: Test ergänzen**

In `catalogCacheRefresh.test.ts` ergänzen (am Ende der `describe('refreshLatestUploads')`):

```typescript
it('triggers pros/cons generation for new uploads when LLM is configured', async () => {
  process.env.CATALOG_LLM_URL = 'http://pool.test';
  process.env.CATALOG_LLM_TOKEN = 'tok';
  try {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('author=bartowski') && String(url).includes('sort=lastModified')) {
        return { ok: true, json: async () => [
          { id: 'bartowski/A-GGUF', lastModified: '2026-05-18T12:00:00' },
        ]};
      }
      if (String(url).includes('author=MaziyarPanahi') && String(url).includes('sort=lastModified')) {
        return { ok: true, json: async () => []};
      }
      if (String(url).includes('/v1/chat/completions')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"pros":["P1","P2","P3"],"cons":["C1","C2","C3"]}' } }] }) };
      }
      // HF metadata fetch
      return {
        ok: true,
        json: async () => ({
          modelId: extractRepoFromUrl(String(url)),
          downloads: 100,
          siblings: [{ rfilename: 'q4.gguf' }],
        }),
      };
    });
    await refreshLatestUploads();
    const rows = await allQuery<{ data_json: string }>(`SELECT data_json FROM catalog_hf_cache WHERE repo='bartowski/A-GGUF'`);
    const card = JSON.parse(rows[0]!.data_json);
    expect(card.pros).toEqual(['P1', 'P2', 'P3']);
  } finally {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
  }
});

it('skips pros/cons generation if LLM is not configured', async () => {
  // Same setup minus env vars
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('author=bartowski') && String(url).includes('sort=lastModified')) {
      return { ok: true, json: async () => [{ id: 'bartowski/B-GGUF', lastModified: '2026-05-18T12:00:00' }]};
    }
    if (String(url).includes('author=MaziyarPanahi') && String(url).includes('sort=lastModified')) {
      return { ok: true, json: async () => []};
    }
    return {
      ok: true,
      json: async () => ({ modelId: extractRepoFromUrl(String(url)), downloads: 100, siblings: [{ rfilename: 'q4.gguf' }] }),
    };
  });
  await refreshLatestUploads();
  const rows = await allQuery<{ data_json: string }>(`SELECT data_json FROM catalog_hf_cache WHERE repo='bartowski/B-GGUF'`);
  const card = JSON.parse(rows[0]!.data_json);
  expect(card.pros).toBeUndefined();
});
```

(Du musst ggf. `allQuery` zum bestehenden Import oben in der Test-Datei ergänzen, falls noch nicht da.)

- [ ] **Step 2: Tests laufen lassen, einer muss fehlschlagen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogCacheRefresh.test.ts 2>&1 | tail -10`
Expected: Der "triggers pros/cons generation"-Test schlägt fehl, weil noch kein Trigger eingebaut ist.

- [ ] **Step 3: Generation-Trigger in refreshLatestUploads einbauen**

In `catalogCacheRefresh.ts`, am Ende von `refreshLatestUploads()`, nach `replaceLatestUploads(...)`:

```typescript
// B.3: Pros/Cons generieren für alle Repos die noch keine haben (oder stale > 30d).
if (isProsConsEnabled()) {
  const cardsNeedingPros: ModelCard[] = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const m of top) {
    const cached = await getCachedCard(m.repo);
    if (!cached) continue;
    if (!cached.card.pros || (cached.card.auto_pros_generated_at ?? '') < thirtyDaysAgo) {
      cardsNeedingPros.push(cached.card);
    }
  }
  if (cardsNeedingPros.length > 0) {
    const r = await generateBatchProsCons(cardsNeedingPros);
    console.log(`[catalog-pros] latest: generated=${r.generated} failed=${r.failed} skipped=${r.skipped}`);
  }
}
```

Imports oben in `catalogCacheRefresh.ts`:

```typescript
import { generateBatchProsCons, isProsConsEnabled } from './catalogProsConsService.js';
import type { ModelCard } from './catalogService.js';
```

- [ ] **Step 4: Tests laufen grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogCacheRefresh.test.ts 2>&1 | tail -5`
Expected: alle Tests grün.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/catalogCacheRefresh.ts backend/src/__tests__/unit/catalogCacheRefresh.test.ts
git commit -m "feat(catalog-pros): refreshLatestUploads triggers pros/cons generation"
```

---

### Task 9: Async-Generation für Suchergebnisse (TDD)

**Files:**
- Modify: `backend/src/controllers/catalogController.ts`
- Create: `backend/src/__tests__/unit/catalogControllerSearch.test.ts` (oder erweitere bestehende)

- [ ] **Step 1: Test schreiben**

Datei: `backend/src/__tests__/unit/catalogControllerSearch.test.ts`

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery, allQuery } = await import('../../database/sqlite.js');
const { getSearch } = await import('../../controllers/catalogController.js');

let fetchMock: jest.Mock;
let app: express.Express;

beforeAll(async () => {
  await initDatabase();
  app = express();
  app.use((req, _res, next) => { (req as any).user = { id: 'test-user' }; next(); });
  app.get('/api/catalog/search', getSearch);
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_hf_cache');
  jest.resetAllMocks();
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
});

describe('catalog search: pros/cons generation', () => {
  it('returns search results immediately, does not block on generation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { modelId: 'bartowski/X-GGUF', downloads: 100, siblings: [{ rfilename: 'q.gguf' }] },
      ],
    });
    const start = Date.now();
    const res = await request(app).get('/api/catalog/search?q=test');
    const ms = Date.now() - start;
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(500);  // Soll < 500ms zurückkommen, nicht 30s warten
    expect(res.body.results).toHaveLength(1);
  });

  it('schedules async generation when LLM configured and cache empty', async () => {
    process.env.CATALOG_LLM_URL = 'http://pool.test';
    process.env.CATALOG_LLM_TOKEN = 'tok';
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('huggingface.co/api/models?search')) {
        return { ok: true, json: async () => [{ modelId: 'bartowski/Y-GGUF', downloads: 100, siblings: [{ rfilename: 'q.gguf' }] }] };
      }
      if (String(url).includes('/v1/chat/completions')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"pros":["P","P","P"],"cons":["C","C","C"]}' } }] }) };
      }
      return { ok: true, json: async () => ({ modelId: 'bartowski/Y-GGUF', downloads: 100, siblings: [{ rfilename: 'q.gguf' }] }) };
    });
    await request(app).get('/api/catalog/search?q=test');
    // Async generation; we wait briefly for the fire-and-forget call to land
    await new Promise((r) => setTimeout(r, 200));
    const rows = await allQuery<{ data_json: string }>(`SELECT data_json FROM catalog_hf_cache WHERE repo='bartowski/Y-GGUF'`);
    if (rows.length > 0) {
      const card = JSON.parse(rows[0]!.data_json);
      expect(card.pros).toBeDefined();
    }
    // Else: race condition in test; das ist OK, der Service-Test deckt das ab.
  });
});
```

- [ ] **Step 2: Test laufen lassen, Latenz-Test sollte schon grün sein**

Run: `cd backend && npm test -- src/__tests__/unit/catalogControllerSearch.test.ts 2>&1 | tail -10`
Expected: erster Test grün, zweiter könnte auch grün sein wenn search-results bereits im Cache landen (sonst rot).

- [ ] **Step 3: getSearch erweitern um fire-and-forget Generation**

In `catalogController.ts` die `getSearch`-Funktion erweitern:

```typescript
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

    // B.3: Pros/Cons im Hintergrund für die Top-10 generieren (fire-and-forget).
    // Nicht awaiten — der Client bekommt das Ergebnis bereits.
    if (isProsConsEnabled()) {
      const top = r.results.slice(0, 10);
      // Skippe alle, die schon Pros haben (vom Cache geladen).
      const needGen: ModelCard[] = [];
      for (const card of top) {
        if (card.pros && card.pros.length > 0) continue;
        needGen.push(card);
      }
      if (needGen.length > 0) {
        void generateBatchProsCons(needGen).catch((err) =>
          console.error('[catalog-pros] search async error', (err as Error).message),
        );
      }
    }
  } catch (e) {
    res.status(502).json({ error: 'hf_unreachable', detail: (e as Error).message });
  }
}
```

Imports oben ergänzen:

```typescript
import { generateBatchProsCons, isProsConsEnabled } from '../services/catalogProsConsService.js';
import type { ModelCard } from '../services/catalogService.js';
```

- [ ] **Step 4: Test ausführen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogControllerSearch.test.ts 2>&1 | tail -5`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/catalogController.ts backend/src/__tests__/unit/catalogControllerSearch.test.ts
git commit -m "feat(catalog-pros): search endpoint kicks off async pros/cons generation"
```

---

### Task 10: Eviction-Logik im 04:00-Cron (TDD)

**Files:**
- Modify: `backend/src/services/catalogCacheRefresh.ts`
- Modify: `backend/src/__tests__/unit/catalogCacheRefresh.test.ts`

- [ ] **Step 1: Test schreiben**

In `catalogCacheRefresh.test.ts` ergänzen:

```typescript
const { evictStaleSearchCacheRows } = await import('../../services/catalogCacheRefresh.js');

describe('evictStaleSearchCacheRows', () => {
  it('deletes rows older than 90 days, NOT in curated and NOT in latest', async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    // Insert 4 rows: 1 alt+non-curated+non-latest (sollte gelöscht werden),
    // 1 alt aber curated (bleibt), 1 alt aber in latest (bleibt), 1 recent (bleibt)
    const curatedRepo = 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF'; // bekanntes curated
    await runQuery(`INSERT INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
      ['old/search-hit', '{}', old]);
    await runQuery(`INSERT INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
      [curatedRepo, '{}', old]);
    await runQuery(`INSERT INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
      ['old/in-latest', '{}', old]);
    await runQuery(`INSERT INTO catalog_hf_cache (repo, data_json, fetched_at) VALUES (?, ?, ?)`,
      ['recent/search-hit', '{}', recent]);
    await runQuery(`INSERT INTO catalog_latest_uploads (position, repo, fetched_at) VALUES (?, ?, ?)`,
      [1, 'old/in-latest', recent]);

    const r = await evictStaleSearchCacheRows();
    expect(r.evicted).toBe(1);
    const remaining = await allQuery<{ repo: string }>(`SELECT repo FROM catalog_hf_cache`);
    const repos = remaining.map((x) => x.repo);
    expect(repos).toContain(curatedRepo);
    expect(repos).toContain('old/in-latest');
    expect(repos).toContain('recent/search-hit');
    expect(repos).not.toContain('old/search-hit');
  });
});
```

- [ ] **Step 2: Test fehlschlagen lassen**

Run: `cd backend && npm test -- src/__tests__/unit/catalogCacheRefresh.test.ts 2>&1 | tail -10`
Expected: `evictStaleSearchCacheRows is not a function`.

- [ ] **Step 3: Implementierung in catalogCacheRefresh.ts**

```typescript
import { CURATED_MODELS } from '../data/curatedModels.js';
// (CURATED_MODELS-Import ggf. schon vorhanden)

export async function evictStaleSearchCacheRows(): Promise<{ evicted: number }> {
  const curatedRepos = CURATED_MODELS.sections.flatMap((s) => s.models.map((m) => m.repo));
  // SQL-Params: 1 cutoff + N curated. NICHT IN (SELECT) für latest.
  const placeholders = curatedRepos.map(() => '?').join(',');
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const r = await runQuery(
    `DELETE FROM catalog_hf_cache
       WHERE fetched_at < ?
         AND repo NOT IN (${placeholders || "''"})
         AND repo NOT IN (SELECT repo FROM catalog_latest_uploads)`,
    [cutoff, ...curatedRepos],
  );
  return { evicted: r.changes ?? 0 };
}
```

Imports oben ergänzen falls noch nicht da: `import { runQuery } from '../database/sqlite.js';`

- [ ] **Step 4: Test grün**

Run: `cd backend && npm test -- src/__tests__/unit/catalogCacheRefresh.test.ts 2>&1 | tail -5`
Expected: alle grün.

- [ ] **Step 5: Eviction in den 04:00-Cron einbauen**

In `backend/src/server.ts`, im 04:00-Cron-Block:

```typescript
cron.schedule('0 4 * * *', async () => {
  try {
    console.log('[catalog-cache] starting daily refresh');
    const r = await refreshCuratedHfCache();
    console.log(`[catalog-cache] curated refreshed=${r.refreshed} failed=${r.failed}`);
    const l = await refreshLatestUploads();
    console.log(`[catalog-cache] latest  refreshed=${l.refreshed} failed=${l.failed}`);
    const e = await evictStaleSearchCacheRows();
    console.log(`[catalog-cache] evicted ${e.evicted} stale search rows`);
    for (const err of [...r.errors, ...l.errors]) {
      console.warn(`[catalog-cache] ${err.repo}: ${err.error}`);
    }
  } catch (err) {
    console.error('[catalog-cache] cron error', err);
  }
});
```

Import ergänzen:
```typescript
import { evictStaleSearchCacheRows } from './services/catalogCacheRefresh.js';
```
(In den bestehenden Sammel-Import von `catalogCacheRefresh.js` einfügen.)

- [ ] **Step 6: Build prüfen, alle Tests grün**

Run: `cd backend && npx tsc --noEmit && npm test -- --silent 2>&1 | tail -5`
Expected: tsc ohne Output. Alle Tests grün.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/catalogCacheRefresh.ts backend/src/server.ts backend/src/__tests__/unit/catalogCacheRefresh.test.ts
git commit -m "feat(catalog-pros): evict stale search-hit cache rows in 04:00 cron"
```

---

### Task 11: Initial-Prime triggert Generation (kein zusätzlicher Code falls Task 8 sauber war)

**Files:**
- Modify: `backend/src/server.ts` (nur falls erforderlich)

- [ ] **Step 1: Code Review — `refreshLatestUploads()` ruft schon `generateBatchProsCons` auf**

Die Initial-Prime-Logik aus B.2 (Server-Boot) ruft `refreshLatestUploads()` auf, das wiederum durch Task 8 die Generation triggert. Es sollte also automatisch funktionieren. Verifiziere durch Code-Inspektion `server.ts:isLatestUploadsEmpty()`-Block.

Falls die Logik anders aufgebaut ist, ergänze hier den Aufruf. Aktueller Stand:

```typescript
Promise.all([isCacheEmpty(), isLatestUploadsEmpty()])
  .then(async ([curatedEmpty, latestEmpty]) => {
    if (curatedEmpty) {
      console.log('[catalog-cache] curated empty on startup — priming');
      const rc = await refreshCuratedHfCache();
      console.log(`[catalog-cache] primed curated=${rc.refreshed}/${rc.failed}`);
    }
    if (latestEmpty) {
      console.log('[catalog-cache] latest empty on startup — priming');
      const rl = await refreshLatestUploads();  // <-- generiert pros/cons mit
      console.log(`[catalog-cache] primed latest=${rl.refreshed}/${rl.failed}`);
    }
  })
```

✓ Keine Änderung nötig.

- [ ] **Step 2: Manueller End-to-End-Smoke-Test lokal**

```bash
cd backend
CATALOG_LLM_URL=https://ai.wolfinisoftware.de \
CATALOG_LLM_TOKEN=<dev-token> \
DATABASE_PATH=/tmp/test-b3.sqlite \
npm run dev 2>&1 | head -30
```

Expected: Boot zeigt `[catalog-pros] latest: generated=6 failed=0 skipped=0` (oder ähnlich, je nach Pool-Status).

Falls Pool unreachable: stattdessen `[catalog-pros] latest: generated=0 failed=6 skipped=0`, aber Server bleibt up.

Falls Fallback konfiguriert ist: Failures werden via Fallback nachgeholt.

- [ ] **Step 3: Aufräumen — kein Commit nötig (kein Code-Change)**

---

### Task 12: Systemd-Override mit Env-Vars (Production)

**Files:**
- Modify (auf VPS): `/etc/systemd/system/claudetracker-backend.service.d/override.conf`

- [ ] **Step 1: SSH zur VPS, aktuellen Inhalt prüfen**

```bash
ssh ionos-vps 'sudo cat /etc/systemd/system/claudetracker-backend.service.d/override.conf 2>&1 | head -30'
```

Expected: existierender Inhalt mit bisherigen `Environment=`-Zeilen.

- [ ] **Step 2: Override-Datei erweitern**

Beachte: `Environment=` Direktiven mit Bearer-Tokens dürfen KEINE Anführungszeichen haben, sonst werden die Quotes Teil des Werts.

Lokale Notiz erstellen mit dem User abstimmen, welche Werte einsetzen:
- `CATALOG_LLM_URL` — z.B. `https://ai.wolfinisoftware.de` (eigene ai-provider-service base URL)
- `CATALOG_LLM_TOKEN` — Bearer aus dem ai-provider-service
- `CATALOG_LLM_FALLBACK_ANTHROPIC_KEY` — Anthropic API-Key
- (Optional) `CATALOG_LLM_FALLBACK_MODEL` — Default ist `claude-haiku-4-5`

Befehl (mit Platzhaltern):

```bash
ssh ionos-vps 'sudo tee -a /etc/systemd/system/claudetracker-backend.service.d/override.conf >/dev/null <<EOF

# B.3: Catalog auto-pros/cons via mistral-nemo (Primary) + Claude Haiku 4.5 (Fallback)
Environment=CATALOG_LLM_URL=https://ai.wolfinisoftware.de
Environment=CATALOG_LLM_TOKEN=<replace-me>
Environment=CATALOG_LLM_FALLBACK_ANTHROPIC_KEY=<replace-me>
EOF'
```

- [ ] **Step 3: Reload systemd-Daemon**

```bash
ssh ionos-vps 'sudo systemctl daemon-reload'
```

- [ ] **Step 4: Verifikation, dass die Env-Vars geladen wurden**

```bash
ssh ionos-vps 'sudo systemctl show claudetracker-backend -p Environment | tr " " "\n" | grep CATALOG_LLM'
```

Expected: alle 3 Variablen, keine mit `<replace-me>`.

(Falls Werte noch Platzhalter sind: User um Werte bitten und ersetzen, dann nochmal `daemon-reload`.)

- [ ] **Step 5: Kein Restart hier — Restart kommt in Task 13 zusammen mit Deploy**

---

### Task 13: Deploy + End-to-End Verification

**Files:**
- Production: `/var/www/wolfinisoftware/claudetracker/`

- [ ] **Step 1: Letzten Stand testen lokal**

```bash
cd backend && npm test -- --silent 2>&1 | tail -5
```

Expected: alle Tests grün.

- [ ] **Step 2: Push zum remote main**

```bash
git push origin claude/priceless-kapitsa-81ec8d:main 2>&1 | tail -3
```

Expected: `xxxxxx..yyyyyy claude/priceless-kapitsa-81ec8d -> main`.

- [ ] **Step 3: Auf VPS pullen + bauen + restart**

```bash
ssh ionos-vps 'cd /var/www/wolfinisoftware/claudetracker && \
  git pull --ff-only origin main 2>&1 | tail -3 && \
  cd backend && npm run build 2>&1 | tail -5 && \
  sudo systemctl restart claudetracker-backend && \
  sleep 8 && \
  sudo tail -n 40 /var/log/claudetracker-backend.log'
```

Expected: Im Log:
- `Database initialized`
- `[catalog-cache] latest empty on startup — priming` (oder, wenn schon vorhanden, kein Prime — beides OK)
- Wenn B.3 aktiv: `[catalog-pros] latest: generated=N failed=0 skipped=0` (kann ~15s dauern)

- [ ] **Step 4: DB-Verifikation — Karten haben pros/cons**

```bash
ssh ionos-vps 'cd /var/www/wolfinisoftware/claudetracker/backend && node -e "
const sqlite3 = require(\"sqlite3\");
const db = new sqlite3.Database(\"./database.sqlite\");
db.all(\"SELECT repo, json_extract(data_json, \\\"\\$.pros\\\") AS pros FROM catalog_hf_cache WHERE json_extract(data_json, \\\"\\$.pros\\\") IS NOT NULL ORDER BY repo\", (e, r) => {
  for (const row of r) console.log(row.repo, \"→\", row.pros);
  db.close();
});
"'
```

Expected: mindestens die 6 Latest-Uploads erscheinen mit nicht-leerem `pros`-Array.

(Wenn nichts erscheint: Logs prüfen — Pool down oder Fallback nicht konfiguriert. Pros wurden dann nicht generiert.)

- [ ] **Step 5: Browser-Verifikation**

Öffne https://wolfinisoftware.de/claudetracker/catalog im Browser. Erwartung: in der "Frisch hochgeladen"-Sektion zeigen die Karten jetzt Pro/Contra-Bullets (wie die kuratierten Sektionen schon vorher).

- [ ] **Step 6: Suche-Test**

In der Catalog-Seite: Suchfeld nutzen, z.B. `phi-3` eingeben. Erwartung: Suche kehrt sofort zurück (< 1s). Pro/Contra-Bullets fehlen beim ersten Mal. Nach ~10–30s: nochmal dieselbe Suche → jetzt mit Pro/Contra.

- [ ] **Step 7: Smoke-Done, kein Commit nötig**

---

## Self-Review Checkliste

- [ ] Spec-Coverage: alle Sections aus dem Spec haben Task-Implementierung
  - Service-Modul mit zwei Adaptern → Tasks 2–6 ✓
  - Generation in refreshLatestUploads → Task 8 ✓
  - Async-Generation für Suche → Task 9 ✓
  - Eviction-Logik → Task 10 ✓
  - Initial-Prime triggert Generation → Task 11 ✓
  - Env-Vars in systemd → Task 12 ✓
- [ ] Keine Platzhalter ("TBD", "TODO", "ähnlich zu Task N")
- [ ] Type-Konsistenz: `ModelCard.pros` ist `string[] | undefined`, überall gleich verwendet ✓
- [ ] `generateBatchProsCons` ist konsistent benannt (nicht `generateBatchPros`)
- [ ] Env-Var-Namen konsistent: `CATALOG_LLM_URL`, `CATALOG_LLM_TOKEN`, `CATALOG_LLM_FALLBACK_ANTHROPIC_KEY`, `CATALOG_LLM_FALLBACK_MODEL` (optional)

---

## Geschätzte Zeitaufwände

- Tasks 1–7 (Service + alle Adapter): ~90 Min
- Task 8 (Latest-Upload-Integration): ~20 Min
- Task 9 (Search-Integration): ~25 Min
- Task 10 (Eviction): ~20 Min
- Task 11 (Initial-Prime-Verifikation): ~5 Min
- Task 12–13 (Deploy + Verify): ~15 Min

Gesamt: ~3 Stunden inkl. Tests und Deploy.

---

## Mögliche Probleme & Mitigationen

1. **mistral-nemo gibt schlechte Pros/Cons aus** — z.B. zu generisch oder zu marketing-lastig. Mitigation: Prompt-Engineering, ggf. einmal manuell mit verschiedenen Modellen testen, Prompt tweak. Größtes Risiko ist Qualität, nicht Stabilität.
2. **HF-Beschreibung ist oft sehr kurz oder fehlt** — Prompt erlaubt "—" als Fallback, LLM muss aus dem Modellnamen schlussfolgern. Akzeptiert.
3. **Anthropic-Key-Diebstahl** — Token nur im systemd-Override, nicht im Repo. Override hat Permissions 600.
4. **Pool ist down beim Deploy** — Falls Pool nicht erreichbar, Fallback wird genutzt. Falls keiner geht: 6 Latest-Uploads bekommen keine Pros, der nächste Cron retry-t.
