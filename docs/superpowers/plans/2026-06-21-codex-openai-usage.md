# Codex and OpenAI API Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user explicitly overrides AGENTS.md §3.0.

**Goal:** Add daily Codex subscription-limit snapshots and active-organization OpenAI API month-to-date usage to the extension, backend, popup, and dashboard.

**Architecture:** Two focused MV3 scraper files parse live German/English pages and post daily snapshots through the existing `/api/usage/track` endpoint. The backend stores provider details in `response_metadata`, exposes typed summary blocks, and adds only OpenAI API spend to the grand total. Focused React cards render the new data without adding more provider-specific markup to `OverviewTab`.

**Tech Stack:** Chrome MV3 JavaScript, Node `node:test`, Express, TypeScript, SQLite3, Jest/Supertest, React 18, Vitest, Tailwind CSS.

## Global Constraints

- Track only the organization currently selected on OpenAI Platform.
- OpenAI API cost is calendar-month-to-date and is accepted only after the page period is verified.
- Codex percentages mean **remaining**, not used.
- Codex limits and remaining credits never contribute to monetary totals.
- OpenAI API spend contributes to `grand_total_eur` exactly once through the daily USD-to-EUR rate.
- Preserve the unfinished OpenCode changes in `extension/popup.html`, `extension/popup.js`, and `extension/background-scraper-opencode-usage.js`; merge around them and never discard them.
- `syncAll()` continues to use one shared `active: true` tab and closes it after all sources.
- Scrapers accept German and English labels, use semantic text rather than generated class names, and return structured failure reasons.
- Add only `https://chatgpt.com/*`; reuse the existing `https://platform.openai.com/*` host permission.
- Backend remains on port **3001**.
- Update README and AGENTS.md when the manifest, verification procedure, or handoff state changes.

---

### Task 1: Pure page parsers with German and English fixtures

**Files:**
- Create: `extension/usage-parser-codex.js`
- Create: `extension/usage-parser-openai-api.js`
- Create: `extension/tests/usage-parsers.test.js`

**Interfaces:**
- Produces: `parseCodexUsageText(text: string): CodexUsageParseResult`
- Produces: `parseOpenAiApiUsageText(text: string, expectedPeriod: { start: string; end: string }): OpenAiApiUsageParseResult`
- Both parser files expose functions globally for `importScripts`; when `module.exports` exists, they also export functions for Node tests.

- [ ] **Step 1: Write failing parser tests**

Create `extension/tests/usage-parsers.test.js` with `node:test`, `node:assert/strict`, and `vm`. Load each classic script into a VM context and assert:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadParser(file) {
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return context.module.exports;
}

const { parseCodexUsageText } = loadParser('usage-parser-codex.js');
const { parseOpenAiApiUsageText } = loadParser('usage-parser-openai-api.js');

test('parses German Codex percentages as remaining capacity', () => {
  const result = parseCodexUsageText(`
    5 Stunden Nutzungsgrenze 91 % verbleibend Zurücksetzungen 22.06.2026 04:36
    Wöchentliches Nutzungslimit 99 % verbleibend Zurücksetzungen 28.06.2026 23:36
    Verbleibende Credits 12,5 Interaktionen 7 Plugins calls 2 Skills used 3
  `);
  assert.equal(result.success, true);
  assert.equal(result.data.five_hour_remaining_pct, 91);
  assert.equal(result.data.weekly_remaining_pct, 99);
  assert.equal(result.data.credits_remaining, 12.5);
});

test('parses English Codex labels', () => {
  const result = parseCodexUsageText(`
    5 hour usage limit 42% remaining Resets Jun 22, 2026 4:36 AM
    Weekly usage limit 73% remaining Resets Jun 28, 2026 11:36 PM
    Credits remaining 8 Interactions 4 Plugin calls 1 Skills used 2
  `);
  assert.equal(result.data.five_hour_remaining_pct, 42);
  assert.equal(result.data.weekly_remaining_pct, 73);
});

test('rejects Codex text without both required limit cards', () => {
  assert.deepEqual(parseCodexUsageText('Codex Analytics'), {
    success: false,
    reason: 'usage_cards_not_found'
  });
});

test('accepts zero API usage for a verified month-to-date period', () => {
  const result = parseOpenAiApiUsageText(
    'Jun 1–Jun 21 Total spend $0.00 Total tokens 0 Requests 0 Organization wolfini',
    { start: '2026-06-01', end: '2026-06-21' }
  );
  assert.equal(result.success, true);
  assert.equal(result.data.cost_usd, 0);
  assert.equal(result.data.organization_name, 'wolfini');
});

test('rejects API totals when the calendar period cannot be verified', () => {
  const result = parseOpenAiApiUsageText(
    'May 22–Jun 21 Total spend $7.12 Total tokens 120K Requests 9 Organization wolfini',
    { start: '2026-06-01', end: '2026-06-21' }
  );
  assert.equal(result.success, false);
  assert.equal(result.reason, 'period_not_verified');
});
```

- [ ] **Step 2: Run the parser tests and confirm the expected failure**

Run: `node --test extension/tests/usage-parsers.test.js`

Expected: FAIL because both parser files are missing.

- [ ] **Step 3: Implement the pure parsers**

Implement bounded helpers for localized numbers, abbreviated token values (`K`, `M`), localized date ranges, and labelled values. Return discriminated results:

```js
// success
{ success: true, data: { /* normalized fields */ } }

// failure
{ success: false, reason: 'usage_cards_not_found' | 'period_not_verified' | 'layout_changed' }
```

`parseCodexUsageText` must require finite `five_hour_remaining_pct` and `weekly_remaining_pct` in `[0, 100]`. `parseOpenAiApiUsageText` must require a non-empty organization name, finite non-negative cost, and exact normalized start/end dates. Optional tokens, requests, project rows, and model rows default to zero or empty arrays.

Export without breaking MV3 classic scripts:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCodexUsageText };
}
```

- [ ] **Step 4: Run parser tests and syntax checks**

Run:

```bash
node --test extension/tests/usage-parsers.test.js
node --check extension/usage-parser-codex.js
node --check extension/usage-parser-openai-api.js
```

Expected: all parser tests PASS and both syntax checks exit 0.

- [ ] **Step 5: Commit the parser layer**

```bash
git add extension/usage-parser-codex.js extension/usage-parser-openai-api.js extension/tests/usage-parsers.test.js
git commit -m "feat(extension): parse Codex and OpenAI usage pages"
```

---

### Task 2: Codex subscription usage scraper

**Files:**
- Create: `extension/background-scraper-codex.js`
- Modify: `extension/tests/usage-parsers.test.js`

**Interfaces:**
- Consumes: `parseCodexUsageText(text)` from Task 1.
- Consumes existing globals: `getApiBase`, `authFetch`, `waitForTabReady`, `waitForTabComplete`, `sleep`.
- Produces: `codexSync(externalTabId): Promise<SyncResult>`.
- Posts source `codex_sync` with model `OpenAI Codex`.

- [ ] **Step 1: Add failing tests for metadata mapping**

Extend the VM tests with `buildCodexTrackPayload(data, nowIso)` and assert exact fields:

```js
function loadScripts(files) {
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return context.module.exports;
}

const { buildCodexTrackPayload } = loadScripts([
  'usage-parser-codex.js',
  'background-scraper-codex.js'
]);

test('maps Codex remaining limits into one daily snapshot payload', () => {
  const payload = buildCodexTrackPayload({
    five_hour_remaining_pct: 91,
    five_hour_reset_at: '2026-06-22T02:36:00.000Z',
    weekly_remaining_pct: 99,
    weekly_reset_at: '2026-06-28T21:36:00.000Z',
    credits_remaining: 0,
    interactions: 0,
    interactions_by_model: [],
    interactions_by_surface: [],
    plugin_calls: 0,
    skills_used: 0,
    credit_usage: []
  }, '2026-06-21T20:00:00.000Z');
  assert.equal(payload.source, 'codex_sync');
  assert.equal(payload.input_tokens, 0);
  assert.equal(payload.output_tokens, 0);
  assert.equal(payload.response_metadata.five_hour_remaining_pct, 91);
  assert.equal(payload.response_metadata.scraped_at, '2026-06-21T20:00:00.000Z');
});
```

Expected first run: FAIL because `buildCodexTrackPayload` is not exported.

- [ ] **Step 2: Implement `background-scraper-codex.js`**

Use `CODEX_USAGE_URL = 'https://chatgpt.com/codex/settings/usage'`. Accept the redirect to `/codex/cloud/settings/analytics#usage`. In the injected page function, read visible text plus scoped table/list rows for model, surface, and credit history. Never read cookies or storage.

Success payload:

```js
{
  model: 'OpenAI Codex',
  input_tokens: 0,
  output_tokens: 0,
  conversation_id: 'codex-daily-' + new Date().toISOString().slice(0, 10),
  source: 'codex_sync',
  cost_usd: 0,
  response_metadata: { ...parsedData, scraped_at: nowIso }
}
```

Return `login_required` when redirected outside authenticated Codex pages, `usage_cards_not_found` when both limit cards are absent, `post_failed` on a non-2xx tracker response, and `layout_changed` for unexpected parse failures. Set `last_codex_sync`, `last_codex_sync_status`, and `last_codex_sync_data` in `chrome.storage.local`.

Use the repository's established ownership rule: close only a tab created inside `codexSync`, in `finally`.

- [ ] **Step 3: Run focused tests and syntax checks**

```bash
node --test extension/tests/usage-parsers.test.js
node --check extension/background-scraper-codex.js
```

Expected: PASS.

- [ ] **Step 4: Commit the Codex scraper**

```bash
git add extension/background-scraper-codex.js extension/tests/usage-parsers.test.js
git commit -m "feat(extension): sync Codex subscription limits"
```

---

### Task 3: OpenAI API scraper and extension orchestration

**Files:**
- Create: `extension/background-scraper-openai-api.js`
- Modify: `extension/tests/usage-parsers.test.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

**Interfaces:**
- Consumes: `parseOpenAiApiUsageText(text, expectedPeriod)` from Task 1.
- Produces: `openaiApiSync(externalTabId): Promise<SyncResult>`.
- Posts source `openai_api_sync` with model `OpenAI API`.
- Adds message routes `TRIGGER_CODEX_SYNC` and `TRIGGER_OPENAI_API_SYNC`.

- [ ] **Step 1: Add failing API payload tests**

Add `buildOpenAiApiTrackPayload(data, nowIso)` tests proving zero cost is valid and metadata carries the organization and verified period:

```js
const { buildOpenAiApiTrackPayload } = loadScripts([
  'usage-parser-openai-api.js',
  'background-scraper-openai-api.js'
]);

test('maps verified API usage into a monthly snapshot payload', () => {
  const payload = buildOpenAiApiTrackPayload({
    organization_name: 'wolfini',
    period_start: '2026-06-01',
    period_end: '2026-06-21',
    cost_usd: 7.12,
    input_tokens: 120000,
    output_tokens: 8000,
    requests: 9,
    by_project: [],
    by_model: []
  }, '2026-06-21T20:00:00.000Z');
  assert.equal(payload.source, 'openai_api_sync');
  assert.equal(payload.cost_usd, 7.12);
  assert.equal(payload.workspace, 'wolfini');
  assert.equal(payload.response_metadata.period_start, '2026-06-01');
});
```

Expected first run: FAIL because the payload builder is missing.

- [ ] **Step 2: Implement `openaiApiSync`**

Navigate to `https://platform.openai.com/usage`. Compute local calendar-month boundaries as `YYYY-MM-01` through today's `YYYY-MM-DD`. Use semantic buttons and text to select month-to-date; accept English and German date labels. After interaction, re-read the rendered date range and pass it to the pure parser. Do not post when `period_not_verified` is returned.

Map access states:

```text
login page/sign-in button -> login_required
permission/owner warning -> permission_required
verified totals absent after bounded render wait -> layout_changed
non-2xx POST -> post_failed
```

Post one payload carrying normalized totals and breakdowns. Store `last_openai_api_sync`, status, and data locally. Follow the same created-tab `finally` rule as Task 2.

- [ ] **Step 3: Wire scripts, messages, alarms, and shared sync**

In `extension/background.js`:

- load parser files before scraper files;
- load both new scraper files;
- add `CODEX_SYNC_ALARM` and `OPENAI_API_SYNC_ALARM`, each `24 * 60` minutes;
- stagger startup at 13 and 15 minutes;
- add `{ type: 'codex', label: 'Codex', fn: codexSync }` and `{ type: 'openai_api', label: 'OpenAI API', fn: openaiApiSync }` before Billing;
- add message and `onAlarm` routes.

In `extension/manifest.json`, add only:

```json
"https://chatgpt.com/*"
```

Keep the existing OpenCode API imports, alarm, `syncAll` step, and popup edits. Resolve overlapping popup edits by retaining the OpenCode row and adding separate `codex-summary` and `openai-api-summary` rows.

Popup copy:

```text
Codex: 5h 91% frei · Woche 99% frei
OpenAI API: $7.12 MTD · 128K Tokens · 9 Requests
```

Every numeric formatter must first check `Number.isFinite(Number(value))`.

- [ ] **Step 4: Run extension verification**

```bash
node --test extension/tests/usage-parsers.test.js
node --check extension/background.js
node --check extension/background-scraper-codex.js
node --check extension/background-scraper-openai-api.js
node --check extension/popup.js
```

Expected: all PASS with exit 0.

- [ ] **Step 5: Commit extension orchestration**

```bash
git add extension/background-scraper-openai-api.js extension/tests/usage-parsers.test.js extension/background.js extension/manifest.json extension/popup.html extension/popup.js
git commit -m "feat(extension): sync OpenAI API usage"
```

---

### Task 4: Backend source acceptance, summary, and exactly-once totals

**Files:**
- Modify: `backend/src/types/models.ts`
- Modify: `backend/src/controllers/usageController.ts`
- Create: `backend/src/__tests__/integration/openaiUsageFlow.test.ts`

**Interfaces:**
- Adds `SourceType.CodexSync = 'codex_sync'`.
- Adds `SourceType.OpenAiApiSync = 'openai_api_sync'`.
- Produces `combined.codex` and `combined.openai_api` from `/api/usage/summary`.
- Produces `openai_api` from `/api/usage/spending-total`.

- [ ] **Step 1: Write failing integration tests**

Follow `consoleModelBreakdown.test.ts` setup with a temporary SQLite database and authenticated user. POST two same-day Codex snapshots and assert one stored row. POST two same-day OpenAI API snapshots and assert one stored row with the second cost.

Then assert summary fields:

```ts
expect(res.body.combined.codex).toMatchObject({
  five_hour_remaining_pct: 91,
  weekly_remaining_pct: 99,
  credits_remaining: 0
});
expect(res.body.combined.openai_api).toMatchObject({
  organization_name: 'wolfini',
  period_start: '2026-06-01',
  cost_usd: 7.12,
  total_input_tokens: 120000,
  total_output_tokens: 8000,
  requests: 9
});
```

Mock or spy `convertUsdToEur` at a deterministic `0.90` rate and assert:

```ts
expect(total.body.openai_api.cost_usd).toBeCloseTo(7.12, 2);
expect(total.body.openai_api.total_eur).toBeCloseTo(6.408, 3);
expect(total.body.grand_total_eur - totalWithoutOpenAi).toBeCloseTo(6.408, 3);
```

Also assert Codex adds `0` to the grand total.

- [ ] **Step 2: Run the focused integration test**

Run: `cd backend && NODE_ENV=production npm test -- --runInBand src/__tests__/integration/openaiUsageFlow.test.ts`

Expected: FAIL because the source enum and response blocks do not exist.

- [ ] **Step 3: Implement backend mappings**

Add both sources to the single `SYNC_SOURCES` list. Do not add duplicate source-specific DELETE blocks.

In `getSummary`, fetch the latest row for each source, parse metadata defensively, and expose normalized objects. Use finite guards for every numeric field. Preserve optional arrays as arrays.

In `getSpendingTotal`:

- fetch the latest current-calendar-month `openai_api_sync` row;
- use `cost_usd`, not token pricing, as authoritative spend;
- convert through `convertUsdToEur`;
- add the EUR result once to `grand_total_eur`;
- include `openai_api_sync` in generic-breakdown exclusions;
- return organization, period, USD, EUR, and last sync.

Keep `codex_sync` in generic-breakdown exclusions but never add it to monetary totals.

- [ ] **Step 4: Run backend verification**

```bash
cd backend
NODE_ENV=production npm test -- --runInBand src/__tests__/integration/openaiUsageFlow.test.ts
npm run type-check
NODE_ENV=production npm test -- --runInBand
```

Expected: focused test PASS, type-check PASS, full suite reports all tests PASS.

- [ ] **Step 5: Commit backend support**

```bash
git add backend/src/types/models.ts backend/src/controllers/usageController.ts backend/src/__tests__/integration/openaiUsageFlow.test.ts
git commit -m "feat(backend): aggregate Codex and OpenAI usage"
```

---

### Task 5: Typed dashboard cards and combined-cost integration

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/components/CodexUsageCard.tsx`
- Create: `frontend/src/components/OpenAiApiCard.tsx`
- Create: `frontend/src/components/__tests__/CodexUsageCard.test.tsx`
- Create: `frontend/src/components/__tests__/OpenAiApiCard.test.tsx`
- Modify: `frontend/src/components/OverviewTab.tsx`
- Modify: `frontend/src/components/CombinedCostTab.tsx`

**Interfaces:**
- Produces `CodexSpend` and `OpenAiApiSpend` interfaces.
- `CodexUsageCard({ usage: CodexSpend })` renders remaining capacity.
- `OpenAiApiCard({ usage: OpenAiApiSpend, usdToEur: number })` renders month-to-date API spend.

- [ ] **Step 1: Add typed API contracts**

Add exact interfaces:

```ts
export interface CodexSpend {
  five_hour_remaining_pct: number | null;
  five_hour_reset_at: string | null;
  weekly_remaining_pct: number | null;
  weekly_reset_at: string | null;
  credits_remaining: number | null;
  interactions: number;
  interactions_by_model: Array<{ label: string; count: number }>;
  interactions_by_surface: Array<{ label: string; count: number }>;
  plugin_calls: number;
  skills_used: number;
  last_synced: string;
}

export interface OpenAiApiSpend {
  organization_name: string;
  period_start: string;
  period_end: string;
  cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  requests: number;
  by_project: Array<{ name: string; cost_usd: number }>;
  by_model: Array<{ name: string; cost_usd: number; input_tokens: number; output_tokens: number }>;
  last_synced: string;
}
```

Add `codex` and `openai_api` to `CombinedSpendBreakdown`; add `openai_api` to `SpendingTotal`.

- [ ] **Step 2: Write failing card tests**

Codex tests must assert `91% frei` and `99% frei`, reset text, credits, and that high remaining capacity uses the healthy color class. OpenAI API tests must assert organization name, `$7.12`, converted EUR, `128K Tokens`, `9 Requests`, and zero usage formatting without `NaN`.

Run:

```bash
cd frontend
npx vitest run src/components/__tests__/CodexUsageCard.test.tsx src/components/__tests__/OpenAiApiCard.test.tsx
```

Expected: FAIL because components are missing.

- [ ] **Step 3: Implement focused cards**

`CodexUsageCard` clamps finite percentages to `[0, 100]`. Color semantics are based on remaining capacity: `>= 50` emerald, `>= 20` amber, otherwise red. Labels always include `frei` or `verbleibend`.

`OpenAiApiCard` uses existing `formatUsd`, `formatEur`, `formatNumber`, and relative-time helpers. It displays the verified period and active organization. Optional project/model lists render only when non-empty.

- [ ] **Step 4: Integrate cards and monetary sums**

In `OverviewTab`, read `combined.codex` and `combined.openai_api`, render both focused components, and pass `combined.exchange_rate.usd_to_eur` with a finite fallback.

In `CombinedCostTab`, add OpenAI API EUR spend to displayed sources, total, and forecast once. Do not add Codex. Keep OpenCode API as a separate source.

- [ ] **Step 5: Run frontend verification**

```bash
cd frontend
npx vitest run src/components/__tests__/CodexUsageCard.test.tsx src/components/__tests__/OpenAiApiCard.test.tsx
npm run type-check
npm run build
```

Expected: card tests PASS; type-check and build PASS. If the documented pre-existing test TypeScript errors remain, record their unchanged signatures and verify the production build separately rather than editing unrelated tests.

- [ ] **Step 6: Commit frontend support**

```bash
git add frontend/src/types/api.ts frontend/src/components/CodexUsageCard.tsx frontend/src/components/OpenAiApiCard.tsx frontend/src/components/__tests__/CodexUsageCard.test.tsx frontend/src/components/__tests__/OpenAiApiCard.test.tsx frontend/src/components/OverviewTab.tsx frontend/src/components/CombinedCostTab.tsx
git commit -m "feat(frontend): show Codex and OpenAI usage"
```

---

### Task 6: Documentation, full verification, and live round trip

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Documents the new host permission, source semantics, active-organization limitation, and round-trip procedure.
- Adds a dated handoff entry with exact verification evidence and remaining issues.

- [ ] **Step 1: Update README and AGENTS.md**

README must state:

- Codex and active-organization OpenAI API are now tracked;
- OpenAI API totals are calendar-month-to-date;
- only API spend affects the grand total;
- Chrome may require re-approval for `chatgpt.com` access;
- users need OpenAI Usage Dashboard permission;
- reload and manual sync steps.

AGENTS.md must update the source count and grand-total rule, add `chatgpt.com` scraper resilience notes, and append a dated handoff containing touched files, live labels, test counts, and any unresolved selectors.

- [ ] **Step 2: Run complete static and automated verification**

```bash
node --test extension/tests/usage-parsers.test.js
node --check extension/background.js
node --check extension/background-scraper-codex.js
node --check extension/background-scraper-openai-api.js
node --check extension/popup.js
cd backend && npm run type-check
cd backend && NODE_ENV=production npm test -- --runInBand
cd frontend && npm run type-check
cd frontend && npm run build
```

Record exact pass counts. Do not claim a failing command passed.

- [ ] **Step 3: Perform the Chrome round trip**

1. Reload the unpacked extension and approve `chatgpt.com` if prompted.
2. Toggle the extension off/on to ensure a fresh service worker.
3. Open popup and click **Alle synchronisieren**.
4. Confirm exactly one active shared tab navigates through all providers and closes.
5. Confirm Codex values match the live analytics page: 5-hour remaining, weekly remaining, reset timestamps, and credits.
6. Confirm OpenAI API organization and month-to-date cost match Platform.
7. Confirm popup shows both rows without `NaN`.
8. Confirm dashboard cards show the same values.
9. Confirm `grand_total_eur` increases by OpenAI API EUR spend exactly once.
10. Verify a no-permission organization reports `permission_required` while preserving the last successful snapshot.

- [ ] **Step 4: Commit documentation and verification notes**

```bash
git add README.md AGENTS.md
git commit -m "docs(tracker): document OpenAI usage sources"
```

- [ ] **Step 5: Final repository audit**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: only the user's pre-existing unrelated OpenCode files remain dirty, unless they were intentionally incorporated into Task 3. Report any remaining uncommitted file explicitly.
