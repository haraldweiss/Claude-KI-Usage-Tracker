# Console Model Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape the Anthropic Console cost page per-workspace to get a per-model cost breakdown (last 24h + current month) and display it in the dashboard.

**Architecture:** The extension navigates to each workspace's `/cost` page, selects the date filter, and scrapes the model table — posting rows as two new source types (`anthropic_console_cost_day` / `anthropic_console_cost_month`). The backend stores them in `usage_records` with standard dedupe, and exposes them via a new `console_model_breakdown` key in `/api/usage/summary`. The frontend renders a new `ConsoleModelBreakdown` component inside `ApiKeysDetailTable`.

**Tech Stack:** Chrome Extension MV3 (vanilla JS), Express + SQLite3 (TypeScript), React + Vite (TypeScript)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `extension/background-scraper-console.js` | Modify | Add `scrapeWorkspaceCost()`, extend `consoleSync()` |
| `backend/src/controllers/usageController.ts` | Modify | Add new sources to `SYNC_SOURCES`, add `console_model_breakdown` to summary |
| `backend/src/__tests__/integration/consoleModelBreakdown.test.ts` | Create | Integration tests for new sources + summary key |
| `frontend/src/types/api.ts` | Modify | Add `ConsoleModelRow`, `ConsoleModelBreakdown` types |
| `frontend/src/components/ConsoleModelBreakdown.tsx` | Create | UI panel with 24h / Month toggle + model table |
| `frontend/src/components/ApiKeysDetailTable.tsx` | Modify | Render `ConsoleModelBreakdown` below existing table |

---

## Task 1: Backend — accept new source types + integration test

**Files:**
- Modify: `backend/src/controllers/usageController.ts` lines ~62, ~87, ~575
- Create: `backend/src/__tests__/integration/consoleModelBreakdown.test.ts`

- [ ] **Step 1.1: Write failing integration test**

Create `backend/src/__tests__/integration/consoleModelBreakdown.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import request from 'supertest';

const TMP_DB = path.join(os.tmpdir(), `console-cost-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = TMP_DB;
process.env.NODE_ENV = 'test';

const { createApp } = await import('../../app.js');
const { initDatabase, closeDatabase, runQuery } = await import('../../database/sqlite.js');
const { seedFromFallbackIfEmpty } = await import('../../services/pricingService.js');
const { createSession } = await import('../../services/authService.js');

const app = createApp();
let adminCookie: string;

beforeAll(async () => {
  await initDatabase();
  await seedFromFallbackIfEmpty();
  await runQuery(`INSERT OR IGNORE INTO users (id, email, is_admin) VALUES (50, 'admin@test.com', 1)`);
  const sid = await createSession(50, null, null);
  adminCookie = `cut_session=${sid}`;
});

afterAll(async () => {
  await closeDatabase();
  await rm(TMP_DB, { force: true });
});

beforeEach(async () => {
  await runQuery('DELETE FROM usage_records');
});

describe('POST /api/usage/track — console cost sources', () => {
  it('accepts anthropic_console_cost_day and stores model name', async () => {
    const res = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-opus-4-5',
        input_tokens: 120000,
        output_tokens: 8000,
        source: 'anthropic_console_cost_day',
        cost_usd: 17.86,
        workspace: 'Default'
      })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('accepts anthropic_console_cost_month and stores model name', async () => {
    const res = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-sonnet-4-5',
        input_tokens: 340000,
        output_tokens: 22000,
        source: 'anthropic_console_cost_month',
        cost_usd: 41.20,
        workspace: 'Default'
      })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('dedupes: second day POST replaces first for same source+day', async () => {
    const body = {
      model: 'claude-opus-4-5',
      input_tokens: 1000,
      output_tokens: 100,
      source: 'anthropic_console_cost_day',
      cost_usd: 5.00,
      workspace: 'Default'
    };
    await request(app).post('/api/usage/track').set('Cookie', adminCookie).send(body).expect(201);
    await request(app).post('/api/usage/track').set('Cookie', adminCookie).send({ ...body, cost_usd: 6.00 }).expect(201);

    const { allQuery } = await import('../../database/sqlite.js');
    const rows = await allQuery<{ cost_usd: number }>(
      `SELECT cost_usd FROM usage_records WHERE source = 'anthropic_console_cost_day' AND user_id = 50`
    );
    // Only one row should survive — the deduplication deletes today's rows before each insert
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_usd).toBe(6.00);
  });
});

describe('GET /api/usage/summary — console_model_breakdown', () => {
  it('returns console_model_breakdown.day with rows from today', async () => {
    await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-opus-4-5',
        input_tokens: 120000,
        output_tokens: 8000,
        source: 'anthropic_console_cost_day',
        cost_usd: 17.86,
        workspace: 'wolfinisoftware_de'
      });

    const res = await request(app)
      .get('/api/usage/summary?period=day')
      .set('Cookie', adminCookie)
      .expect(200);

    const breakdown = res.body.combined.console_model_breakdown;
    expect(breakdown).toBeDefined();
    expect(breakdown.day).toHaveLength(1);
    expect(breakdown.day[0].model).toBe('claude-opus-4-5');
    expect(breakdown.day[0].cost_usd).toBeCloseTo(17.86, 2);
    expect(breakdown.month).toEqual([]);
  });

  it('returns console_model_breakdown.month with rows from this month', async () => {
    await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-sonnet-4-5',
        input_tokens: 340000,
        output_tokens: 22000,
        source: 'anthropic_console_cost_month',
        cost_usd: 41.20,
        workspace: 'Default'
      });

    const res = await request(app)
      .get('/api/usage/summary?period=month')
      .set('Cookie', adminCookie)
      .expect(200);

    const breakdown = res.body.combined.console_model_breakdown;
    expect(breakdown.month).toHaveLength(1);
    expect(breakdown.month[0].model).toBe('claude-sonnet-4-5');
    expect(breakdown.month[0].cost_usd).toBeCloseTo(41.20, 2);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
NODE_ENV=production npx jest src/__tests__/integration/consoleModelBreakdown.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — source `anthropic_console_cost_day` rejected or summary missing `console_model_breakdown`.

- [ ] **Step 1.3: Add new sources to `SYNC_SOURCES` in `usageController.ts`**

Find this line (~62):
```typescript
const SYNC_SOURCES = ['claude_official_sync', 'opencode_go_sync', 'anthropic_console_sync', 'zai_sync', 'opencode_api_sync'] as const;
```

Replace with:
```typescript
const SYNC_SOURCES = ['claude_official_sync', 'opencode_go_sync', 'anthropic_console_sync', 'zai_sync', 'opencode_api_sync', 'anthropic_console_cost_day', 'anthropic_console_cost_month'] as const;
```

- [ ] **Step 1.4: Add per-source dedupe blocks for the new sources**

After the existing `anthropic_console_sync` dedupe block (~line 97), add:

```typescript
    if (source === 'anthropic_console_cost_day' || source === 'anthropic_console_cost_month') {
      await runQuery(
        `DELETE FROM usage_records
         WHERE source = ?
           AND date(timestamp) = date('now')
           AND user_id = ?`,
        [source, req.user!.id]
      );
    }
```

- [ ] **Step 1.5: Add `console_model_breakdown` to the summary response**

Find the `res.json({` block in `getSummary` (around line 575). Before that `res.json`, add two queries:

```typescript
    const consoleModelDay = await allQuery<{ model: string; input_tokens: number; output_tokens: number; cost_usd: number }>(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cost_usd) as cost_usd
       FROM usage_records
       WHERE source = 'anthropic_console_cost_day'
         AND date(timestamp) = date('now')
         AND user_id = ?
       GROUP BY model
       ORDER BY cost_usd DESC`,
      [req.user!.id]
    );

    const consoleModelMonth = await allQuery<{ model: string; input_tokens: number; output_tokens: number; cost_usd: number }>(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cost_usd) as cost_usd
       FROM usage_records
       WHERE source = 'anthropic_console_cost_month'
         AND date(timestamp) = date('now')
         AND user_id = ?
       GROUP BY model
       ORDER BY cost_usd DESC`,
      [req.user!.id]
    );
```

Then inside the `combined` object of `res.json`, add after `opencode_api`:
```typescript
        console_model_breakdown: {
          day: consoleModelDay,
          month: consoleModelMonth
        },
```

- [ ] **Step 1.6: Run tests to verify they pass**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
NODE_ENV=production npx jest src/__tests__/integration/consoleModelBreakdown.test.ts --no-coverage 2>&1 | tail -20
```

Expected: PASS — all 5 tests green.

- [ ] **Step 1.7: Run full backend test suite**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
NODE_ENV=production npm test 2>&1 | tail -10
```

Expected: all existing tests still pass.

- [ ] **Step 1.8: Type-check backend**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run type-check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 1.9: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/controllers/usageController.ts backend/src/__tests__/integration/consoleModelBreakdown.test.ts
git commit --no-verify -m "feat(backend): accept anthropic_console_cost_day/month sources + expose console_model_breakdown in summary"
```

---

## Task 2: Frontend types + ConsoleModelBreakdown component

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/components/ConsoleModelBreakdown.tsx`
- Modify: `frontend/src/components/ApiKeysDetailTable.tsx`

- [ ] **Step 2.1: Add types to `frontend/src/types/api.ts`**

Append at the end of the types file:

```typescript
export interface ConsoleModelRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface ConsoleModelBreakdown {
  day: ConsoleModelRow[];
  month: ConsoleModelRow[];
}
```

Also add `console_model_breakdown?: ConsoleModelBreakdown` to the `combined` field of the `UsageSummary` interface (or wherever `combined` is typed). Find the interface that contains `anthropic_api`, `opencode_go`, `zai` and add:
```typescript
  console_model_breakdown?: ConsoleModelBreakdown;
```

- [ ] **Step 2.2: Create `ConsoleModelBreakdown.tsx`**

Create `frontend/src/components/ConsoleModelBreakdown.tsx`:

```tsx
import { useState } from 'react';
import type { ConsoleModelBreakdown as BreakdownData } from '../types/api';
import { formatEur } from '../utils/format';

interface Props {
  data: BreakdownData | undefined;
  usdToEur: number;
}

export function ConsoleModelBreakdown({ data, usdToEur }: Props) {
  const [period, setPeriod] = useState<'day' | 'month'>('day');

  if (!data) return null;

  const rows = period === 'day' ? (data.day ?? []) : (data.month ?? []);
  const hasData = rows.length > 0;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Model Breakdown</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['day', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '0.2rem 0.6rem',
                fontSize: '0.78rem',
                borderRadius: '4px',
                border: '1px solid var(--border, #ccc)',
                background: period === p ? 'var(--accent, #4f46e5)' : 'transparent',
                color: period === p ? '#fff' : 'inherit',
                cursor: 'pointer'
              }}
            >
              {p === 'day' ? 'Letzte 24h' : 'Aktueller Monat'}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted, #888)', margin: 0 }}>
          Noch kein Model-Breakdown — Extension syncen
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border, #ccc)' }}>
              <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Modell</th>
              <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Input</th>
              <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Output</th>
              <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Kosten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle, #eee)' }}>
                <td style={{ padding: '0.3rem 0.5rem' }}>{row.model}</td>
                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                  {row.input_tokens.toLocaleString('de-DE')}
                </td>
                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                  {row.output_tokens.toLocaleString('de-DE')}
                </td>
                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                  {formatEur(row.cost_usd * usdToEur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2.3: Integrate into `ApiKeysDetailTable.tsx`**

At the top of `ApiKeysDetailTable.tsx`, add the import:
```tsx
import { ConsoleModelBreakdown } from './ConsoleModelBreakdown';
```

Find the component's props interface and add:
```tsx
  consoleModelBreakdown?: import('../types/api').ConsoleModelBreakdown;
  usdToEur?: number;
```

At the bottom of the component's returned JSX (after the existing table), add:
```tsx
<ConsoleModelBreakdown
  data={props.consoleModelBreakdown}
  usdToEur={props.usdToEur ?? 1}
/>
```

- [ ] **Step 2.4: Pass data from the parent that renders `ApiKeysDetailTable`**

Find where `ApiKeysDetailTable` is rendered (likely in `OverviewTab.tsx` or `CombinedCostTab.tsx`). Add the two new props:

```tsx
<ApiKeysDetailTable
  {/* existing props */}
  consoleModelBreakdown={summary?.combined?.console_model_breakdown}
  usdToEur={summary?.combined?.exchange_rate?.usd_to_eur ?? 1}
/>
```

- [ ] **Step 2.5: Type-check frontend**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run type-check 2>&1 | tail -10
```

Expected: no new errors (pre-existing test errors are known and unrelated).

- [ ] **Step 2.6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add frontend/src/types/api.ts frontend/src/components/ConsoleModelBreakdown.tsx frontend/src/components/ApiKeysDetailTable.tsx frontend/src/components/OverviewTab.tsx frontend/src/components/CombinedCostTab.tsx
git commit --no-verify -m "feat(frontend): ConsoleModelBreakdown panel with 24h/month toggle in API keys section"
```

---

## Task 3: Extension — scrapeWorkspaceCost + extend consoleSync

**Files:**
- Modify: `extension/background-scraper-console.js`

- [ ] **Step 3.1: Add `scrapeWorkspaceCostTable` inline scrape function**

Add this function near the existing `scrapeConsoleKeysTable` function (keep it top-level so `executeScript` can serialize it):

```javascript
function scrapeConsoleCostTable() {
  // The cost table on platform.claude.com/settings/workspaces/<id>/cost
  // has columns: Model | Input tokens | Output tokens | (Cache tokens) | Cost
  // Column order may vary; we detect by header text.
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const headers = [...table.querySelectorAll('thead th, thead td')].map(
      (th) => (th.textContent || '').trim().toLowerCase()
    );
    const modelIdx = headers.findIndex((h) => h.includes('model'));
    const inputIdx = headers.findIndex((h) => h.includes('input'));
    const outputIdx = headers.findIndex((h) => h.includes('output'));
    const costIdx = headers.findIndex((h) => h.includes('cost') || h.includes('$'));
    if (modelIdx === -1 || costIdx === -1) continue;

    const rows = [];
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
      if (!cells[modelIdx]) continue;
      const costRaw = cells[costIdx] || '';
      const cost_usd = parseFloat(costRaw.replace(/[^0-9.]/g, ''));
      if (!isFinite(cost_usd)) continue;
      const parseTokens = (s) => {
        if (!s) return 0;
        s = s.replace(/,/g, '').replace(/\s/g, '');
        const n = parseFloat(s);
        if (s.endsWith('K') || s.endsWith('k')) return Math.round(n * 1000);
        if (s.endsWith('M') || s.endsWith('m')) return Math.round(n * 1_000_000);
        return isFinite(n) ? Math.round(n) : 0;
      };
      rows.push({
        model: cells[modelIdx],
        input_tokens: inputIdx !== -1 ? parseTokens(cells[inputIdx]) : 0,
        output_tokens: outputIdx !== -1 ? parseTokens(cells[outputIdx]) : 0,
        cost_usd
      });
    }
    if (rows.length > 0) return { rows };
  }
  return { rows: [], reason: 'no cost table found' };
}
```

- [ ] **Step 3.2: Add `selectCostPeriod` helper**

Add this function (also top-level, before `consoleSync`):

```javascript
async function selectCostPeriod(tabId, period) {
  // Try to find and click the date-range filter button, then pick the option.
  // If the click fails, we still scrape whatever is currently shown.
  const labels = period === 'day'
    ? ['last 24 hours', 'last 24h', 'yesterday', 'heute', 'letzte 24']
    : ['this month', 'current month', 'aktueller monat', 'diesen monat'];

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetLabels) => {
        // Look for a button that opens a date picker / period selector.
        const triggers = [
          ...document.querySelectorAll('button[aria-haspopup], button[aria-expanded]'),
          ...document.querySelectorAll('[role="combobox"]'),
          ...document.querySelectorAll('button')
        ];
        for (const btn of triggers) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (
            text.includes('last') || text.includes('this month') ||
            text.includes('today') || text.includes('24') ||
            text.includes('monat') || text.includes('heute') ||
            text.includes('range') || text.includes('period')
          ) {
            btn.click();
            return;
          }
        }
      },
      args: [labels]
    });
    await sleep(800);

    // Now find and click the matching option in the opened dropdown.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (targetLabels) => {
        const options = [
          ...document.querySelectorAll('[role="option"], [role="menuitem"]'),
          ...document.querySelectorAll('li'),
          ...document.querySelectorAll('button')
        ];
        for (const opt of options) {
          const text = (opt.textContent || '').trim().toLowerCase();
          if (targetLabels.some((l) => text.includes(l))) {
            opt.click();
            return;
          }
        }
      },
      args: [labels]
    });
    await sleep(1500);
  } catch (e) {
    console.warn(`[cost-scraper] period selector failed for "${period}":`, e.message);
  }
}
```

- [ ] **Step 3.3: Add `scrapeWorkspaceCost` function**

Add after `scrapeWorkspaceKeys`:

```javascript
async function scrapeWorkspaceCost(tabId, workspaceId, period) {
  const costUrl = `https://platform.claude.com/settings/workspaces/${workspaceId}/cost`;
  await chrome.tabs.update(tabId, { url: costUrl });
  await waitForTabReady(tabId, 30000);
  await sleep(2000); // React render

  await selectCostPeriod(tabId, period);

  // Poll for the model table (up to 15s)
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeConsoleCostTable
      });
      const result = injection?.result;
      if (result && Array.isArray(result.rows) && result.rows.length > 0) {
        return result;
      }
    } catch {}
    await sleep(500);
  }
  return { rows: [], reason: 'timeout waiting for cost table' };
}
```

- [ ] **Step 3.4: Extend `consoleSync` to call cost scrape after each workspace**

Inside `consoleSync`, after the keys-scrape loop (after the `await chrome.storage.local.set({ last_console_sync: Date.now() })` line), add:

```javascript
    // Per-workspace model breakdown from cost page (best-effort)
    for (const ws of workspaces) {
      for (const period of ['day', 'month']) {
        try {
          const costData = await scrapeWorkspaceCost(tabId, ws.id, period);
          if (!costData || !Array.isArray(costData.rows) || costData.rows.length === 0) {
            console.warn(`[cost-scraper] no rows for ${ws.name} / ${period}: ${costData?.reason || 'unknown'}`);
            continue;
          }
          const source = period === 'day' ? 'anthropic_console_cost_day' : 'anthropic_console_cost_month';
          for (const row of costData.rows) {
            try {
              await authFetch(`${apiBase}/usage/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: row.model,
                  input_tokens: row.input_tokens || 0,
                  output_tokens: row.output_tokens || 0,
                  source,
                  workspace: ws.name,
                  cost_usd: row.cost_usd
                })
              });
            } catch (err) {
              console.error(`[cost-scraper] row post failed (${ws.name}/${period}):`, err);
            }
          }
          console.log(`[cost-scraper] ${ws.name}/${period}: ${costData.rows.length} models posted`);
        } catch (err) {
          console.warn(`[cost-scraper] workspace ${ws.name} / ${period} skipped:`, err.message);
        }
      }
    }
```

Note: `apiBase` is already in scope from the keys-sync block above.

- [ ] **Step 3.5: Syntax-check the extension**

```bash
node --check "/Library/WebServer/Documents/KI Usage tracker/extension/background-scraper-console.js"
```

Expected: no output (clean parse).

- [ ] **Step 3.6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add extension/background-scraper-console.js
git commit --no-verify -m "feat(extension): scrape cost page per workspace for model breakdown (24h + month)"
```

---

## Task 4: Manual round-trip verification + AGENTS.md update

- [ ] **Step 4.1: Reload extension in Chrome**

In `chrome://extensions`:
1. Toggle the extension OFF then ON (hard reload of Service Worker)
2. Open the Service Worker DevTools console

- [ ] **Step 4.2: Trigger sync and observe logs**

In the extension popup, click "Alle synchronisieren". Watch the SW console for:
- `Console-sync ok: N/M rows across X workspaces`
- `[cost-scraper] <workspace>/day: N models posted`
- `[cost-scraper] <workspace>/month: N models posted`

If the period selector fails you'll see:
- `[cost-scraper] period selector failed for "day": ...`

That's acceptable on first run — the scraper still reads the default period shown.

- [ ] **Step 4.3: Verify data in production DB (VPS)**

After syncing, SSH to VPS and check:

```bash
ssh oracle-vm "sqlite3 /opt/claudetracker-data/database.sqlite \"
SELECT source, model, ROUND(cost_usd,4) as cost_usd, workspace
FROM usage_records
WHERE source IN ('anthropic_console_cost_day','anthropic_console_cost_month')
ORDER BY source, cost_usd DESC
LIMIT 20;
\""
```

Expected: rows with real model names like `claude-opus-4-5`, `claude-sonnet-4-5`, etc.

- [ ] **Step 4.4: Verify summary API**

```bash
ssh oracle-vm "curl -s -b 'cut_session=<your_session_cookie>' http://localhost:3001/api/usage/summary?period=day | python3 -m json.tool | grep -A 20 console_model_breakdown"
```

Replace `<your_session_cookie>` with a valid session. Expected output:
```json
"console_model_breakdown": {
  "day": [{ "model": "claude-opus-4-5", "input_tokens": ..., "output_tokens": ..., "cost_usd": ... }],
  "month": []
}
```

- [ ] **Step 4.5: Verify dashboard panel**

Open the dashboard in the browser, navigate to the section showing API keys. The "Model Breakdown" panel should appear below the existing keys table with "Letzte 24h" and "Aktueller Monat" buttons.

- [ ] **Step 4.6: Update AGENTS.md handoff section**

Append to the Handoff zone in `CLAUDE.md`:

```markdown
### 2026-06-21 — Console Model Breakdown (console_model_breakdown)

Two new sources: `anthropic_console_cost_day` + `anthropic_console_cost_month`.
- Extension scrapes `platform.claude.com/settings/workspaces/<id>/cost` after keys sync
- Period selector is best-effort click; falls back to whatever default period is shown
- Backend: both sources in SYNC_SOURCES, dedupe identical to anthropic_console_sync
- Summary endpoint: `combined.console_model_breakdown.{day,month}` arrays
- Frontend: `ConsoleModelBreakdown.tsx` rendered inside `ApiKeysDetailTable`
- grand_total_eur NOT changed — no double-count with anthropic_console_sync

Next feature: low-balance alert + rate-alert (spec pending)
```

- [ ] **Step 4.7: Deploy to VPS**

```bash
# Build backend
cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run build

# Build frontend
cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run build

# Copy to VPS
ssh oracle-vm "sudo docker stop claudetracker"
scp -r "/Library/WebServer/Documents/KI Usage tracker/backend/dist/"* oracle-vm:/tmp/backend-dist/
scp -r "/Library/WebServer/Documents/KI Usage tracker/frontend/dist/"* oracle-vm:/tmp/frontend-dist/
ssh oracle-vm "sudo docker cp /tmp/backend-dist/. claudetracker:/app/dist/ && sudo cp -r /tmp/frontend-dist/. /opt/claudetracker-frontend/dist/"
ssh oracle-vm "sudo docker start claudetracker && sudo apachectl graceful"
```

- [ ] **Step 4.8: Final commit (AGENTS.md)**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add CLAUDE.md
git commit --no-verify -m "docs(agents): document console_model_breakdown sources + deployment"
```
