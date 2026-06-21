# Codex and OpenAI API Usage Design

## Goal

Add two independent OpenAI data sources to the Chrome extension and dashboard:

1. Codex subscription usage from the signed-in ChatGPT Codex analytics page.
2. OpenAI API usage for the organization currently selected on the OpenAI Platform.

The integration must preserve the existing OpenCode API work as a separate source and must not require users to store an OpenAI Admin API key.

## Product Decisions

- Use DOM scraping for both sources, following the extension's existing provider pattern.
- Track only the currently selected OpenAI organization in the first version. Do not switch organizations or aggregate across organizations.
- Scrape OpenAI API usage for the current calendar month, not the dashboard's default rolling 30-day range.
- Add OpenAI API spend to the dashboard grand total after the existing daily USD-to-EUR conversion.
- Treat Codex limits and remaining credits as informational. They do not contribute to spend totals.
- Keep Codex, OpenAI API, OpenCode Go, and OpenCode API as distinct source names and dashboard sections.
- Preserve unrelated dirty worktree changes in `extension/popup.html`, `extension/popup.js`, and `extension/background-scraper-opencode-usage.js`.

## Live Codex Page Shape

The authenticated page currently redirects from `https://chatgpt.com/codex/settings/usage` to `https://chatgpt.com/codex/cloud/settings/analytics#usage`.

The live German UI exposes:

- `5 Stunden Nutzungsgrenze`: remaining percentage and absolute reset timestamp.
- `Wöchentliches Nutzungslimit`: remaining percentage and absolute reset timestamp.
- `Verbleibende Credits`: numeric credit balance.
- `Nutzungsaufschlüsselung`: personal usage over the selected period.
- Interaction count with model/surface grouping when data exists.
- Plugin-call and skill-use counts when data exists.
- Credit-usage history when credits have been consumed.

Labels must be matched in both German and English. Percentages on this page are *remaining*, unlike several existing provider scrapers that store percentages used. The data contract must preserve that meaning explicitly.

## Extension Architecture

### Codex scraper

Create `extension/background-scraper-codex.js` with one public entry point:

```js
async function codexSync(externalTabId)
```

It navigates the shared tab to the Codex analytics usage page, waits for the usage cards to render, and extracts:

```text
five_hour_remaining_pct
five_hour_reset_at
weekly_remaining_pct
weekly_reset_at
credits_remaining
interactions
interactions_by_model[]
interactions_by_surface[]
plugin_calls
skills_used
credit_usage[]
scraped_at
```

The scraper posts one daily snapshot with source `codex_sync`. Optional breakdown arrays may be empty when the selected period contains no activity. The top-level limit fields are required for a successful sync.

### OpenAI API scraper

Create `extension/background-scraper-openai-api.js` with:

```js
async function openaiApiSync(externalTabId)
```

It navigates to `https://platform.openai.com/usage`, preserves the currently selected organization, and sets the usage page's date range to calendar-month-to-date. It must verify the resulting start and end dates before accepting totals. If the exact period cannot be established, the scraper returns a diagnostic failure and does not post a misleading cost snapshot.

The scraper extracts:

```text
organization_name
period_start
period_end
cost_usd
input_tokens
output_tokens
requests
by_project[]
by_model[]
scraped_at
```

Project and model breakdowns are best-effort. Organization name, verified month-to-date period, and total cost are required. Zero usage is a valid snapshot and must not be treated as a scraper failure.

Only users with Organization Owner or Usage Dashboard permission can access this page. Missing permission and logged-out states must be reported distinctly.

### Orchestration

Update `extension/background.js` to:

- load both scraper files with `importScripts`;
- add `TRIGGER_CODEX_SYNC` and `TRIGGER_OPENAI_API_SYNC` message routes;
- add both sources to `syncAll()` after the existing providers;
- add independent 24-hour alarms with staggered start delays;
- pass the existing shared active tab into both scrapers;
- include both results in sync progress and diagnostics.

Each scraper owns tabs it creates for an individual alarm and closes them in `finally`. A user-owned tab is never closed. `syncAll()` continues to create and close exactly one shared active tab.

### Manifest and popup

Add the minimum required host permission for `https://chatgpt.com/*`. Reuse the existing `https://platform.openai.com/*` permission if present. Because adding a host permission can trigger Chrome's permission warning, document the reload/re-approval step in README and AGENTS.md.

The popup gets two separate rows:

- Codex: `5h 91% left · week 99% left` with the nearest reset hint.
- OpenAI API: month-to-date USD cost, with token/request details when nonzero.

All numeric formatting must guard with `Number.isFinite()`.

## Backend Data Model and API

Add `codex_sync` and `openai_api_sync` to the accepted source union and sync-source deduplication list.

Both sources use the existing usage-record storage. Their provider-specific fields live in `response_metadata`; the normalized cost and token columns are populated where meaningful.

Daily resyncs are idempotent: replace the current day's snapshot for the same user and source. Do not delete historical days.

Extend `/usage/summary` with:

```text
combined.codex
combined.openai_api
```

Extend `/usage/spending-total` with `openai_api`. Convert its month-to-date USD spend through `exchangeRateService` and add the EUR value once to `grand_total_eur`. Codex data is excluded from the monetary total. OpenAI API rows must be excluded from generic breakdown sums that would otherwise double-count the same snapshot.

## Frontend Design

Add typed `CodexSpend` and `OpenAiApiSpend` contracts and include them in summary and spending-total response types.

### Overview

Add two cards:

- **Codex** shows the two remaining-limit progress bars, reset timestamps, remaining credits, and optional interaction totals.
- **OpenAI API** shows month-to-date spend in USD and EUR, tokens, requests, active organization, and optional project/model breakdowns.

Remaining-limit bars must be labelled as remaining capacity; they must not reuse UI copy that implies percentage used.

### Combined cost and totals

Add OpenAI API spend to the combined-cost source list, grand total, and forecast calculation. Codex does not add a monetary line unless a future feature supplies actual consumed-credit cost; remaining credit balance is not spend.

The active organization name and period dates remain visible so users can detect that another organization is not included.

## Error Handling

Both scrapers return structured results with `success`, `skipped`, `reason`, and diagnostics where appropriate.

Required reason values include:

- `login_required`
- `permission_required`
- `usage_cards_not_found`
- `period_not_verified`
- `layout_changed`
- `post_failed`

A failed source does not abort the remaining `syncAll()` steps. The popup shows the source-specific failure while retaining the last successful dashboard snapshot.

Selectors should prefer semantic labels and nearby text over generated class names. Render waits should be bounded, and German/English label alternatives should be covered by parser tests.

## Verification

### Automated

- Parser fixtures for German and English Codex labels.
- Parser fixtures for nonzero and zero OpenAI API usage.
- Tests proving remaining percentages are not interpreted as used percentages.
- Backend tests for source acceptance, daily idempotency, summary shape, USD-to-EUR conversion, and exactly-once grand-total inclusion.
- Frontend type-check and component tests for both cards, empty breakdowns, zero usage, and non-finite values.
- `node --check` for all extension scripts.

### Manual round trip

1. Reload the unpacked extension and approve the new ChatGPT host permission if Chrome asks.
2. Open the popup and run **Alle synchronisieren**.
3. Confirm the single shared tab visits Codex analytics and OpenAI Platform usage, then closes.
4. Confirm popup rows show both successful sources.
5. Confirm the dashboard Codex card matches the live 5-hour, weekly, reset, and credit values.
6. Confirm the OpenAI API card names the active organization and matches month-to-date cost.
7. Confirm the EUR grand total increases by OpenAI API spend exactly once.
8. Switch the Platform to an organization without Usage Dashboard access and confirm a permission-specific failure without losing the last good snapshot.

## Documentation and Handoff

Implementation must update README for the new source, host permission, data semantics, and manual round-trip procedure. AGENTS.md must receive a dated handoff entry describing selectors, verified labels, permission behavior, touched files, tests, and any remaining live-browser verification.

The implementation does not resolve these unrelated existing AGENTS.md follow-ups:

- OpenCode key duplication across workspaces.
- Duplicated alert formulas between `getAlerts()` and `checkAndFireAlerts()`.
- Missing `(user_id, scraped_at)` index on `billing_snapshots`.

