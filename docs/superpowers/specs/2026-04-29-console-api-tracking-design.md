# Design Spec: Combined claude.ai + Anthropic Console API Cost Tracking

**Date:** 2026-04-29
**Project:** Claude Usage Tracker
**Status:** Draft — replaces 2026-04-29-data-quality-insights-design.md (pivoted: per-message data unavailable)

---

## Why this exists

The previous design assumed we could intercept claude.ai message traffic to feed a Haiku categorizer. Reality: claude.ai's web UI no longer exposes per-message tokens, so the project already pivoted to scraping the cumulative `claude.ai/settings/usage` page on a 10-minute interval. That gives one number — total monthly subscription spend — and nothing else.

The user pays for **two** Claude products:

1. **claude.ai** — flat subscription, scraped from `claude.ai/settings/usage`
2. **Anthropic Console API** — per-token billing, visible in `console.anthropic.com/settings/keys`

The new goal is a **combined cost view** across both, with drilldown by source, workspace, and key. No categorization, no per-message tracking — the underlying data simply doesn't support it.

---

## Architecture

Extend the existing scraping pattern. The extension already opens `claude.ai/settings/usage` in a hidden tab and POSTs the result to the backend. Add a parallel sync that opens `console.anthropic.com/settings/keys`, scrapes the table, and POSTs each row.

```
                    Extension auto-sync (every 24h, hidden tab)
                                    │
        ┌───────────────────────────┴────────────────────────────┐
        ▼                                                          ▼
  claude.ai/settings/usage                    console.anthropic.com/settings/keys
  → monthly_spent (€), weekly_used (%)        → per-key cost (USD), workspace, last used
        │                                                          │
        └─── POST /api/usage/track ─────────────────────────────────┘
                source='claude_official_sync'      source='anthropic_console_sync'
                                    │
                                    ▼
                            usage_records (SQLite)
                                    │
                                    ▼
                           GET /api/usage/...
                                    │
                                    ▼
                       Combined dashboard (React)
```

No Admin API key required. No fetch interception. No per-message data. Just two cumulative scrapes, joined in the dashboard.

---

## Database

**Single decision: extend `usage_records`. No new table.**

Add columns (additive, via existing `addMissingColumns()`):

- `workspace` (TEXT) — e.g. "Default", "Claude Code". `NULL` for `claude_official_sync` rows.
- `key_name` (TEXT) — friendly key name from the console list (e.g. "bewerbungstracker"). `NULL` for claude.ai rows.
- `key_id_suffix` (TEXT) — last 4 chars of the masked key (e.g. "oAAA"). Used as a stable identifier across syncs since the full key is never visible. `NULL` for claude.ai rows.
- `cost_usd` (REAL) — cost in USD as scraped from the console. The existing `cost` column stays in EUR for the claude.ai sync; `cost_usd` is the canonical field for `anthropic_console_sync` rows. (We don't currency-convert — rates change and the user wants the raw numbers Anthropic shows.)

Index: `idx_usage_workspace ON usage_records(workspace)` for filtered queries.

The categorization columns added by the previous (now-obsolete) design — `category`, `effectiveness_score`, `effectiveness_confirmed`, `user_category_override`, `haiku_reasoning` — stay in the schema as dead columns. Removing them means a destructive migration on real production data; leaving them costs nothing. Document them as deprecated in the migration block.

---

## Sync semantics

Console "Cost" is **cumulative since key creation**. Two syncs of the same key produce monotonically non-decreasing values. We store the cumulative number per sync and compute per-period spend by diffing consecutive snapshots in queries.

**Rule:** one `usage_records` row per key per sync. No deduplication is needed because each row carries a fresh `timestamp`; the dashboard always uses the **latest snapshot per key** for current totals and **the diff between snapshots** for trends.

**Frequency:** every 24h by default (configurable). Console data isn't real-time anyway — Anthropic updates it with significant lag — so a 10-minute interval (like claude.ai) is wasteful.

**Trigger:** new `chrome.alarms` entry `console-sync` analogous to the existing `auto-sync-claude`.

---

## Extension changes

New function in `background.js`: `consoleSync()`. Parallel to `autoSync()`:

1. Find or open a `console.anthropic.com/settings/keys` tab (hidden if newly created).
2. Wait for the keys table to render (selector: a row containing `sk-ant-api03-` or the cost column).
3. Use `chrome.scripting.executeScript` to read the table:
   - For each row, extract: `key_name`, `key_id_suffix`, `workspace`, `cost_usd`, `last_used`.
   - Skip rows where `cost === '—'` (key never used).
4. POST each row to `/api/usage/track` with `source='anthropic_console_sync'` and the new fields.
5. If the tab was created by us, close it.

The scrape function lives **inline** in the `executeScript` call (same pattern as the existing claude.ai scraper). No content-script change is needed.

`content.js` stays untouched. The previous attempt to extract `raw_prompt`/`raw_response` is dead code from this spec's perspective; we leave it alone to avoid churn but it never fires (fetch interception is gone).

---

## Backend changes

**`POST /api/usage/track`** — accept the new fields. The existing handler already stores the record; just thread `workspace`, `key_name`, `key_id_suffix`, `cost_usd` through the INSERT.

**Validators** — add optional `workspace`, `key_name`, `key_id_suffix` (each ≤ 100 chars), `cost_usd` (float ≥ 0).

**`GET /api/usage/summary?period=...`** — return one new field, `combined`, with this shape:

```json
{
  "claude_ai": { "cost_eur": 27.40, "weekly_used_pct": 62 },
  "anthropic_api": { "cost_usd": 0.58, "by_workspace": [
    { "workspace": "Default", "cost_usd": 0.52 },
    { "workspace": "Claude Code", "cost_usd": 0.06 }
  ]},
  "period": "month"
}
```

Logic:
- `claude_ai`: latest row in period where `source='claude_official_sync'`. The numbers are already cumulative for the month, no diffing needed.
- `anthropic_api`: latest snapshot per `(workspace, key_id_suffix)` in period, summed. For `period='month'`, subtract the snapshot from the previous month boundary (treat missing as 0). For `period='all-time'`, just take the latest snapshot per key.

**`GET /api/usage/console/keys`** — new endpoint. Returns latest row per `key_id_suffix` for the dashboard's per-key drilldown table:

```json
{ "keys": [
  { "key_name": "bewerbungstracker", "workspace": "Default", "cost_usd": 0.52, "last_synced": "2026-04-29T07:47:25Z" },
  ...
]}
```

The previous spec's `confirm-effectiveness` endpoint and category filters on `/history` stay in place but become inert — no rows have a category that isn't `'Pending'`. Don't remove them; they're already shipped to this branch.

---

## Frontend changes

**One new tab on the dashboard: "Combined cost".**

Layout, top-down:

1. **Hero number** — `Diesen Monat gesamt: €X,XX (claude.ai €Y,YY + API $Z,ZZ)`. Note: two currencies, no conversion. Show both with their own symbol.
2. **Stacked-bar trend** — last 30 days, two series: claude.ai (EUR), API (USD). x-axis: day. Hover shows both.
3. **Source breakdown cards** — two cards side by side:
   - "claude.ai" card: monthly spend, weekly usage %, last sync time.
   - "API" card: total USD this month, breakdown by workspace, link to per-key table.
4. **Per-key table** (collapsed by default) — rows from `/api/usage/console/keys`: `key_name | workspace | cost_usd | last_used`. Sortable by cost.

The existing tabs (Overview, Models, etc.) stay untouched — Plan B doesn't disrupt them.

A new component `CombinedCostTab.tsx` holds the layout. Reuse existing components (`UsageChart`, `UsageSummary`) where their props fit; otherwise inline.

---

## Out of scope

- **Currency conversion.** EUR ↔ USD is noisy and not what the user asked for.
- **Anthropic Admin API integration.** User couldn't find the key creation flow; scraping replaces it.
- **Per-message categorization.** Data doesn't exist anymore. The dead Haiku code stays for now and gets removed in a separate cleanup PR if ever.
- **Token counts for the API source.** Console only shows cost, not tokens. Don't fake it.
- **Workspace-level alerts/budgets.** A nice-to-have, but not part of the cost-tracking baseline.

---

## Success criteria

- Extension automatically syncs the console once per 24h without user interaction (after one-time login).
- Dashboard shows combined monthly spend with both sources visible and separable.
- Per-key table reflects the same numbers a user would see in the Anthropic Console.
- The existing claude.ai sync continues to work unchanged.
- No new dependencies (no Anthropic SDK on the backend, no Admin Key required).

---

## Migration plan from the current branch

This branch (`worktree-feature-data-quality-insights`) currently contains:
- 4 backend commits implementing categorization (obsolete but harmless)
- 1 extension commit forwarding `raw_prompt`/`raw_response` (obsolete and conflicts with main, which removed fetch interception)

Steps before merging Plan B back to `main`:

1. **Revert** the extension commit (`9158dca`) to undo the fetch-interception logic that conflicts with main.
2. **Keep** the backend commits — they add columns and endpoints that don't fire but also don't break anything. Cleanup is a separate task.
3. **Merge `main` into the branch** to pick up the dashboard redesign (ModelsTab/OverviewTab) and the fetch-interception removal.
4. **Implement Plan B** on top.
5. **Final review** — decide whether to keep the dead categorization code or strip it before merging to `main`.
