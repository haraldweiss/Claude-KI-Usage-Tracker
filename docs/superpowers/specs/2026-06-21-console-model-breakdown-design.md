# Console Model Breakdown Scraper — Design Spec

**Date:** 2026-06-21  
**Status:** Approved

---

## Problem

The existing `consoleSync()` scrapes per-API-key cost totals from the Anthropic Console keys page. This tells us *how much* each key spent, but not *which model* drove the cost. Yesterday's $17.86 spike on `wolfini-vps-2026-05-30` could not be attributed to a specific model without visiting the Console manually.

---

## Goal

Scrape the Anthropic Console cost page per workspace and store a per-model breakdown for:
- **Last 24 hours** — daily delta for anomaly detection
- **Current month** — monthly rollup consistent with existing key-level data

---

## Architecture

### 1. Extension — `background-scraper-console.js`

**New function:** `scrapeWorkspaceCost(tabId, workspaceId, period)`

- Navigates tab to `https://platform.claude.com/settings/workspaces/<id>/cost`
- Waits for React to render the date-range filter UI
- Clicks the date dropdown and selects the target period:
  - `'day'` → "Last 24 hours" (or equivalent label)
  - `'month'` → "This month" (or equivalent label)
- Waits for the model table to load
- Scrapes rows: Model name, Input tokens, Output tokens, Cost (USD)
- Returns `{ rows: [{ model, input_tokens, output_tokens, cost_usd }], period, error? }`

**`consoleSync()` changes:**

After the existing per-workspace keys scrape, for each workspace:
1. Call `scrapeWorkspaceCost(tabId, ws.id, 'day')` → POST each row as `anthropic_console_cost_day`
2. Call `scrapeWorkspaceCost(tabId, ws.id, 'month')` → POST each row as `anthropic_console_cost_month`

Both calls are best-effort: a failure logs a warning but does not abort the rest of the sync.

**Selector strategy:**

The cost page date filter is a React dropdown. Approach:
1. Inject `executeScript` that clicks the filter trigger (look for `[aria-haspopup]` or a button containing the current period label)
2. Wait 1-2s for the dropdown to open
3. Click the option matching the target period text
4. Wait for table re-render (poll until rows stabilize or 10s timeout)
5. Read model table rows via `querySelectorAll('table tbody tr')`

Fall back gracefully if the filter click fails — still read whatever the default period shows, log which period was actually scraped.

### 2. Backend — `usageController.ts`

**Two new sources added to `SYNC_SOURCES`:**
```
'anthropic_console_cost_day'
'anthropic_console_cost_month'
```

**Dedupe logic** (identical pattern to `anthropic_console_sync`):
```sql
DELETE FROM usage_records
WHERE source = ?
  AND date(timestamp) = date('now')
  AND user_id = ?
```

Runs before each batch of inserts for that source. No schema changes — `usage_records` already has `model`, `input_tokens`, `output_tokens`, `cost_usd`, `workspace`, `source`.

**`cost_usd` vs computed `cost`:**  
The scraper sends `cost_usd` directly from the Anthropic Console (authoritative). The backend also computes `cost` from pricing rows as it does today — both are stored. The `cost_usd` column wins for display purposes on these sources.

**Grand total / `getSpendingTotal`:** Console cost sources are NOT added to `grand_total_eur` — the existing `anthropic_console_sync` key-level totals already cover this spend. Adding the model breakdown would double-count.

**Summary endpoint (`/summary`):** Expose the two new sources under a new `console_model_breakdown` key:
```json
{
  "console_model_breakdown": {
    "day":   [{ "model": "claude-opus-4-5", "input_tokens": 120000, "output_tokens": 8000, "cost_usd": 17.86 }],
    "month": [{ "model": "claude-opus-4-5", "input_tokens": 340000, "output_tokens": 22000, "cost_usd": 41.20 }]
  }
}
```

### 3. Frontend

**New component:** `ConsoleModelBreakdown.tsx`

Location: `frontend/src/components/ConsoleModelBreakdown.tsx`

Rendered inside `ApiKeysDetailTable.tsx` (below the existing keys table) or as a collapsible panel.

UI:
- Two segment buttons: **"Letzte 24h"** / **"Aktueller Monat"**
- Table: Model | Input-Tokens | Output-Tokens | Kosten (€)
- Rows sorted by cost descending
- If no data yet: placeholder "Noch kein Model-Breakdown — Extension syncen"

**Type additions** (`frontend/src/types/api.ts`):
```ts
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

---

## Error Handling

- If the cost page never loads → log warning, skip breakdown for that workspace, keys sync continues normally
- If date filter click fails → read default period, log which period was actually captured
- If table is empty → log, return `{ rows: [] }` — not a fatal error

---

## What Is NOT Changed

- Grand total calculation — no double-counting
- Existing `anthropic_console_sync` keys scrape — unchanged
- Database schema — no migration needed
- VPS deploy process — standard `docker cp` of backend + frontend dist

---

## Success Criteria

1. After a sync, `usage_records` contains rows with `source = 'anthropic_console_cost_day'` and `source = 'anthropic_console_cost_month'` with real model names (e.g. `claude-opus-4-5`, `claude-sonnet-4-5`)
2. Dashboard shows "Model Breakdown" panel with both time segments
3. Grand total in OverviewTab is unchanged (no double-count)
4. A model causing a cost spike is visible in the "Letzte 24h" view without manual Console visits
