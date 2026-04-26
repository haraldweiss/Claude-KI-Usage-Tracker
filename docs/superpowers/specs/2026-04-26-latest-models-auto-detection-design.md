# Latest Models — Auto-Detection & Pricing Sync

**Status:** Approved (design)
**Date:** 2026-04-26

## Problem

The tracker has three Claude models hardcoded across backend and extension code: `Claude 3.5 Sonnet`, `Claude 3.5 Haiku`, `Claude 3 Opus`. The Claude 4 family (Opus 4.7, Sonnet 4.6, Haiku 4.5) and the 3.7 line are missing.

The existing daily 2 AM cron calls `fetchLatestPricing()` in [backend/src/services/pricingService.ts:123](../../../backend/src/services/pricingService.ts), but that function is a stub — it returns the same hardcoded prices and never updates anything.

When a user runs Claude.ai with a model the tracker doesn't know about, the extension's `formatModelName` in [extension/content.js:264](../../../extension/content.js) falls back to passing the raw API ID. That ID lands in `usage_records.model` with no matching row in the `pricing` table, so cost calculation silently produces `0`.

## Goal

1. Seed the current Claude 4.x and 3.7 lineup with correct pricing.
2. Pick up brand-new models automatically as they appear, in two layers:
   - Periodic fetch from a maintained external source (LiteLLM).
   - Real-time auto-create when the extension reports an unknown model name.

## Non-goals

- Anthropic API tracking (separate from Claude.ai). Out of scope per `MEMORY.md`.
- A UI for editing the bundled fallback JSON. It is updated by committing a new file.
- Multi-tenant / multi-user pricing. Single shared `pricing` table.

## Design choices (locked-in during brainstorming)

| Choice | Selected |
|---|---|
| Sources | Both extension auto-detect AND periodic external fetch |
| External source | LiteLLM `model_prices_and_context_window.json` |
| Unknown model handling | Tier-default the price AND flag with `status='pending_confirmation'` |
| Update behavior on next fetch | `auto` and `tier_default` rows refresh; `source=manual` and `status=pending_confirmation` rows are sacred |

## Architecture

Three paths feed the `pricing` table, with this precedence:

1. **Manual** — user types a price in Settings. Wins over everything; never auto-overwritten.
2. **Periodic LiteLLM fetch** (daily 2 AM cron) — replaces the stub `fetchLatestPricing`. Pulls `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`, filters to `litellm_provider === "anthropic"`, upserts rows with `source='auto'`. Graduates `tier_default` rows once LiteLLM knows them.
3. **Extension auto-detect** — when `POST /api/usage/track` receives an unknown model, the backend immediately upserts a pricing row. If a tier match is found via `Haiku`/`Sonnet`/`Opus` substring, the row is created with `source='tier_default'`, `status='active'`, and the sibling tier's price. If no tier match, the row is created with `source='tier_default'`, `status='pending_confirmation'`, and zero prices.

Update rules on the daily LiteLLM fetch:

| Row state | Behavior |
|---|---|
| `source='manual'` (any status) | Never auto-overwritten |
| `status='pending_confirmation'` (any source) | Never auto-overwritten (waits for user click) |
| `source='tier_default'`, `status='active'` | Overwritten when LiteLLM knows the model — graduates to `source='auto'` |
| `source='auto'`, `status='active'` | Overwritten when LiteLLM data changes |
| `source='auto'`, model missing from LiteLLM | Marked `status='deprecated'`; price untouched |

A bundled `pricing-fallback.json` snapshot lives in the repo. Used **only** when DB is empty AND remote fetch fails (e.g., first run offline). Refreshed by committing a new snapshot.

## Data model

`pricing` table — three new columns added via the existing `addMissingColumns` migration pattern in [backend/src/database/sqlite.ts:134](../../../backend/src/database/sqlite.ts) (extended to also handle the `pricing` table):

| Column | Type | Purpose |
|---|---|---|
| `api_id` | TEXT, nullable | Anthropic API ID (e.g., `claude-opus-4-7-20251101`). Cross-references LiteLLM and normalizes extension reports. The existing `model` column stays the human-readable display name and remains the primary key for joins to `usage_records`. |
| `status` | TEXT, default `'active'` | One of `active` \| `pending_confirmation` \| `deprecated`. Drives Settings UI. |
| `tier` | TEXT, nullable | One of `haiku` \| `sonnet` \| `opus` \| `other`. Cached at insert time. Used for tier-default lookup and recommendation logic. |

`source` column — values change to a new enum (describes how the price was obtained):
- `manual` — user-set
- `auto` — fetched from LiteLLM
- `tier_default` — synthesized from a sibling model in the same tier (or zero-priced placeholder when no tier match)

The `status` column (described above) is orthogonal and describes whether the row needs user attention. A row with `source='tier_default'` and no tier match is created with `status='pending_confirmation'` and `input_price=output_price=0`.

One-time migration: existing rows with `source='anthropic'` are migrated to `source='auto'`.

`usage_records` is unchanged — model names there continue to be the human-readable form; lookups against `pricing` use the same key.

## Components & files

### New files

- **[backend/src/services/litellmPricingSource.ts](../../../backend/src/services/litellmPricingSource.ts)** — Single-purpose: fetch the LiteLLM JSON, filter to `litellm_provider === "anthropic"`, return `Array<{api_id, displayName, inputPrice, outputPrice}>`. Uses Node 18+ built-in `fetch`; 10s timeout; returns `null` on any failure (caller falls back). LiteLLM stores prices as cost-per-token in USD; we multiply by 1,000,000 to get the per-million-token format the rest of the app uses.

- **[backend/src/services/modelNormalizer.ts](../../../backend/src/services/modelNormalizer.ts)** — Pure functions, no I/O:
  - `normalizeIncomingModel(raw, knownPricingRows) → { displayName, apiId, tier }` — handles both display names (`"Claude 3.5 Sonnet"`) and API IDs (`"claude-opus-4-7-20251101"`); falls back to deriving a display name (`claude-opus-4-7-…` → `"Claude Opus 4.7"`).
  - `inferTier(name) → 'haiku' | 'sonnet' | 'opus' | 'other'` — case-insensitive substring check.
  - `tierDefaultPrice(tier, knownPricingRows) → {input, output} | null` — picks the most recent row in the same tier (max `last_updated`).

- **[backend/src/data/pricing-fallback.json](../../../backend/src/data/pricing-fallback.json)** — Committed snapshot of current LiteLLM data, filtered to Anthropic. Schema matches `litellmPricingSource` output. Updated manually by committing a new file.

### Modified files

- **[backend/src/services/pricingService.ts](../../../backend/src/services/pricingService.ts)** — Replace stub `fetchLatestPricing()` to call `litellmPricingSource`. Rewrite `checkAndUpdatePricing()` with the source-aware update rules above. Add `seedFromFallbackIfEmpty()` for first-run.
- **[backend/src/controllers/usageController.ts](../../../backend/src/controllers/usageController.ts)** — In the `track` handler, normalize incoming model name; if unknown, insert a pricing row using the rule above (tier-default + `status='active'` if tier match; tier-default + `status='pending_confirmation'` + zero prices if no tier match), then proceed with the usage insert.
- **[backend/src/controllers/pricingController.ts](../../../backend/src/controllers/pricingController.ts)** — Add `POST /api/pricing/:model/confirm` endpoint that accepts an optional `{inputPrice, outputPrice}` body and flips `status` to `active` and `source` to `manual` (using submitted prices, or current row prices if omitted). Expose `status`, `source`, `api_id`, `tier` in `GET /api/pricing` response.
- **[backend/src/routes/pricing.ts](../../../backend/src/routes/pricing.ts)** — Register the new confirm route.
- **[backend/src/server.ts](../../../backend/src/server.ts)** — Call `seedFromFallbackIfEmpty()` and a one-time fetch on startup (after `initDatabase`).
- **[backend/src/services/modelRecommendationService.ts](../../../backend/src/services/modelRecommendationService.ts)** — Replace hardcoded `AVAILABLE_MODELS` and `PRICING` constants with a runtime query against the `pricing` table (filtered to `status='active'`). Existing `model.includes('Haiku'/'Sonnet'/'Opus')` tier logic stays — already works for Claude 4.x names.
- **[extension/content.js](../../../extension/content.js)** — Extend `modelMap` with current Claude 4.x and 3.7 entries. Improve the unknown-ID fallback at line 291 to format API IDs cleanly (`claude-opus-4-7-…` → `"Claude Opus 4.7"`).
- **[frontend/src/pages/Settings.tsx](../../../frontend/src/pages/Settings.tsx)** and **[frontend/src/components/PricingTable.tsx](../../../frontend/src/components/PricingTable.tsx)** — Add a banner when any row is `pending_confirmation`, a per-row source/status badge, and a "Confirm" button on pending rows.

JS-mirror files (`pricingService.js` etc.) are compiled output from the recent TypeScript migration. We edit only `.ts` and let the build regenerate `.js`. If the user's build flow does not regenerate them, we will update both during implementation.

## Error handling

- LiteLLM fetch fails (network/timeout/parse error) → log warning, return `null`. Caller skips the cycle; existing rows untouched. Fallback JSON consulted only at first run when DB is empty.
- Malformed LiteLLM entry (missing `input_cost_per_token`) → skip that entry, continue with the rest. One bad row never breaks the cycle.
- Extension sends empty/garbage model name → reject `track` with 400 (same as current validation).
- Race: extension's `track` arrives mid-fetch and creates a `tier_default` row for a model the fetch is about to write as `auto` → both writes go through the same upsert keyed by display name; last-writer-wins is acceptable because the normalizer ensures both writers compute the same canonical display name and the resulting row converges.

## Edge cases

- **Duplicate display names from different API IDs** (e.g., `claude-3-5-sonnet-20240620` and `claude-3-5-sonnet-20241022` both normalize to `"Claude 3.5 Sonnet"`): keep ONE row per display name. `api_id` stores the most recent ID seen. Acceptable because pricing matches across dated revisions of the same model.
- **Anthropic deprecates a model** (LiteLLM drops the entry): do NOT delete the DB row — historical `usage_records` reference it. If a previously-`auto` row is missing from LiteLLM on next fetch, set `status='deprecated'` and stop touching its price. UI shows it greyed in Settings but still in history charts.
- **First run, offline**: DB empty + remote fetch fails → seed from `pricing-fallback.json`. All seeded rows get `source='auto'`. Next successful fetch overwrites them.
- **User has manually set a price**: migration sets `source='manual'`, fetch never touches it.
- **Existing `source='anthropic'` rows from old DBs**: one-time migration converts to `source='auto'`.

## Testing

Unit tests, mirroring the existing Jest layout:

- `litellmPricingSource.test.ts` — mocked `fetch`; verify provider filter, price unit conversion, error paths (timeout, 500, malformed JSON).
- `modelNormalizer.test.ts` — table-driven: friendly names, raw API IDs, unknown IDs, edge cases (`claude-opus-4-7-…` → `"Claude Opus 4.7"`), tier inference, tier-default lookup, no-tier fallback.
- `pricingService.test.ts` — extend with the update matrix: `source=manual` rows untouched; `status=pending_confirmation` rows untouched; `source=auto` and `source=tier_default` rows refresh from LiteLLM; rows missing from LiteLLM transition to `status=deprecated`.

Integration test:

- `POST /api/usage/track` with a never-seen model ID → assert pricing row created with correct tier-default and `source='tier_default'`.
- Run `checkAndUpdatePricing()` with mocked LiteLLM containing that model → assert row graduates to `source='auto'` with the real price.

Manual smoke test against real LiteLLM JSON: run the fetch once, verify Claude 4.x family lands with reasonable prices.

## Out of scope

- Anthropic API usage tracking (separate from Claude.ai surface).
- Editing the bundled fallback JSON via UI.
- Notifying the user (email/push) when a new model is detected. The Settings banner is the only surface.
- Auto-discovery of models from sources other than the extension and LiteLLM.
