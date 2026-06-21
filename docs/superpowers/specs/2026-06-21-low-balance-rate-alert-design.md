# Low-Balance Alert + Rate Alert — Design Spec

**Date:** 2026-06-21  
**Status:** Approved

---

## Problem

API credits bleed out unnoticed. $20 loaded, $17.86 gone in one day (Pi.ai + Claude API billing change of 2026-06-15), user noticed only when $0.39 remained. The tracker had no way to warn about this because it doesn't know the current credit balance or detect abnormal spend rates.

---

## Goal

Two alert types, three notification channels each:

| Alert | Trigger |
|---|---|
| **Low-Balance** | `balance_usd / last_topup_usd < threshold` (default 20%) |
| **Rate-Alert** | Today's API cost > `multiplier × 7-day daily average` (default 3×) |

**Channels:** Dashboard banner + Chrome browser notification + E-Mail

---

## Architecture

### 1. Extension — `extension/background-scraper-billing.js` (new)

New function `billingSync()`:
- Navigates tab to `https://platform.claude.com/settings/billing`
- Waits for React to render (3s + polling)
- Scrapes:
  - **Current balance** — looks for a `$X.XX` amount near text "Credits" or "Balance"
  - **Last top-up amount** — from the transaction history table, finds the most recent "Add credits" / "Payment" row
- POSTs to backend as source `anthropic_billing_sync` with body:
  ```json
  { "balance_usd": 0.39, "last_topup_usd": 20.00, "source": "anthropic_billing_sync" }
  ```
- Runs on its own alarm `BILLING_SYNC_ALARM` every 6h (delay 2min on install)
- Also called as the last step in `syncAll()` in `background.js`
- Closes its own tab in `finally` (same pattern as other scrapers)
- Best-effort: failure logs a warning, never throws

**Chrome notification** — fired in `billingSync()` after receiving the backend response:
- If response contains `alerts.low_balance: true` → `chrome.notifications.create('low_balance', { ... })`
- If response contains `alerts.rate_alert: true` → `chrome.notifications.create('rate_alert', { ... })`
- Notification click listener opens dashboard URL
- Requires `"notifications"` permission in `manifest.json`

### 2. Backend

#### New table: `billing_snapshots`

```sql
CREATE TABLE IF NOT EXISTS billing_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  balance_usd REAL NOT NULL,
  last_topup_usd REAL,
  scraped_at DATETIME DEFAULT (datetime('now')),
  UNIQUE(user_id, date(scraped_at))  -- one snapshot per day (upsert)
);
```

One row per user per day. On duplicate date: replace with latest values.

#### New table: `user_alert_config`

```sql
CREATE TABLE IF NOT EXISTS user_alert_config (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  low_balance_threshold REAL NOT NULL DEFAULT 0.20,
  rate_multiplier REAL NOT NULL DEFAULT 3.0,
  alerts_enabled INTEGER NOT NULL DEFAULT 1
);
```

#### New service: `backend/src/services/alertService.ts`

Exports one function: `checkAndFireAlerts(userId: number): Promise<AlertResult>`

```typescript
interface AlertResult {
  low_balance: boolean;
  rate_alert: boolean;
  balance_usd: number | null;
  last_topup_usd: number | null;
  today_cost_usd: number;
  avg_daily_cost_usd: number;
}
```

**Low-balance check:**
```sql
SELECT balance_usd, last_topup_usd
FROM billing_snapshots
WHERE user_id = ? AND date(scraped_at) = date('now')
ORDER BY scraped_at DESC LIMIT 1
```
Alert if `last_topup_usd > 0` AND `balance_usd / last_topup_usd < threshold`.

**Rate-alert check:**
```sql
-- Today's total API cost
SELECT COALESCE(SUM(cost_usd), 0) as today_cost
FROM usage_records
WHERE user_id = ?
  AND source IN ('anthropic_console_cost_day', 'anthropic_console_sync', 'claude_code_sync')
  AND date(timestamp) = date('now')

-- 7-day average (excluding today)
SELECT COALESCE(AVG(daily_cost), 0) as avg_cost FROM (
  SELECT date(timestamp) as day, SUM(cost_usd) as daily_cost
  FROM usage_records
  WHERE user_id = ?
    AND source IN ('anthropic_console_cost_day', 'anthropic_console_sync', 'claude_code_sync')
    AND date(timestamp) >= date('now', '-7 days')
    AND date(timestamp) < date('now')
  GROUP BY day
)
```
Alert if `today_cost > multiplier × avg_cost` AND `avg_cost > 0` AND `today_cost > 1.00` (minimum $1 to avoid noise on near-zero averages).

**Cooldown:** New table column or in-memory check — alert fires at most once per 6h per type per user. Implemented via `last_alert_sent_at` columns in `user_alert_config`.

**Email:** Calls existing `mailService.sendMail()` with a plain-text template.

#### New endpoint: `POST /api/usage/billing-sync`

Accepts `{ balance_usd, last_topup_usd }`, requires auth.
1. Upserts into `billing_snapshots` (INSERT OR REPLACE)
2. Calls `checkAndFireAlerts(userId)`
3. If alerts triggered and cooldown elapsed: sends email via `mailService`
4. Returns `{ success: true, alerts: { low_balance, rate_alert }, balance_usd, last_topup_usd }`

The extension reads `alerts` from the response to decide whether to fire Chrome notifications.

#### New endpoint: `GET /api/usage/alerts`

Returns current alert state for the dashboard:
```json
{
  "low_balance": true,
  "rate_alert": false,
  "balance_usd": 0.39,
  "last_topup_usd": 20.00,
  "today_cost_usd": 17.86,
  "avg_daily_cost_usd": 2.10,
  "config": { "low_balance_threshold": 0.20, "rate_multiplier": 3.0 }
}
```

#### New endpoint: `PUT /api/usage/alerts/config`

Updates `user_alert_config` (threshold + multiplier). Validated: threshold 0.01–1.0, multiplier 1.0–10.0.

### 3. Frontend

#### New component: `AlertBanner.tsx`

Fetches `GET /api/usage/alerts` on mount (same cadence as summary — on tab focus + after sync).

- **Low-balance** (red): "⚠️ Nur noch $0.39 — 2% deines letzten Auflade-Betrags von $20.00"
- **Rate-alert** (orange): "⚠️ Ungewöhnlich hoher Verbrauch heute: $17.86 (3× über dem 7-Tage-Schnitt von $2.10/Tag)"
- Both can show simultaneously
- Renders at the top of `OverviewTab.tsx` above all cards

#### Settings UI

Small config block in `frontend/src/components/settings/AccountSection.tsx` (already exists):
- "Low-Balance Schwellwert": number input (%, default 20)
- "Rate-Alert Faktor": number input (×, default 3)
- Save button → `PUT /api/usage/alerts/config`

---

## Error Handling

- Billing page scrape fails → log warning, no POST, no alert (don't show stale alert)
- `last_topup_usd` not found → low-balance alert skipped, rate-alert still fires if applicable
- Email send fails → log error, return alert result to extension anyway (Chrome notification still fires)
- `avg_daily_cost` is 0 (no history) → rate-alert suppressed entirely

---

## What Is NOT Changed

- Grand total calculation — unchanged
- Existing sync sources — unchanged
- Database schema for `usage_records` — unchanged

---

## Success Criteria

1. After billing sync: `billing_snapshots` has a row with real balance
2. With $0.39 balance and $20 last top-up: `GET /api/usage/alerts` returns `low_balance: true`
3. Dashboard shows red banner with exact amounts
4. Chrome notification fires when low-balance detected
5. E-Mail arrives at `anubclaw@gmail.com` with balance info
6. Second sync within 6h: no duplicate email sent (cooldown works)
7. Rate-alert fires when today's API cost > 3× 7-day average
