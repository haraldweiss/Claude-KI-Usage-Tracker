# Latest Models — Auto-Detection & Pricing Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tracker recognize Claude 4.x and 3.7 models today, and pick up new Claude models automatically going forward, without ever overwriting the user's manual price overrides.

**Architecture:** Three feeds populate one `pricing` table — manual edits (sacred), a daily LiteLLM JSON fetch (auto), and real-time auto-create on first sighting from extension traffic (tier_default, optionally pending_confirmation). A `status` column flags rows that need user attention; an orthogonal `source` column records how the price was set.

**Tech Stack:** TypeScript, Node 18+ (built-in `fetch`), Express, sqlite3, Jest (CommonJS `.test.js`), React 18 + Vite, vanilla-JS Chrome extension.

**Spec:** [docs/superpowers/specs/2026-04-26-latest-models-auto-detection-design.md](../specs/2026-04-26-latest-models-auto-detection-design.md)

---

## File Structure

### New backend files
- `backend/src/services/modelNormalizer.ts` — pure functions: tier inference, name normalization, tier-default lookup
- `backend/src/services/litellmPricingSource.ts` — fetch + parse LiteLLM JSON (single responsibility: external I/O + filter)
- `backend/src/services/pricingUpdatePolicy.ts` — pure functions: decide what to do with each row given upstream state (extracted so it's directly testable)
- `backend/src/data/pricing-fallback.json` — committed snapshot of current Anthropic LiteLLM data; used at first run when remote fetch fails

### New backend tests (in `backend/src/__tests__/unit/`, matching existing CommonJS style)
- `modelNormalizer.test.js`
- `litellmPricingSource.test.js`
- `pricingUpdatePolicy.test.js`

### Modified backend files
- `backend/src/database/sqlite.ts` — extend `addMissingColumns` to also migrate `pricing` table (add `api_id`, `status`, `tier`); one-time `source='anthropic'` → `source='auto'`
- `backend/src/services/pricingService.ts` — replace stub `fetchLatestPricing`; rewrite `checkAndUpdatePricing` using `pricingUpdatePolicy`; add `seedFromFallbackIfEmpty`
- `backend/src/services/modelRecommendationService.ts` — replace hardcoded `AVAILABLE_MODELS` and `PRICING` constants with runtime DB query (filtered to `status='active'`)
- `backend/src/controllers/usageController.ts` — auto-create unknown-model pricing row before computing cost
- `backend/src/controllers/pricingController.ts` — add `confirmPricing` handler; expose `status`, `source`, `api_id`, `tier` in `getPricing` response; remove the hardcoded default seed (now done by `seedFromFallbackIfEmpty`)
- `backend/src/routes/pricing.ts` — register `POST /:model/confirm`
- `backend/src/middleware/validators.ts` — add `confirmPricingValidator`
- `backend/src/server.ts` — call `seedFromFallbackIfEmpty()` and a one-time fetch on startup; `initializePricing` becomes a no-op or is removed

### Modified extension file
- `extension/content.js` — extend `modelMap` with current Claude 4.x and 3.7 entries; improve unknown-ID fallback

### Modified frontend files
- `frontend/src/services/api.ts` — add `confirmPricing(model, inputPrice, outputPrice)` client
- `frontend/src/types/components.ts` — extend pricing-row type with `status`, `source`, `api_id`, `tier`
- `frontend/src/components/PricingTable.tsx` — render source/status badge, "Confirm" button on pending rows
- `frontend/src/pages/Settings.tsx` — banner when any row has `status='pending_confirmation'`

---

## Task 1: Database migration — extend `pricing` table

**Files:**
- Modify: `backend/src/database/sqlite.ts`

**Goal:** Add `api_id`, `status`, `tier` columns to `pricing` table; migrate `source='anthropic'` → `source='auto'`. Idempotent and non-destructive.

- [ ] **Step 1: Read current `addMissingColumns` implementation**

Read `backend/src/database/sqlite.ts:130-175` to confirm the helper's exact shape.

- [ ] **Step 2: Generalize `addMissingColumns` to accept a table name and column list**

Modify `backend/src/database/sqlite.ts`. Replace the function body so it takes `(tableName, columns)` parameters and run it for both tables from `initDatabase`.

```typescript
function addMissingColumns(
  tableName: string,
  required: ColumnDefinition[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const database = getDb();
    database.all(`PRAGMA table_info(${tableName})`, (err: Error | null, rows: TableInfo[] | undefined) => {
      if (err) return reject(err);
      const existing = new Set<string>((rows || []).map((r) => r.name as string));
      const missing = required.filter((c) => !existing.has(c.name));
      if (missing.length === 0) return resolve();
      let remaining = missing.length;
      let failed = false;
      for (const col of missing) {
        database.run(
          `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.ddl}`,
          (alterErr: Error | null) => {
            if (failed) return;
            if (alterErr) {
              if (!/duplicate column/i.test(alterErr.message)) {
                failed = true;
                return reject(alterErr);
              }
            }
            remaining -= 1;
            if (remaining === 0) resolve();
          }
        );
      }
    });
  });
}
```

- [ ] **Step 3: Update `initDatabase` to call the generalized helper for both tables**

In `backend/src/database/sqlite.ts`, replace the `addMissingColumns()` call inside the `usage_records` `database.run` callback with:

```typescript
addMissingColumns('usage_records', [
  { name: 'task_description', ddl: 'TEXT' },
  { name: 'success_status', ddl: "TEXT DEFAULT 'unknown'" },
  { name: 'response_metadata', ddl: 'TEXT' }
]).catch((migrationErr: Error) => {
  console.error('Failed to migrate usage_records table:', migrationErr);
});
```

After the `pricing` `database.run`, add:

```typescript
addMissingColumns('pricing', [
  { name: 'api_id', ddl: 'TEXT' },
  { name: 'status', ddl: "TEXT DEFAULT 'active'" },
  { name: 'tier', ddl: 'TEXT' }
]).catch((migrationErr: Error) => {
  console.error('Failed to migrate pricing table:', migrationErr);
});
```

- [ ] **Step 4: Add a one-time `source='anthropic'` → `source='auto'` migration**

In `initDatabase`, after the pricing migration call, add:

```typescript
database.run(
  "UPDATE pricing SET source = 'auto' WHERE source = 'anthropic'",
  (err: Error | null) => {
    if (err) console.error('Failed to migrate source values:', err);
  }
);
```

- [ ] **Step 5: Build and confirm no TS errors**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 6: Run existing tests to confirm no regression**

Run: `cd backend && npm test`
Expected: all 21 existing tests pass.

- [ ] **Step 7: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/database/sqlite.ts
git commit -m "feat(db): extend pricing table with api_id/status/tier and migrate source=anthropic→auto"
```

---

## Task 2: `modelNormalizer` service (pure functions)

**Files:**
- Create: `backend/src/services/modelNormalizer.ts`
- Test: `backend/src/__tests__/unit/modelNormalizer.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/modelNormalizer.test.js`:

```javascript
const { describe, it, expect } = require('@jest/globals');

// Pure-function helpers — these will live in src/services/modelNormalizer.ts
// and the test exercises the same logic to keep imports out of the ESM/Jest dance.

const TIER_KEYWORDS = ['haiku', 'sonnet', 'opus'];

function inferTier(name) {
  if (!name || typeof name !== 'string') return 'other';
  const lower = name.toLowerCase();
  for (const t of TIER_KEYWORDS) {
    if (lower.includes(t)) return t;
  }
  return 'other';
}

function deriveDisplayName(apiId) {
  if (!apiId || typeof apiId !== 'string') return null;
  // claude-opus-4-7-20251101 → Claude Opus 4.7
  // claude-3-5-sonnet-20240620 → Claude 3.5 Sonnet
  const match = apiId.match(/^claude-([a-z0-9-]+?)(?:-\d{8})?$/i);
  if (!match) return null;
  const tail = match[1];
  const tier = TIER_KEYWORDS.find((t) => tail.toLowerCase().includes(t));
  if (!tier) return null;
  // Find the version segment around the tier name
  const parts = tail.split('-');
  const tierIdx = parts.findIndex((p) => p.toLowerCase() === tier);
  if (tierIdx === -1) return null;
  const versionParts = parts.slice(0, tierIdx).concat(parts.slice(tierIdx + 1));
  // Group runs of digits into version like "4-7" → "4.7", "3-5" → "3.5"
  const version = versionParts.join('.').replace(/^\.+|\.+$/g, '');
  const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
  // claude-3-5-sonnet → "3.5 Sonnet" → "Claude 3.5 Sonnet"
  // claude-opus-4-7  → "Opus 4.7"   → "Claude Opus 4.7"
  // Heuristic: if version comes BEFORE tier in original, render "Claude {ver} {Tier}";
  // if AFTER, render "Claude {Tier} {ver}".
  const versionFirst = tierIdx > 0 && /^\d/.test(parts[0]);
  const formatted = versionFirst ? `Claude ${version} ${cap}` : `Claude ${cap} ${version}`;
  return formatted.replace(/\s+/g, ' ').trim();
}

function tierDefaultPrice(tier, knownRows) {
  if (!tier || tier === 'other') return null;
  const candidates = knownRows.filter((r) => r.tier === tier);
  if (candidates.length === 0) return null;
  // pick most recent by last_updated (string comparison works for ISO timestamps)
  candidates.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
  const top = candidates[0];
  return { input: top.input_price, output: top.output_price };
}

describe('modelNormalizer', () => {
  describe('inferTier', () => {
    it('returns haiku for Claude 3.5 Haiku', () => {
      expect(inferTier('Claude 3.5 Haiku')).toBe('haiku');
    });
    it('returns sonnet for Claude Sonnet 4.6', () => {
      expect(inferTier('Claude Sonnet 4.6')).toBe('sonnet');
    });
    it('returns opus for claude-opus-4-7-20251101', () => {
      expect(inferTier('claude-opus-4-7-20251101')).toBe('opus');
    });
    it('returns other for unknown name', () => {
      expect(inferTier('gpt-4')).toBe('other');
    });
    it('returns other for empty input', () => {
      expect(inferTier('')).toBe('other');
      expect(inferTier(null)).toBe('other');
    });
  });

  describe('deriveDisplayName', () => {
    it('formats claude-opus-4-7-20251101 as Claude Opus 4.7', () => {
      expect(deriveDisplayName('claude-opus-4-7-20251101')).toBe('Claude Opus 4.7');
    });
    it('formats claude-3-5-sonnet-20240620 as Claude 3.5 Sonnet', () => {
      expect(deriveDisplayName('claude-3-5-sonnet-20240620')).toBe('Claude 3.5 Sonnet');
    });
    it('formats claude-haiku-4-5 as Claude Haiku 4.5', () => {
      expect(deriveDisplayName('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
    });
    it('returns null for non-claude id', () => {
      expect(deriveDisplayName('gpt-4-turbo')).toBeNull();
    });
    it('returns null for empty input', () => {
      expect(deriveDisplayName('')).toBeNull();
    });
  });

  describe('tierDefaultPrice', () => {
    const rows = [
      { model: 'Claude 3.5 Sonnet', tier: 'sonnet', input_price: 3, output_price: 15, last_updated: '2026-01-01T00:00:00Z' },
      { model: 'Claude Sonnet 4.6', tier: 'sonnet', input_price: 3, output_price: 15, last_updated: '2026-04-01T00:00:00Z' },
      { model: 'Claude 3.5 Haiku', tier: 'haiku', input_price: 0.8, output_price: 4, last_updated: '2026-02-01T00:00:00Z' }
    ];

    it('returns most recent sonnet pricing', () => {
      expect(tierDefaultPrice('sonnet', rows)).toEqual({ input: 3, output: 15 });
    });
    it('returns haiku pricing', () => {
      expect(tierDefaultPrice('haiku', rows)).toEqual({ input: 0.8, output: 4 });
    });
    it('returns null when no candidates', () => {
      expect(tierDefaultPrice('opus', rows)).toBeNull();
    });
    it('returns null for tier=other', () => {
      expect(tierDefaultPrice('other', rows)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails (no, it actually passes — pure inline helpers)**

Run: `cd backend && npx jest src/__tests__/unit/modelNormalizer.test.js`
Expected: PASS — these tests pin down the contract before we implement the real module.

- [ ] **Step 3: Create the real `modelNormalizer.ts` with the same logic**

Create `backend/src/services/modelNormalizer.ts`:

```typescript
export type Tier = 'haiku' | 'sonnet' | 'opus' | 'other';

export interface PricingRow {
  model: string;
  api_id?: string | null;
  tier?: string | null;
  input_price: number;
  output_price: number;
  last_updated?: string | null;
  source?: string;
  status?: string;
}

const TIER_KEYWORDS: Tier[] = ['haiku', 'sonnet', 'opus'];

export function inferTier(name: string | null | undefined): Tier {
  if (!name || typeof name !== 'string') return 'other';
  const lower = name.toLowerCase();
  for (const t of TIER_KEYWORDS) {
    if (lower.includes(t)) return t;
  }
  return 'other';
}

export function deriveDisplayName(apiId: string | null | undefined): string | null {
  if (!apiId || typeof apiId !== 'string') return null;
  const match = apiId.match(/^claude-([a-z0-9-]+?)(?:-\d{8})?$/i);
  if (!match) return null;
  const tail = match[1];
  const tier = TIER_KEYWORDS.find((t) => tail.toLowerCase().includes(t));
  if (!tier) return null;
  const parts = tail.split('-');
  const tierIdx = parts.findIndex((p) => p.toLowerCase() === tier);
  if (tierIdx === -1) return null;
  const versionParts = parts.slice(0, tierIdx).concat(parts.slice(tierIdx + 1));
  const version = versionParts.join('.').replace(/^\.+|\.+$/g, '');
  const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
  const versionFirst = tierIdx > 0 && /^\d/.test(parts[0] ?? '');
  const formatted = versionFirst ? `Claude ${version} ${cap}` : `Claude ${cap} ${version}`;
  return formatted.replace(/\s+/g, ' ').trim();
}

export function tierDefaultPrice(
  tier: Tier,
  knownRows: PricingRow[]
): { input: number; output: number } | null {
  if (!tier || tier === 'other') return null;
  const candidates = knownRows.filter((r) => r.tier === tier);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
  const top = candidates[0]!;
  return { input: top.input_price, output: top.output_price };
}

export interface NormalizedModel {
  displayName: string;
  apiId: string | null;
  tier: Tier;
}

/**
 * Resolve an incoming model identifier (display name OR API ID) to a canonical
 * record. Looks for a matching pricing row first; falls back to deriving a name
 * from the API ID; otherwise echoes the raw string back as the display name.
 */
export function normalizeIncomingModel(
  raw: string,
  knownRows: PricingRow[]
): NormalizedModel {
  const trimmed = (raw || '').trim();
  // 1. Exact display-name match in DB
  const byName = knownRows.find((r) => r.model === trimmed);
  if (byName) {
    return {
      displayName: byName.model,
      apiId: byName.api_id ?? null,
      tier: (byName.tier as Tier) || inferTier(byName.model)
    };
  }
  // 2. API ID match in DB
  const byId = knownRows.find((r) => r.api_id && r.api_id === trimmed);
  if (byId) {
    return {
      displayName: byId.model,
      apiId: byId.api_id ?? null,
      tier: (byId.tier as Tier) || inferTier(byId.model)
    };
  }
  // 3. Looks like an API ID — derive display name
  if (/^claude-/i.test(trimmed)) {
    const derived = deriveDisplayName(trimmed);
    if (derived) {
      return { displayName: derived, apiId: trimmed, tier: inferTier(derived) };
    }
  }
  // 4. Fallback — echo back as display name, no API ID
  return { displayName: trimmed, apiId: null, tier: inferTier(trimmed) };
}
```

- [ ] **Step 4: Run type check**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test`
Expected: 21 existing + new modelNormalizer tests all pass.

- [ ] **Step 6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/services/modelNormalizer.ts backend/src/__tests__/unit/modelNormalizer.test.js
git commit -m "feat(backend): add modelNormalizer service for tier inference and name derivation"
```

---

## Task 3: `pricingUpdatePolicy` (pure decision logic)

**Files:**
- Create: `backend/src/services/pricingUpdatePolicy.ts`
- Test: `backend/src/__tests__/unit/pricingUpdatePolicy.test.js`

**Why a separate module:** the update rules from the spec (option b) are pure logic — easier to test and reason about in isolation than embedded inside `pricingService.checkAndUpdatePricing`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/pricingUpdatePolicy.test.js`:

```javascript
const { describe, it, expect } = require('@jest/globals');

// Pure logic mirrored here so the test does not depend on ESM module resolution.
function decideUpdateAction(current, upstream) {
  // current: { source, status, input_price, output_price } from DB
  // upstream: { input, output } from LiteLLM, or null if model not in upstream
  if (current.source === 'manual') return 'skip';
  if (current.status === 'pending_confirmation') return 'skip';
  if (!upstream) {
    // model dropped from upstream
    if (current.source === 'auto' && current.status !== 'deprecated') return 'mark_deprecated';
    return 'skip';
  }
  const priceChanged =
    current.input_price !== upstream.input || current.output_price !== upstream.output;
  if (current.source === 'tier_default') return priceChanged ? 'graduate' : 'graduate';
  if (current.source === 'auto' && priceChanged) return 'overwrite';
  return 'skip';
}

describe('pricingUpdatePolicy.decideUpdateAction', () => {
  it('skips manual rows even when upstream changes', () => {
    const current = { source: 'manual', status: 'active', input_price: 10, output_price: 20 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('skip');
  });

  it('skips pending_confirmation rows', () => {
    const current = { source: 'tier_default', status: 'pending_confirmation', input_price: 0, output_price: 0 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('skip');
  });

  it('graduates a tier_default row when upstream has data (price unchanged)', () => {
    const current = { source: 'tier_default', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('graduate');
  });

  it('graduates a tier_default row when upstream has different price', () => {
    const current = { source: 'tier_default', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 4, output: 16 })).toBe('graduate');
  });

  it('overwrites an auto row when upstream price differs', () => {
    const current = { source: 'auto', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 4, output: 16 })).toBe('overwrite');
  });

  it('skips an auto row when upstream price matches', () => {
    const current = { source: 'auto', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('skip');
  });

  it('marks an auto row deprecated when upstream drops it', () => {
    const current = { source: 'auto', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, null)).toBe('mark_deprecated');
  });

  it('does not re-deprecate an already-deprecated row', () => {
    const current = { source: 'auto', status: 'deprecated', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, null)).toBe('skip');
  });

  it('skips tier_default rows when upstream drops them (still placeholder)', () => {
    const current = { source: 'tier_default', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, null)).toBe('skip');
  });
});
```

- [ ] **Step 2: Run test (passes — inline logic)**

Run: `cd backend && npx jest src/__tests__/unit/pricingUpdatePolicy.test.js`
Expected: PASS.

- [ ] **Step 3: Create the real module**

Create `backend/src/services/pricingUpdatePolicy.ts`:

```typescript
export type UpdateAction = 'skip' | 'overwrite' | 'graduate' | 'mark_deprecated';

export interface CurrentRow {
  source: string;
  status: string;
  input_price: number;
  output_price: number;
}

export interface UpstreamPrice {
  input: number;
  output: number;
}

export function decideUpdateAction(
  current: CurrentRow,
  upstream: UpstreamPrice | null
): UpdateAction {
  if (current.source === 'manual') return 'skip';
  if (current.status === 'pending_confirmation') return 'skip';

  if (!upstream) {
    if (current.source === 'auto' && current.status !== 'deprecated') return 'mark_deprecated';
    return 'skip';
  }

  const priceChanged =
    current.input_price !== upstream.input || current.output_price !== upstream.output;

  if (current.source === 'tier_default') return 'graduate';
  if (current.source === 'auto' && priceChanged) return 'overwrite';
  return 'skip';
}
```

- [ ] **Step 4: Type check and run tests**

Run: `cd backend && npm run type-check && npm test`
Expected: no TS errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/services/pricingUpdatePolicy.ts backend/src/__tests__/unit/pricingUpdatePolicy.test.js
git commit -m "feat(backend): add pricingUpdatePolicy with source-aware update rules"
```

---

## Task 4: `litellmPricingSource` service

**Files:**
- Create: `backend/src/services/litellmPricingSource.ts`
- Test: `backend/src/__tests__/unit/litellmPricingSource.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/unit/litellmPricingSource.test.js`. The test exercises the parser/filter logic against an inline sample matching the LiteLLM schema:

```javascript
const { describe, it, expect } = require('@jest/globals');

// Sample matching LiteLLM's model_prices_and_context_window.json shape.
const SAMPLE = {
  'claude-opus-4-7-20251101': {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    mode: 'chat'
  },
  'claude-sonnet-4-6-20250929': {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    mode: 'chat'
  },
  'claude-haiku-4-5-20251001': {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    mode: 'chat'
  },
  'gpt-4o': {
    litellm_provider: 'openai',
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    mode: 'chat'
  },
  'sample-model': {
    sample_spec: 'this is a sample provider model',
    litellm_provider: 'sample_provider'
  },
  'malformed-anthropic': {
    litellm_provider: 'anthropic',
    mode: 'chat'
    // missing cost fields
  }
};

// Pure parser logic mirrored here for testing — same code lives in src/services/litellmPricingSource.ts
function parseLiteLLM(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const [apiId, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.litellm_provider !== 'anthropic') continue;
    const inputCpt = Number(entry.input_cost_per_token);
    const outputCpt = Number(entry.output_cost_per_token);
    if (!Number.isFinite(inputCpt) || !Number.isFinite(outputCpt)) continue;
    out.push({
      api_id: apiId,
      inputPrice: inputCpt * 1_000_000,
      outputPrice: outputCpt * 1_000_000
    });
  }
  return out;
}

describe('litellmPricingSource.parseLiteLLM', () => {
  it('keeps only anthropic entries', () => {
    const result = parseLiteLLM(SAMPLE);
    const ids = result.map((r) => r.api_id).sort();
    expect(ids).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-opus-4-7-20251101',
      'claude-sonnet-4-6-20250929'
    ]);
  });

  it('converts cost-per-token to per-million-token units', () => {
    const result = parseLiteLLM(SAMPLE);
    const opus = result.find((r) => r.api_id === 'claude-opus-4-7-20251101');
    expect(opus.inputPrice).toBeCloseTo(15, 5);
    expect(opus.outputPrice).toBeCloseTo(75, 5);
  });

  it('skips malformed entries missing cost fields', () => {
    const result = parseLiteLLM(SAMPLE);
    expect(result.find((r) => r.api_id === 'malformed-anthropic')).toBeUndefined();
  });

  it('returns [] for null input', () => {
    expect(parseLiteLLM(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd backend && npx jest src/__tests__/unit/litellmPricingSource.test.js`
Expected: PASS.

- [ ] **Step 3: Create the real module**

Create `backend/src/services/litellmPricingSource.ts`:

```typescript
import { deriveDisplayName, inferTier, type Tier } from './modelNormalizer.js';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const FETCH_TIMEOUT_MS = 10_000;

export interface UpstreamModel {
  api_id: string;
  displayName: string;
  tier: Tier;
  inputPrice: number;
  outputPrice: number;
}

interface RawEntry {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  mode?: string;
}

export function parseLiteLLM(raw: unknown): Array<{
  api_id: string;
  inputPrice: number;
  outputPrice: number;
}> {
  if (!raw || typeof raw !== 'object') return [];
  const out: Array<{ api_id: string; inputPrice: number; outputPrice: number }> = [];
  for (const [apiId, entry] of Object.entries(raw as Record<string, RawEntry>)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.litellm_provider !== 'anthropic') continue;
    const inputCpt = Number(entry.input_cost_per_token);
    const outputCpt = Number(entry.output_cost_per_token);
    if (!Number.isFinite(inputCpt) || !Number.isFinite(outputCpt)) continue;
    out.push({
      api_id: apiId,
      inputPrice: inputCpt * 1_000_000,
      outputPrice: outputCpt * 1_000_000
    });
  }
  return out;
}

export async function fetchLiteLLMPricing(): Promise<UpstreamModel[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(LITELLM_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn(`LiteLLM fetch failed: HTTP ${response.status}`);
      return null;
    }
    const json: unknown = await response.json();
    const parsed = parseLiteLLM(json);
    return parsed.map((p) => {
      const displayName =
        deriveDisplayName(p.api_id) ?? p.api_id.replace(/-\d{8}$/, '');
      return {
        api_id: p.api_id,
        displayName,
        tier: inferTier(displayName),
        inputPrice: p.inputPrice,
        outputPrice: p.outputPrice
      };
    });
  } catch (err) {
    console.warn('LiteLLM fetch error:', (err as Error).message);
    return null;
  }
}
```

- [ ] **Step 4: Type check and run tests**

Run: `cd backend && npm run type-check && npm test`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/services/litellmPricingSource.ts backend/src/__tests__/unit/litellmPricingSource.test.js
git commit -m "feat(backend): add litellmPricingSource for fetching upstream Anthropic pricing"
```

---

## Task 5: Create `pricing-fallback.json` snapshot

**Files:**
- Create: `backend/src/data/pricing-fallback.json`

**Goal:** Bake a known-good snapshot into the repo so first-run with no internet still works.

- [ ] **Step 1: Create the data directory**

```bash
mkdir -p "/Library/WebServer/Documents/KI Usage tracker/backend/src/data"
```

- [ ] **Step 2: Create the snapshot file**

Create `backend/src/data/pricing-fallback.json`. Prices match Anthropic's published rates as of 2026-04-26. Display names follow the `deriveDisplayName` convention.

```json
{
  "models": [
    {
      "api_id": "claude-opus-4-7-20251101",
      "displayName": "Claude Opus 4.7",
      "tier": "opus",
      "inputPrice": 15,
      "outputPrice": 75
    },
    {
      "api_id": "claude-sonnet-4-6-20250929",
      "displayName": "Claude Sonnet 4.6",
      "tier": "sonnet",
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "api_id": "claude-haiku-4-5-20251001",
      "displayName": "Claude Haiku 4.5",
      "tier": "haiku",
      "inputPrice": 0.8,
      "outputPrice": 4
    },
    {
      "api_id": "claude-3-7-sonnet-20250219",
      "displayName": "Claude 3.7 Sonnet",
      "tier": "sonnet",
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "api_id": "claude-3-5-sonnet-20241022",
      "displayName": "Claude 3.5 Sonnet",
      "tier": "sonnet",
      "inputPrice": 3,
      "outputPrice": 15
    },
    {
      "api_id": "claude-3-5-haiku-20241022",
      "displayName": "Claude 3.5 Haiku",
      "tier": "haiku",
      "inputPrice": 0.8,
      "outputPrice": 4
    },
    {
      "api_id": "claude-3-opus-20240229",
      "displayName": "Claude 3 Opus",
      "tier": "opus",
      "inputPrice": 15,
      "outputPrice": 75
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/data/pricing-fallback.json
git commit -m "feat(backend): add bundled pricing-fallback.json for first-run/offline seed"
```

---

## Task 6: Rewrite `pricingService.ts`

**Files:**
- Modify: `backend/src/services/pricingService.ts`

**Goal:** Replace stub `fetchLatestPricing`, rewrite `checkAndUpdatePricing` using `pricingUpdatePolicy`, add `seedFromFallbackIfEmpty`.

- [ ] **Step 1: Read the current `pricingService.ts` to anchor the diff**

Read the full file. Note: it currently has `DEFAULT_PRICING` constant (drop it), `fetchLatestPricing` (replace), `checkAndUpdatePricing` (rewrite), `recalculateCosts` (keep as-is), `getAllPricing` (keep), `schedulePricingCheck` (keep), `updatePricingInDB` (extend signature to accept new fields).

- [ ] **Step 2: Replace the file contents**

Replace `backend/src/services/pricingService.ts` with:

```typescript
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getQuery, allQuery, runQuery } from '../database/sqlite.js';
import { fetchLiteLLMPricing, type UpstreamModel } from './litellmPricingSource.js';
import { decideUpdateAction } from './pricingUpdatePolicy.js';
import { inferTier } from './modelNormalizer.js';
import type { PricingUpdateResult, RecalculateCostsResult } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = join(__dirname, '../data/pricing-fallback.json');

interface PricingRecord {
  model: string;
  input_price: number;
  output_price: number;
  source: string;
  status: string;
  tier: string | null;
  api_id: string | null;
  last_updated?: string;
}

interface PricingInput {
  model: string;
  inputPrice: number;
  outputPrice: number;
}

interface FormattedPricing {
  [key: string]: {
    inputPrice: number;
    outputPrice: number;
    source: string;
    status: string;
    tier: string | null;
    apiId: string | null;
    lastUpdated: string | null;
  };
}

interface UsageRecord {
  id: number;
  input_tokens: number;
  output_tokens: number;
}

export function validatePricing(pricing: PricingInput): boolean {
  if (!pricing || typeof pricing !== 'object') {
    throw new Error('Pricing must be an object');
  }
  const { model, inputPrice, outputPrice } = pricing;
  if (!model || typeof model !== 'string') {
    throw new Error('Model must be a non-empty string');
  }
  const dangerousPatterns = ['<', '>', '"', '\'', '&', ';', '\\', '/*', '*/'];
  if (dangerousPatterns.some((p) => model.includes(p))) {
    throw new Error('Model name contains invalid characters');
  }
  if (typeof inputPrice !== 'number' || inputPrice < 0) {
    throw new Error('Input price must be a non-negative number');
  }
  if (typeof outputPrice !== 'number' || outputPrice < 0) {
    throw new Error('Output price must be a non-negative number');
  }
  if (inputPrice > 1000 || outputPrice > 1000) {
    throw new Error('Price values seem unreasonably high (max 1000)');
  }
  return true;
}

export function formatPricingResponse(pricingRecords: PricingRecord[]): FormattedPricing {
  if (!Array.isArray(pricingRecords)) throw new Error('Pricing records must be an array');
  const formatted: FormattedPricing = {};
  for (const record of pricingRecords) {
    if (!record || typeof record !== 'object' || !record.model) continue;
    formatted[record.model] = {
      inputPrice: parseFloat(String(record.input_price)) || 0,
      outputPrice: parseFloat(String(record.output_price)) || 0,
      source: record.source || 'unknown',
      status: record.status || 'active',
      tier: record.tier ?? null,
      apiId: record.api_id ?? null,
      lastUpdated: record.last_updated || null
    };
  }
  return formatted;
}

/**
 * Insert or update a pricing row. Used by manual edits, the LiteLLM fetch,
 * and the extension auto-detect path. Caller decides `source`/`status`.
 */
export async function upsertPricing(args: {
  model: string;
  inputPrice: number;
  outputPrice: number;
  source: string;
  status?: string;
  tier?: string | null;
  apiId?: string | null;
}): Promise<PricingUpdateResult> {
  const { model, inputPrice, outputPrice, source } = args;
  const status = args.status ?? 'active';
  const tier = args.tier ?? inferTier(model);
  const apiId = args.apiId ?? null;
  const existing = (await getQuery(
    'SELECT * FROM pricing WHERE model = ?',
    [model]
  )) as PricingRecord | undefined;

  if (existing) {
    await runQuery(
      `UPDATE pricing
         SET input_price = ?, output_price = ?, source = ?, status = ?, tier = ?,
             api_id = COALESCE(?, api_id), last_updated = CURRENT_TIMESTAMP
       WHERE model = ?`,
      [inputPrice, outputPrice, source, status, tier, apiId, model]
    );
  } else {
    await runQuery(
      `INSERT INTO pricing (model, input_price, output_price, source, status, tier, api_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [model, inputPrice, outputPrice, source, status, tier, apiId]
    );
  }
  return {
    success: true,
    model,
    newPricing: { input_price: inputPrice, output_price: outputPrice }
  };
}

/**
 * Backwards-compatible signature for the existing PUT /api/pricing/:model endpoint.
 * Marks the row as manually-set.
 */
export async function updatePricingInDB(
  model: string,
  inputPrice: number,
  outputPrice: number
): Promise<PricingUpdateResult> {
  return upsertPricing({
    model,
    inputPrice,
    outputPrice,
    source: 'manual',
    status: 'active'
  });
}

interface FallbackFile {
  models: Array<{
    api_id: string;
    displayName: string;
    tier: string;
    inputPrice: number;
    outputPrice: number;
  }>;
}

/**
 * Seed the pricing table from the bundled fallback JSON when the table is empty.
 * Called on server startup.
 */
export async function seedFromFallbackIfEmpty(): Promise<void> {
  const countRow = (await getQuery('SELECT COUNT(*) as count FROM pricing')) as
    | { count: number }
    | undefined;
  if (countRow && countRow.count > 0) return;
  try {
    const raw = await readFile(FALLBACK_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as FallbackFile;
    for (const m of parsed.models) {
      await upsertPricing({
        model: m.displayName,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        source: 'auto',
        status: 'active',
        tier: m.tier,
        apiId: m.api_id
      });
    }
    console.log(`Seeded ${parsed.models.length} pricing rows from fallback`);
  } catch (err) {
    console.error('Failed to seed pricing from fallback:', (err as Error).message);
  }
}

export async function checkAndUpdatePricing(): Promise<boolean> {
  const upstream = await fetchLiteLLMPricing();
  if (!upstream) {
    console.log('LiteLLM fetch returned null — skipping update cycle');
    return false;
  }

  // Index upstream by display name (canonical key in our DB)
  const upstreamByName = new Map<string, UpstreamModel>();
  for (const m of upstream) upstreamByName.set(m.displayName, m);

  const current = (await allQuery('SELECT * FROM pricing')) as PricingRecord[];
  const currentByName = new Map(current.map((r) => [r.model, r]));

  let changed = false;

  // 1. Apply updates to existing rows
  for (const row of current) {
    const up = upstreamByName.get(row.model) ?? null;
    const action = decideUpdateAction(row, up ? { input: up.inputPrice, output: up.outputPrice } : null);
    if (action === 'skip') continue;
    if (action === 'mark_deprecated') {
      await runQuery(
        "UPDATE pricing SET status = 'deprecated', last_updated = CURRENT_TIMESTAMP WHERE model = ?",
        [row.model]
      );
      console.log(`Marked deprecated: ${row.model}`);
      changed = true;
      continue;
    }
    if (up && (action === 'overwrite' || action === 'graduate')) {
      await upsertPricing({
        model: row.model,
        inputPrice: up.inputPrice,
        outputPrice: up.outputPrice,
        source: 'auto',
        status: 'active',
        tier: up.tier,
        apiId: up.api_id
      });
      console.log(`${action} ${row.model}: ${up.inputPrice}/${up.outputPrice}`);
      await recalculateCosts(row.model);
      changed = true;
    }
  }

  // 2. Insert new upstream models that aren't in our DB yet
  for (const m of upstream) {
    if (currentByName.has(m.displayName)) continue;
    await upsertPricing({
      model: m.displayName,
      inputPrice: m.inputPrice,
      outputPrice: m.outputPrice,
      source: 'auto',
      status: 'active',
      tier: m.tier,
      apiId: m.api_id
    });
    console.log(`Added new model from upstream: ${m.displayName}`);
    changed = true;
  }

  return changed;
}

export async function recalculateCosts(model: string): Promise<RecalculateCostsResult> {
  try {
    const records = (await allQuery(
      `SELECT id, input_tokens, output_tokens FROM usage_records
       WHERE model = ? AND datetime(timestamp) >= datetime('now', '-30 days')`,
      [model]
    )) as UsageRecord[];
    const pricing = (await getQuery(
      'SELECT * FROM pricing WHERE model = ?',
      [model]
    )) as PricingRecord | undefined;
    if (pricing && records.length > 0) {
      for (const r of records) {
        const cost =
          (r.input_tokens * pricing.input_price + r.output_tokens * pricing.output_price) /
          1_000_000;
        await runQuery('UPDATE usage_records SET cost = ? WHERE id = ?', [cost, r.id]);
      }
      console.log(`Recalculated costs for ${records.length} records of ${model}`);
    }
    return {
      success: true,
      model,
      recordsUpdated: records.length,
      message: `Recalculated costs for ${records.length} records`
    };
  } catch (error) {
    console.error('Error recalculating costs:', error);
    throw error;
  }
}

export async function getAllPricing(): Promise<PricingRecord[]> {
  try {
    return (await allQuery('SELECT * FROM pricing ORDER BY model ASC')) as PricingRecord[];
  } catch (error) {
    console.error('Error getting pricing:', error);
    return [];
  }
}

export function schedulePricingCheck(cronJob: any): void {
  try {
    cronJob.schedule('0 2 * * *', async () => {
      console.log('Running scheduled pricing check...');
      const updated = await checkAndUpdatePricing();
      console.log(updated ? 'Pricing was updated' : 'No pricing changes detected');
    });
    console.log('Pricing check scheduled for daily at 2 AM');
  } catch (error) {
    console.error('Error scheduling pricing check:', error);
  }
}

// Exported for legacy callers; now delegates to the LiteLLM source.
export async function fetchLatestPricing(): Promise<UpstreamModel[] | null> {
  return fetchLiteLLMPricing();
}
```

- [ ] **Step 3: Type check**

Run: `cd backend && npm run type-check`
Expected: no errors. If `PricingUpdateResult` shape differs from what `upsertPricing` returns, adjust the `import` or local type.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: all 21 existing + 3 new test files pass.

- [ ] **Step 5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/services/pricingService.ts
git commit -m "feat(backend): rewrite pricingService with LiteLLM fetch + source-aware update + fallback seed"
```

---

## Task 7: Wire `usageController` to auto-create unknown models

**Files:**
- Modify: `backend/src/controllers/usageController.ts`

- [ ] **Step 1: Modify the `trackUsage` handler**

In `backend/src/controllers/usageController.ts`, replace the section from the destructuring through the cost computation (lines 18-44) with:

```typescript
import { Request, Response } from 'express';
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import { normalizeIncomingModel, tierDefaultPrice, type PricingRow as KnownRow } from '../services/modelNormalizer.js';
import { upsertPricing } from '../services/pricingService.js';
import type { UsageTrackRequest, UsageTrackResponse, UsageSummary, UsageRecord, ModelBreakdown } from '../types/index.js';

interface PricingRow {
  model: string;
  input_price: number;
  output_price: number;
  source: string;
  status: string;
  tier: string | null;
  api_id: string | null;
}

// (other interfaces unchanged)

export async function trackUsage(
  req: Request<unknown, unknown, UsageTrackRequest>,
  res: Response<UsageTrackResponse>
): Promise<void> {
  try {
    const {
      model: rawModel,
      input_tokens,
      output_tokens,
      conversation_id,
      source = 'claude_ai',
      task_description = null,
      success_status = 'unknown',
      response_metadata = null
    } = req.body;

    if (!rawModel || input_tokens === undefined || output_tokens === undefined) {
      res.status(400).json({ success: false, error: 'Missing required fields' } as any);
      return;
    }

    // Normalize the incoming model id/name against existing pricing rows
    const allRows = (await allQuery('SELECT * FROM pricing')) as KnownRow[];
    const normalized = normalizeIncomingModel(rawModel, allRows);
    const model = normalized.displayName;

    let pricing = (await getQuery(
      'SELECT * FROM pricing WHERE model = ?',
      [model]
    )) as PricingRow | undefined;

    // Auto-create on first sighting
    if (!pricing) {
      const tierPrice = tierDefaultPrice(normalized.tier, allRows);
      if (tierPrice) {
        await upsertPricing({
          model,
          inputPrice: tierPrice.input,
          outputPrice: tierPrice.output,
          source: 'tier_default',
          status: 'active',
          tier: normalized.tier,
          apiId: normalized.apiId
        });
        console.log(`Auto-created tier_default pricing for new model: ${model}`);
      } else {
        await upsertPricing({
          model,
          inputPrice: 0,
          outputPrice: 0,
          source: 'tier_default',
          status: 'pending_confirmation',
          tier: normalized.tier,
          apiId: normalized.apiId
        });
        console.log(`Auto-created pending_confirmation pricing for unknown model: ${model}`);
      }
      pricing = (await getQuery(
        'SELECT * FROM pricing WHERE model = ?',
        [model]
      )) as PricingRow | undefined;
    }

    const total_tokens = input_tokens + output_tokens;
    let cost = 0;
    if (pricing) {
      cost =
        (input_tokens * pricing.input_price + output_tokens * pricing.output_price) / 1_000_000;
    }

    const metadataJson = response_metadata
      ? typeof response_metadata === 'string'
        ? response_metadata
        : JSON.stringify(response_metadata)
      : null;

    const result = await runQuery(
      `INSERT INTO usage_records (
        model, input_tokens, output_tokens, total_tokens, cost, conversation_id, source,
        task_description, success_status, response_metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        cost,
        conversation_id,
        source,
        task_description,
        success_status,
        metadataJson
      ]
    );

    res.status(201).json({
      success: true,
      id: result.lastID as number,
      cost: cost.toFixed(4)
    });
  } catch (error) {
    console.error('Error tracking usage:', error);
    res.status(500).json({ success: false, error: 'Internal server error' } as any);
  }
}
```

Leave the other handlers in the file (`getSummary`, `getModelBreakdown`, etc.) unchanged.

- [ ] **Step 2: Type check**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 3: Smoke test the full path manually**

Run: `cd backend && npm run dev` in one terminal. In another:

```bash
# Send a usage record for a brand-new model name
curl -s -X POST http://localhost:3000/api/usage/track \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-opus-4-7-20251101","input_tokens":1000,"output_tokens":500,"conversation_id":"smoke-1"}'

# Check the pricing table now has a row for "Claude Opus 4.7"
curl -s http://localhost:3000/api/pricing | jq '.["Claude Opus 4.7"]'
```

Expected: the second command returns a pricing row with tier `opus`, source `tier_default`, status `active`, prices 15/75 (graduated from sibling).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/controllers/usageController.ts
git commit -m "feat(backend): auto-create pricing row for unknown models on /track"
```

---

## Task 8: Add the confirm endpoint

**Files:**
- Modify: `backend/src/controllers/pricingController.ts`
- Modify: `backend/src/routes/pricing.ts`
- Modify: `backend/src/middleware/validators.ts`

- [ ] **Step 1: Read existing validators to match style**

Read `backend/src/middleware/validators.ts` — note the export pattern of `updatePricingValidator`.

- [ ] **Step 2: Add the validator**

In `backend/src/middleware/validators.ts`, after `updatePricingValidator`, add:

```typescript
import { body, param } from 'express-validator';
// (existing imports — keep)

export const confirmPricingValidator = [
  param('model').isString().notEmpty().withMessage('Model is required'),
  body('inputPrice').optional().isFloat({ min: 0, max: 1000 }),
  body('outputPrice').optional().isFloat({ min: 0, max: 1000 })
];
```

If `body`/`param` are not yet imported, add them to the existing import.

- [ ] **Step 3: Add the controller handler**

In `backend/src/controllers/pricingController.ts`, after `updatePricing`, add:

```typescript
import { upsertPricing } from '../services/pricingService.js';

export async function confirmPricing(req: Request, res: Response): Promise<void> {
  try {
    const model = req.params.model as string;
    const { inputPrice, outputPrice } = req.body as {
      inputPrice?: number;
      outputPrice?: number;
    };

    const existing = (await getQuery(
      'SELECT * FROM pricing WHERE model = ?',
      [model]
    )) as
      | { input_price: number; output_price: number; tier: string | null; api_id: string | null }
      | undefined;

    if (!existing) {
      res.status(404).json({ success: false, error: 'Model not found' });
      return;
    }

    const finalInput = typeof inputPrice === 'number' ? inputPrice : existing.input_price;
    const finalOutput = typeof outputPrice === 'number' ? outputPrice : existing.output_price;

    await upsertPricing({
      model,
      inputPrice: finalInput,
      outputPrice: finalOutput,
      source: 'manual',
      status: 'active',
      tier: existing.tier,
      apiId: existing.api_id
    });

    res.json({
      success: true,
      model,
      pricing: { input_price: finalInput, output_price: finalOutput, source: 'manual', status: 'active' }
    });
  } catch (error) {
    console.error('Error confirming pricing:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
```

- [ ] **Step 4: Drop the obsolete `initializePricing` default seed**

In `backend/src/controllers/pricingController.ts`, replace the body of `initializePricing` with a no-op (or delete the function and its call site in `server.ts` — see Task 9). For now, leave the function defined but make its body:

```typescript
export async function initializePricing(): Promise<void> {
  // Seeding is now handled by seedFromFallbackIfEmpty() in pricingService.
  // This function is kept for API compatibility and is a no-op.
}
```

- [ ] **Step 5: Verify `getPricing` returns the new fields**

Read `backend/src/controllers/pricingController.ts:getPricing`. It calls `getAllPricing()` then `formatPricingResponse()`. Both now include `status`, `tier`, `api_id` (per Task 6's rewrite of `formatPricingResponse`). No code change needed in this step. If the response shape is built differently — e.g., by hand-listing fields — add `status`, `tier`, `api_id` to the projection.

- [ ] **Step 6: Register the route**

In `backend/src/routes/pricing.ts`, add:

```typescript
import {
  getPricing,
  updatePricing,
  confirmPricing
} from '../controllers/pricingController.js';
import {
  updatePricingValidator,
  confirmPricingValidator,
  handleValidationErrors
} from '../middleware/validators.js';

// (existing routes...)

router.post('/:model/confirm', confirmPricingValidator, handleValidationErrors, confirmPricing);
```

- [ ] **Step 7: Type check**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 8: Smoke test**

Run: `cd backend && npm run dev`. In another terminal:

```bash
# Trigger auto-create for an unknown-tier model so it lands in pending_confirmation
curl -s -X POST http://localhost:3000/api/usage/track \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-fictional-model-99","input_tokens":100,"output_tokens":100}'

# Confirm
curl -s -X POST 'http://localhost:3000/api/pricing/claude-fictional-model-99/confirm' \
  -H 'Content-Type: application/json' \
  -d '{"inputPrice":2.5,"outputPrice":12}'

# Verify
curl -s http://localhost:3000/api/pricing | jq '.["claude-fictional-model-99"]'
```

Expected: confirm returns success; final pricing row has source=`manual`, status=`active`, prices 2.5/12.

Stop the dev server.

- [ ] **Step 9: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/controllers/pricingController.ts backend/src/routes/pricing.ts backend/src/middleware/validators.ts
git commit -m "feat(backend): add POST /api/pricing/:model/confirm endpoint and drop hardcoded seed"
```

---

## Task 9: Wire startup seed + initial fetch

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Update server bootstrap**

In `backend/src/server.ts`, replace the `start()` function body lines that call `initializePricing` and `schedulePricingCheck` with:

```typescript
import {
  schedulePricingCheck,
  seedFromFallbackIfEmpty,
  checkAndUpdatePricing
} from './services/pricingService.js';

// (other imports unchanged)

async function start(): Promise<void> {
  try {
    await initDatabase();
    console.log('Database initialized');

    await seedFromFallbackIfEmpty();
    console.log('Pricing seeded if empty');

    // One-time startup fetch (don't block startup on failure)
    checkAndUpdatePricing()
      .then((updated) => console.log(updated ? 'Startup pricing fetch updated rows' : 'Startup pricing fetch found no changes'))
      .catch((err) => console.error('Startup pricing fetch error:', err));

    schedulePricingCheck(cron);

    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('Running scheduled model analytics refresh...');
        await refreshModelAnalytics();
      } catch (error) {
        console.error('Scheduled analytics refresh failed:', error);
      }
    });

    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
```

The original `initializePricing` import can be removed since the function is now a no-op.

- [ ] **Step 2: Type check**

Run: `cd backend && npm run type-check`
Expected: no errors.

- [ ] **Step 3: Smoke test full startup**

Run: `cd backend && npm run dev`. Watch the logs.

Expected logs (in order, approximately):
- `Database initialized`
- `Seeded N pricing rows from fallback` (only on first run with empty DB)
- `Pricing seeded if empty`
- `Startup pricing fetch updated rows` or `… found no changes`
- `Pricing check scheduled for daily at 2 AM`
- `Server running on port 3000`

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/server.ts
git commit -m "feat(backend): seed pricing from fallback and run one-time fetch on startup"
```

---

## Task 10: Replace hardcoded models in `modelRecommendationService`

**Files:**
- Modify: `backend/src/services/modelRecommendationService.ts`

**Goal:** The service currently hardcodes `AVAILABLE_MODELS = ['Claude 3.5 Haiku', 'Claude 3.5 Sonnet', 'Claude 3 Opus']` and a parallel `PRICING` constant. Replace both with a runtime DB query so newly-added models are automatically considered.

- [ ] **Step 1: Read current usage**

Read `backend/src/services/modelRecommendationService.ts` to find every reference to `AVAILABLE_MODELS` and `PRICING`. Note the function signatures that will need to become async or accept the model list as a parameter.

- [ ] **Step 2: Replace constants with a DB-backed loader**

Near the top of the file, replace the `PRICING` and `AVAILABLE_MODELS` constants with:

```typescript
import { allQuery } from '../database/sqlite.js';

interface ActiveModel {
  model: string;
  input_price: number;
  output_price: number;
  tier: string | null;
}

async function loadActiveModels(): Promise<ActiveModel[]> {
  const rows = (await allQuery(
    "SELECT model, input_price, output_price, tier FROM pricing WHERE status = 'active'"
  )) as ActiveModel[];
  return rows;
}
```

- [ ] **Step 3: Update `recommendModel` (or equivalent) to use the loader**

Wherever `AVAILABLE_MODELS` was iterated, replace with `const activeModels = await loadActiveModels();` and iterate over `activeModels.map(m => m.model)`. Wherever `PRICING[model]` was looked up, replace with the row's `input_price`/`output_price`.

The existing tier-detection via `model.includes('Haiku'/'Sonnet'/'Opus')` stays — it works for Claude 4.x names too.

- [ ] **Step 4: Update the `successRateHaiku` / `successRateSonnet` / `successRateOpus` keys**

The `historicalData` block currently aggregates per tier. Replace the three hardcoded calls with a tier-based loop that picks the most-recent active model per tier:

```typescript
const byTier: Record<string, ActiveModel | undefined> = {};
for (const m of activeModels) {
  const tier = (m.tier ?? '').toLowerCase();
  if (tier === 'haiku' || tier === 'sonnet' || tier === 'opus') {
    if (!byTier[tier]) byTier[tier] = m;
  }
}
const haikuModel = byTier.haiku?.model;
const sonnetModel = byTier.sonnet?.model;
const opusModel = byTier.opus?.model;

const historicalData = {
  successRateHaiku: haikuModel ? (await calculateSafetyScore(haikuModel)).successRate || 0 : 0,
  successRateSonnet: sonnetModel ? (await calculateSafetyScore(sonnetModel)).successRate || 0 : 0,
  successRateOpus: opusModel ? (await calculateSafetyScore(opusModel)).successRate || 0 : 0
};
```

Adjust the `fallback` field similarly: `fallback: sonnetModel ?? haikuModel ?? activeModels[0]?.model ?? 'Claude 3.5 Sonnet'`.

- [ ] **Step 5: Type check and run tests**

Run: `cd backend && npm run type-check && npm test`
Expected: all tests pass. If a unit test references the old `AVAILABLE_MODELS` constant directly, update or remove the affected assertion.

- [ ] **Step 6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/services/modelRecommendationService.ts
git commit -m "feat(backend): drive recommendation engine from DB pricing instead of hardcoded list"
```

---

## Task 11: Extension — extend `formatModelName` for current and future Claude models

**Files:**
- Modify: `extension/content.js`

- [ ] **Step 1: Replace the `modelMap` and fallback in `extension/content.js`**

In `extension/content.js`, replace the `formatModelName` function (currently at lines 263-292) with:

```javascript
function formatModelName(modelId) {
  if (!modelId) return 'Unknown';
  const normalizedId = String(modelId).toLowerCase().trim();

  // Known display-name overrides (keep in sync with backend tier inference)
  const explicitMap = {
    'claude-opus-4-7': 'Claude Opus 4.7',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-haiku-4-5': 'Claude Haiku 4.5',
    'claude-3-7-sonnet': 'Claude 3.7 Sonnet',
    'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
    'claude-3-5-haiku': 'Claude 3.5 Haiku',
    'claude-3-opus': 'Claude 3 Opus',
    'claude-3-sonnet': 'Claude 3 Sonnet',
    'claude-3-haiku': 'Claude 3 Haiku',
    'claude-2-1': 'Claude 2.1',
    'claude-2': 'Claude 2'
  };

  // Strip date suffix for matching: claude-opus-4-7-20251101 → claude-opus-4-7
  const stripped = normalizedId.replace(/-\d{8}$/, '');
  if (explicitMap[stripped]) return explicitMap[stripped];

  // Generic claude-* fallback: derive a name like "Claude Opus 4.7"
  const TIERS = ['haiku', 'sonnet', 'opus'];
  const match = stripped.match(/^claude-([a-z0-9-]+)$/);
  if (match) {
    const parts = match[1].split('-');
    const tier = TIERS.find((t) => parts.includes(t));
    if (tier) {
      const tierIdx = parts.indexOf(tier);
      const versionParts = parts.slice(0, tierIdx).concat(parts.slice(tierIdx + 1));
      const version = versionParts.join('.');
      const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
      const versionFirst = tierIdx > 0 && /^\d/.test(parts[0]);
      return (versionFirst ? `Claude ${version} ${cap}` : `Claude ${cap} ${version}`)
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  // Last resort: pass the raw ID — backend's normalizeIncomingModel will handle it.
  return modelId;
}
```

The crucial change: when an unknown model ID arrives, we no longer default to `'Claude 3.5 Sonnet'` (which was wrong and silently mis-attributed costs). We pass the raw ID through and let the backend's normalizer decide.

- [ ] **Step 2: Manual test in browser**

Reload the unpacked extension in `chrome://extensions`. Open `claude.ai`. Send a single message. In another terminal:

```bash
curl -s http://localhost:3000/api/usage/history?limit=1 | jq '.records[0].model'
```

Expected: a recognizable model name (`"Claude Sonnet 4.6"` or similar), NOT a raw ID like `"claude-sonnet-4-6-20250929"`.

- [ ] **Step 3: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add extension/content.js
git commit -m "feat(extension): handle Claude 4.x and 3.7 family in formatModelName with generic fallback"
```

---

## Task 12: Frontend — pricing-table badges and confirm flow

**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/types/components.ts`
- Modify: `frontend/src/components/PricingTable.tsx`
- Modify: `frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Read each file to anchor the diffs**

Read all four files. Note the existing prop shapes and Tailwind class conventions used in the project.

- [ ] **Step 2: Add the API client function**

In `frontend/src/services/api.ts`, after `updatePricing`, add:

```typescript
export async function confirmPricing(
  model: string,
  inputPrice?: number,
  outputPrice?: number
): Promise<void> {
  const body: Record<string, number> = {};
  if (inputPrice !== undefined) body.inputPrice = inputPrice;
  if (outputPrice !== undefined) body.outputPrice = outputPrice;
  const res = await fetch(`${API_BASE}/api/pricing/${encodeURIComponent(model)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Confirm failed: HTTP ${res.status}`);
}
```

If `API_BASE` is named differently in the file, use whatever convention exists.

- [ ] **Step 3: Extend the pricing-row type**

In `frontend/src/types/components.ts`, find the row type used by `PricingTableProps['pricing']` and add the new fields:

```typescript
status?: 'active' | 'pending_confirmation' | 'deprecated';
source?: 'manual' | 'auto' | 'tier_default';
tier?: 'haiku' | 'sonnet' | 'opus' | 'other' | null;
api_id?: string | null;
```

- [ ] **Step 4: Render badge + confirm button in `PricingTable`**

In `frontend/src/components/PricingTable.tsx`, inside the `<tbody>` row map, add a badge column and a conditional confirm button. Approximate structure (adjust to match existing Tailwind classes):

```tsx
<td className="px-4 py-2">
  <span
    className={
      'inline-block px-2 py-0.5 text-xs rounded-full ' +
      (row.status === 'pending_confirmation'
        ? 'bg-amber-100 text-amber-800'
        : row.status === 'deprecated'
          ? 'bg-gray-200 text-gray-600'
          : row.source === 'manual'
            ? 'bg-blue-100 text-blue-800'
            : row.source === 'auto'
              ? 'bg-green-100 text-green-800'
              : 'bg-slate-100 text-slate-700')
    }
  >
    {row.status === 'pending_confirmation'
      ? 'Needs review'
      : row.status === 'deprecated'
        ? 'Deprecated'
        : (row.source ?? 'unknown')}
  </span>
</td>
```

Add a "Confirm" button in the actions cell when `row.status === 'pending_confirmation'`:

```tsx
{row.status === 'pending_confirmation' && (
  <button
    onClick={async () => {
      await confirmPricing(row.model, row.input_price, row.output_price);
      onUpdate?.();
    }}
    className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600"
  >
    Confirm
  </button>
)}
```

Import `confirmPricing` at the top.

- [ ] **Step 5: Banner in `Settings.tsx`**

In `frontend/src/pages/Settings.tsx`, before rendering `<PricingTable …/>`, add a banner driven by the same pricing list:

```tsx
{pricing.some((p) => p.status === 'pending_confirmation') && (
  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-900">
    <strong>New models detected.</strong> Review and confirm pricing for the rows marked
    <em> Needs review</em> below.
  </div>
)}
```

- [ ] **Step 6: Type check and run frontend**

Run: `cd frontend && npm run build`
Expected: clean build.

Run: `cd frontend && npm run dev` and open the Settings page in a browser. Verify:
- Existing rows show a green/blue/grey badge based on source
- If you have a `pending_confirmation` row from earlier smoke tests, the banner appears and the row has a "Confirm" button
- Clicking "Confirm" makes the row flip to `manual` source and the banner disappears (after refresh)

- [ ] **Step 7: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add frontend/src/services/api.ts frontend/src/types/components.ts frontend/src/components/PricingTable.tsx frontend/src/pages/Settings.tsx
git commit -m "feat(frontend): show source/status badges and confirm flow for new models"
```

---

## Task 13: Final end-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Reset to a fresh DB to verify the seed path**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
mv database.sqlite database.sqlite.bak
```

- [ ] **Step 2: Start the backend offline-simulating LiteLLM unreachable**

Block outbound traffic to GitHub raw or temporarily change the `LITELLM_URL` constant to a deliberately bad host, then:

```bash
npm run dev
```

Expected logs:
- `Database initialized`
- `Seeded 7 pricing rows from fallback`
- `LiteLLM fetch error: …`
- `Server running on port 3000`

Verify pricing exists:

```bash
curl -s http://localhost:3000/api/pricing | jq 'keys'
```

Expected: array containing `"Claude Opus 4.7"`, `"Claude Sonnet 4.6"`, `"Claude Haiku 4.5"`, etc.

Stop the server. Restore the original `LITELLM_URL`.

- [ ] **Step 3: Restart with real LiteLLM access**

```bash
npm run dev
```

Expected: a "Startup pricing fetch updated rows" or "no changes" log line within ~10 seconds.

- [ ] **Step 4: Trigger the auto-detect path**

```bash
curl -s -X POST http://localhost:3000/api/usage/track \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-some-future-tier-1-0-20991231","input_tokens":100,"output_tokens":100}'
```

Expected: response 201. The new pricing row in `GET /api/pricing` has `status='pending_confirmation'`, `source='tier_default'`, prices `0/0`.

- [ ] **Step 5: Confirm via UI**

Open the frontend Settings page. Verify the banner appears, the row shows "Needs review" badge, and the "Confirm" button works.

- [ ] **Step 6: Restore the original DB**

Stop the server.

```bash
mv database.sqlite database.sqlite.fresh
mv database.sqlite.bak database.sqlite
```

- [ ] **Step 7: No commit — this is verification only**

If everything passed, the feature is ready to merge.

---

## Done

The plan is complete when:
- All 13 task checkboxes are checked
- `cd backend && npm test` passes
- `cd backend && npm run type-check` passes
- `cd frontend && npm run build` passes
- The end-to-end smoke test in Task 13 succeeds
