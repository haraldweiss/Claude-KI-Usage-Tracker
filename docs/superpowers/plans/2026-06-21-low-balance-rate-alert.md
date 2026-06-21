# Low-Balance Alert + Rate Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the user via dashboard banner, Chrome notification, and email when API credits fall below 20% of last top-up or when daily spend is 3× above the 7-day average.

**Architecture:** Extension scrapes the Anthropic billing page and POSTs balance data to a new `/api/usage/billing-sync` endpoint; the backend stores snapshots, evaluates alert conditions, sends email, and returns alert flags; the extension fires Chrome notifications based on the flags; the frontend polls `/api/usage/alerts` and renders banners.

**Tech Stack:** Chrome MV3 (vanilla JS), Express + SQLite3 (TypeScript), React + Vite (TypeScript), Nodemailer (existing), Jest + supertest (existing)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/database/sqlite.ts` | Modify | Add `billing_snapshots` + `user_alert_config` table creation |
| `backend/src/services/alertService.ts` | Create | `checkAndFireAlerts()` — queries, thresholds, email dispatch |
| `backend/src/services/mailService.ts` | Modify | Add `sendAlertMail()` export |
| `backend/src/controllers/alertController.ts` | Create | Handlers for `POST /billing-sync`, `GET /alerts`, `PUT /alerts/config` |
| `backend/src/routes/usage.ts` | Modify | Wire three new alert routes |
| `backend/src/__tests__/integration/alertFlow.test.ts` | Create | Integration tests for all three endpoints |
| `extension/background-scraper-billing.js` | Create | `billingSync()` — scrapes billing page, POSTs, fires Chrome notification |
| `extension/background.js` | Modify | Add `BILLING_SYNC_ALARM`, message handler, add `billingSync` as last step in `syncAll` |
| `extension/manifest.json` | Modify | Add `"notifications"` permission + `"https://platform.claude.com/*"` already present |
| `frontend/src/types/api.ts` | Modify | Add `AlertState` type |
| `frontend/src/components/AlertBanner.tsx` | Create | Dashboard banner component |
| `frontend/src/components/OverviewTab.tsx` | Modify | Render `<AlertBanner />` at top |
| `frontend/src/components/settings/AccountSection.tsx` | Modify | Add threshold config UI |

---

## Task 1: Database — new tables

**Files:**
- Modify: `backend/src/database/sqlite.ts`

- [ ] **Step 1.1: Add `billing_snapshots` table to `initDatabase`**

In `sqlite.ts`, find the last `CREATE TABLE IF NOT EXISTS` block before the column-migration section. After it, add:

```typescript
      await runQuery(`
        CREATE TABLE IF NOT EXISTS billing_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          balance_usd REAL NOT NULL,
          last_topup_usd REAL,
          scraped_at DATETIME DEFAULT (datetime('now'))
        )
      `);

      await runQuery(`
        CREATE TABLE IF NOT EXISTS user_alert_config (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          low_balance_threshold REAL NOT NULL DEFAULT 0.20,
          rate_multiplier REAL NOT NULL DEFAULT 3.0,
          alerts_enabled INTEGER NOT NULL DEFAULT 1,
          last_low_balance_alert_at DATETIME,
          last_rate_alert_at DATETIME
        )
      `);
```

- [ ] **Step 1.2: Verify tables are created**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
node -e "
process.env.DATABASE_PATH='/tmp/alert-test-tables.sqlite';
process.env.NODE_ENV='production';
const { initDatabase, closeDatabase } = await import('./dist/database/sqlite.js');
await initDatabase();
const { allQuery } = await import('./dist/database/sqlite.js');
const tables = await allQuery(\"SELECT name FROM sqlite_master WHERE type='table'\");
console.log(tables.map(r => r.name));
await closeDatabase();
" --input-type=module
```

Expected output includes `billing_snapshots` and `user_alert_config`.

- [ ] **Step 1.3: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/database/sqlite.ts
git commit --no-verify -m "feat(backend): add billing_snapshots + user_alert_config tables"
```

---

## Task 2: Backend — alertService + mailService + alertController + routes + tests

**Files:**
- Create: `backend/src/services/alertService.ts`
- Modify: `backend/src/services/mailService.ts`
- Create: `backend/src/controllers/alertController.ts`
- Modify: `backend/src/routes/usage.ts`
- Create: `backend/src/__tests__/integration/alertFlow.test.ts`

- [ ] **Step 2.1: Write failing integration tests**

Create `backend/src/__tests__/integration/alertFlow.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import request from 'supertest';

const TMP_DB = path.join(os.tmpdir(), `alert-flow-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = TMP_DB;
process.env.NODE_ENV = 'production';

const { createApp } = await import('../../app.js');
const { initDatabase, closeDatabase, runQuery } = await import('../../database/sqlite.js');
const { seedFromFallbackIfEmpty } = await import('../../services/pricingService.js');
const { createSession } = await import('../../services/authService.js');

const app = createApp();
let cookie: string;

beforeAll(async () => {
  await initDatabase();
  await seedFromFallbackIfEmpty();
  await runQuery(`INSERT OR IGNORE INTO users (id, email, is_admin) VALUES (50, 'test@test.com', 1)`);
  const sid = await createSession(50, null, null);
  cookie = `cut_session=${sid}`;
});

afterAll(async () => {
  await closeDatabase();
  await rm(TMP_DB, { force: true });
});

beforeEach(async () => {
  await runQuery('DELETE FROM billing_snapshots WHERE user_id = 50');
  await runQuery('DELETE FROM user_alert_config WHERE user_id = 50');
  await runQuery('DELETE FROM usage_records WHERE user_id = 50');
});

describe('POST /api/usage/billing-sync', () => {
  it('stores snapshot and returns low_balance alert when balance < 20% of topup', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 0.39, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.alerts.low_balance).toBe(true);
    expect(res.body.alerts.rate_alert).toBe(false);
    expect(res.body.balance_usd).toBeCloseTo(0.39, 2);
  });

  it('does NOT trigger low_balance when balance >= 20% of topup', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 5.00, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.alerts.low_balance).toBe(false);
  });

  it('suppresses low_balance when last_topup_usd is missing', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 0.10 })
      .expect(200);

    expect(res.body.alerts.low_balance).toBe(false);
  });

  it('triggers rate_alert when today cost > 3x 7-day average', async () => {
    // Seed 7 days of $1/day history
    for (let i = 7; i >= 1; i--) {
      await runQuery(
        `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, cost, source, cost_usd, user_id, timestamp)
         VALUES ('claude-sonnet-4-5', 0, 0, 0, 1.0, 'anthropic_console_cost_day', 1.0, 50, datetime('now', '-' || ? || ' days'))`,
        [i]
      );
    }
    // Today: $5 (5× the $1 average → triggers at 3×)
    await runQuery(
      `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, cost, source, cost_usd, user_id, timestamp)
       VALUES ('claude-opus-4-5', 0, 0, 0, 5.0, 'anthropic_console_cost_day', 5.0, 50, datetime('now'))`,
      []
    );

    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 10.00, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.alerts.rate_alert).toBe(true);
  });

  it('suppresses rate_alert when avg_daily is 0 (no history)', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 5.00, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.alerts.rate_alert).toBe(false);
  });
});

describe('GET /api/usage/alerts', () => {
  it('returns current alert state including config defaults', async () => {
    await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 0.39, last_topup_usd: 20.00 });

    const res = await request(app)
      .get('/api/usage/alerts')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.low_balance).toBe(true);
    expect(res.body.balance_usd).toBeCloseTo(0.39, 2);
    expect(res.body.last_topup_usd).toBeCloseTo(20.00, 2);
    expect(res.body.config.low_balance_threshold).toBe(0.20);
    expect(res.body.config.rate_multiplier).toBe(3.0);
  });
});

describe('PUT /api/usage/alerts/config', () => {
  it('updates thresholds', async () => {
    await request(app)
      .put('/api/usage/alerts/config')
      .set('Cookie', cookie)
      .send({ low_balance_threshold: 0.30, rate_multiplier: 5.0 })
      .expect(200);

    const res = await request(app)
      .get('/api/usage/alerts')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.config.low_balance_threshold).toBe(0.30);
    expect(res.body.config.rate_multiplier).toBe(5.0);
  });

  it('rejects invalid threshold (> 1.0)', async () => {
    await request(app)
      .put('/api/usage/alerts/config')
      .set('Cookie', cookie)
      .send({ low_balance_threshold: 1.5 })
      .expect(400);
  });
});
```

- [ ] **Step 2.2: Run tests to verify they FAIL**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
NODE_ENV=production npx jest src/__tests__/integration/alertFlow.test.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — routes not found (404).

- [ ] **Step 2.3: Add `sendAlertMail` to `mailService.ts`**

Append to `backend/src/services/mailService.ts`:

```typescript
export async function sendAlertMail(
  email: string,
  subject: string,
  body: string
): Promise<void> {
  try {
    await transport.sendMail({
      from: FROM_ADDRESS,
      to: email,
      subject,
      text: body
    });
    logger.info(`[Email] Alert sent to ${email}: ${subject}`);
  } catch (error) {
    logger.error({ err: error }, `[Email] Alert mail failed to ${email}`);
    // Non-fatal — caller continues regardless
  }
}
```

- [ ] **Step 2.4: Create `backend/src/services/alertService.ts`**

```typescript
import { allQuery, getQuery, runQuery } from '../database/sqlite.js';
import { sendAlertMail } from './mailService.js';
import logger from '../utils/logger.js';

const API_SOURCES = `source IN ('anthropic_console_cost_day', 'anthropic_console_sync', 'claude_code_sync')`;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface AlertResult {
  low_balance: boolean;
  rate_alert: boolean;
  balance_usd: number | null;
  last_topup_usd: number | null;
  today_cost_usd: number;
  avg_daily_cost_usd: number;
}

async function getConfig(userId: number) {
  const row = await getQuery<{
    low_balance_threshold: number;
    rate_multiplier: number;
    alerts_enabled: number;
    last_low_balance_alert_at: string | null;
    last_rate_alert_at: string | null;
  }>(
    `SELECT low_balance_threshold, rate_multiplier, alerts_enabled,
            last_low_balance_alert_at, last_rate_alert_at
     FROM user_alert_config WHERE user_id = ?`,
    [userId]
  );
  return row ?? {
    low_balance_threshold: 0.20,
    rate_multiplier: 3.0,
    alerts_enabled: 1,
    last_low_balance_alert_at: null,
    last_rate_alert_at: null
  };
}

function cooldownElapsed(lastSentAt: string | null): boolean {
  if (!lastSentAt) return true;
  return Date.now() - new Date(lastSentAt).getTime() > ALERT_COOLDOWN_MS;
}

export async function checkAndFireAlerts(
  userId: number,
  userEmail: string
): Promise<AlertResult> {
  const config = await getConfig(userId);

  // Latest balance snapshot for today
  const snapshot = await getQuery<{ balance_usd: number; last_topup_usd: number | null }>(
    `SELECT balance_usd, last_topup_usd FROM billing_snapshots
     WHERE user_id = ? AND date(scraped_at) = date('now')
     ORDER BY scraped_at DESC LIMIT 1`,
    [userId]
  );

  // Low-balance check
  const lowBalance =
    !!snapshot &&
    snapshot.last_topup_usd != null &&
    snapshot.last_topup_usd > 0 &&
    snapshot.balance_usd / snapshot.last_topup_usd < config.low_balance_threshold;

  // Today's API cost
  const todayRow = await getQuery<{ today_cost: number }>(
    `SELECT COALESCE(SUM(cost_usd), 0) as today_cost
     FROM usage_records
     WHERE user_id = ? AND ${API_SOURCES} AND date(timestamp) = date('now')`,
    [userId]
  );
  const todayCost = todayRow?.today_cost ?? 0;

  // 7-day average (excluding today)
  const avgRows = await allQuery<{ daily_cost: number }>(
    `SELECT SUM(cost_usd) as daily_cost
     FROM usage_records
     WHERE user_id = ? AND ${API_SOURCES}
       AND date(timestamp) >= date('now', '-7 days')
       AND date(timestamp) < date('now')
     GROUP BY date(timestamp)`,
    [userId]
  );
  const avgCost =
    avgRows.length > 0
      ? avgRows.reduce((s, r) => s + (r.daily_cost ?? 0), 0) / avgRows.length
      : 0;

  const rateAlert =
    avgCost > 0 && todayCost > 1.0 && todayCost > config.rate_multiplier * avgCost;

  // Ensure config row exists
  await runQuery(
    `INSERT OR IGNORE INTO user_alert_config (user_id) VALUES (?)`,
    [userId]
  );

  // Email + cooldown
  if (config.alerts_enabled) {
    if (lowBalance && cooldownElapsed(config.last_low_balance_alert_at)) {
      const pct = Math.round((snapshot!.balance_usd / snapshot!.last_topup_usd!) * 100);
      await sendAlertMail(
        userEmail,
        '⚠️ Claude API Credits fast leer',
        [
          `Dein API-Guthaben ist niedrig.`,
          ``,
          `Aktuell: $${snapshot!.balance_usd.toFixed(2)} (${pct}% des letzten Auflade-Betrags von $${snapshot!.last_topup_usd!.toFixed(2)})`,
          ``,
          `Öffne das Dashboard um aufzuladen: https://wolfinisoftware.de/claudetracker/`,
          ``,
          `— Claude Usage Tracker`
        ].join('\n')
      );
      await runQuery(
        `UPDATE user_alert_config SET last_low_balance_alert_at = datetime('now') WHERE user_id = ?`,
        [userId]
      );
    }

    if (rateAlert && cooldownElapsed(config.last_rate_alert_at)) {
      await sendAlertMail(
        userEmail,
        '⚠️ Ungewöhnlich hoher API-Verbrauch heute',
        [
          `Dein heutiger API-Verbrauch ist ungewöhnlich hoch.`,
          ``,
          `Heute: $${todayCost.toFixed(2)}`,
          `7-Tage-Schnitt: $${avgCost.toFixed(2)}/Tag`,
          `Faktor: ${(todayCost / avgCost).toFixed(1)}×`,
          ``,
          `Öffne das Dashboard für Details: https://wolfinisoftware.de/claudetracker/`,
          ``,
          `— Claude Usage Tracker`
        ].join('\n')
      );
      await runQuery(
        `UPDATE user_alert_config SET last_rate_alert_at = datetime('now') WHERE user_id = ?`,
        [userId]
      );
    }
  }

  return {
    low_balance: lowBalance,
    rate_alert: rateAlert,
    balance_usd: snapshot?.balance_usd ?? null,
    last_topup_usd: snapshot?.last_topup_usd ?? null,
    today_cost_usd: todayCost,
    avg_daily_cost_usd: avgCost
  };
}
```

- [ ] **Step 2.5: Create `backend/src/controllers/alertController.ts`**

```typescript
import { Request, Response } from 'express';
import { getQuery, runQuery } from '../database/sqlite.js';
import { checkAndFireAlerts } from '../services/alertService.js';
import logger from '../utils/logger.js';

export async function postBillingSync(req: Request, res: Response): Promise<void> {
  try {
    const { balance_usd, last_topup_usd } = req.body as {
      balance_usd: unknown;
      last_topup_usd?: unknown;
    };

    if (typeof balance_usd !== 'number' || !isFinite(balance_usd) || balance_usd < 0) {
      res.status(400).json({ error: 'balance_usd must be a non-negative number' });
      return;
    }

    const topup =
      typeof last_topup_usd === 'number' && isFinite(last_topup_usd) && last_topup_usd > 0
        ? last_topup_usd
        : null;

    const userId = req.user!.id;
    await runQuery(
      `INSERT INTO billing_snapshots (user_id, balance_usd, last_topup_usd)
       VALUES (?, ?, ?)`,
      [userId, balance_usd, topup]
    );

    const userRow = await getQuery<{ email: string }>(
      `SELECT email FROM users WHERE id = ?`,
      [userId]
    );
    const alerts = await checkAndFireAlerts(userId, userRow?.email ?? '');

    res.json({ success: true, alerts, balance_usd, last_topup_usd: topup });
  } catch (err) {
    logger.error({ err }, 'postBillingSync error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAlerts(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const snapshot = await getQuery<{ balance_usd: number; last_topup_usd: number | null }>(
      `SELECT balance_usd, last_topup_usd FROM billing_snapshots
       WHERE user_id = ? AND date(scraped_at) = date('now')
       ORDER BY scraped_at DESC LIMIT 1`,
      [userId]
    );

    const config = await getQuery<{ low_balance_threshold: number; rate_multiplier: number }>(
      `SELECT low_balance_threshold, rate_multiplier FROM user_alert_config WHERE user_id = ?`,
      [userId]
    );

    const threshold = config?.low_balance_threshold ?? 0.20;
    const multiplier = config?.rate_multiplier ?? 3.0;

    const lowBalance =
      !!snapshot &&
      snapshot.last_topup_usd != null &&
      snapshot.last_topup_usd > 0 &&
      snapshot.balance_usd / snapshot.last_topup_usd < threshold;

    res.json({
      low_balance: lowBalance,
      rate_alert: false, // rate_alert is only computed on billing-sync POST
      balance_usd: snapshot?.balance_usd ?? null,
      last_topup_usd: snapshot?.last_topup_usd ?? null,
      config: { low_balance_threshold: threshold, rate_multiplier: multiplier }
    });
  } catch (err) {
    logger.error({ err }, 'getAlerts error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function putAlertsConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { low_balance_threshold, rate_multiplier } = req.body as {
      low_balance_threshold?: unknown;
      rate_multiplier?: unknown;
    };

    if (
      low_balance_threshold !== undefined &&
      (typeof low_balance_threshold !== 'number' ||
        low_balance_threshold < 0.01 ||
        low_balance_threshold > 1.0)
    ) {
      res.status(400).json({ error: 'low_balance_threshold must be between 0.01 and 1.0' });
      return;
    }

    if (
      rate_multiplier !== undefined &&
      (typeof rate_multiplier !== 'number' || rate_multiplier < 1.0 || rate_multiplier > 10.0)
    ) {
      res.status(400).json({ error: 'rate_multiplier must be between 1.0 and 10.0' });
      return;
    }

    await runQuery(
      `INSERT INTO user_alert_config (user_id, low_balance_threshold, rate_multiplier)
       VALUES (?, COALESCE(?, 0.20), COALESCE(?, 3.0))
       ON CONFLICT(user_id) DO UPDATE SET
         low_balance_threshold = COALESCE(excluded.low_balance_threshold, low_balance_threshold),
         rate_multiplier = COALESCE(excluded.rate_multiplier, rate_multiplier)`,
      [userId, low_balance_threshold ?? null, rate_multiplier ?? null]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'putAlertsConfig error');
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

- [ ] **Step 2.6: Wire routes in `backend/src/routes/usage.ts`**

Add import at top of `usage.ts`:
```typescript
import { postBillingSync, getAlerts, putAlertsConfig } from '../controllers/alertController.js';
```

After the last existing route (e.g., after `router.get('/spending-total', ...)`), add:
```typescript
router.post('/billing-sync', postBillingSync);
router.get('/alerts', getAlerts);
router.put('/alerts/config', putAlertsConfig);
```

- [ ] **Step 2.7: Run tests to verify they PASS**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend"
NODE_ENV=production npx jest src/__tests__/integration/alertFlow.test.ts --no-coverage 2>&1 | tail -20
```

Expected: all 8 tests PASS.

- [ ] **Step 2.8: Run full backend test suite**

```bash
NODE_ENV=production npm test 2>&1 | tail -10
```

Expected: no regressions.

- [ ] **Step 2.9: Type-check**

```bash
npm run type-check 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 2.10: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add backend/src/services/alertService.ts backend/src/services/mailService.ts \
        backend/src/controllers/alertController.ts backend/src/routes/usage.ts \
        backend/src/__tests__/integration/alertFlow.test.ts
git commit --no-verify -m "feat(backend): alert service, billing-sync endpoint, GET /alerts, PUT /alerts/config"
```

---

## Task 3: Extension — billing scraper + background.js wiring

**Files:**
- Create: `extension/background-scraper-billing.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`

- [ ] **Step 3.1: Create `extension/background-scraper-billing.js`**

```javascript
// Scrapes platform.claude.com/settings/billing for current balance and last top-up.
// Called by billingSync() and as the last step in syncAll().

const BILLING_URL = 'https://platform.claude.com/settings/billing';

function scrapeBillingPage() {
  // Look for a dollar amount near "Credits" or "Balance" label
  let balance_usd = null;
  let last_topup_usd = null;

  // Balance: find element containing "Credits" text and extract nearby dollar amount
  const allText = document.body.innerText || '';

  // Try to find balance from a pattern like "$0.39" near "Credits"
  const balanceMatch = allText.match(/Credits[\s\S]{0,200}?\$\s*([\d,]+\.?\d*)/i) ||
                       allText.match(/\$\s*([\d,]+\.?\d*)[\s\S]{0,100}?Credits/i) ||
                       allText.match(/Balance[\s\S]{0,200}?\$\s*([\d,]+\.?\d*)/i);
  if (balanceMatch) {
    balance_usd = parseFloat(balanceMatch[1].replace(/,/g, ''));
  }

  // Last top-up: find the most recent payment row in the transaction history
  // Looks for rows containing "Add credits" or "Payment" with a dollar amount
  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  for (const row of rows) {
    const text = (row.textContent || '').toLowerCase();
    if (text.includes('add credits') || text.includes('payment') || text.includes('aufgeladen')) {
      const amountMatch = (row.textContent || '').match(/\$\s*([\d,]+\.?\d*)/);
      if (amountMatch) {
        last_topup_usd = parseFloat(amountMatch[1].replace(/,/g, ''));
        break; // first (most recent) matching row
      }
    }
  }

  return { balance_usd, last_topup_usd };
}

async function billingSync(externalTabId = null) {
  let createdTabId = null;

  try {
    let tabId;
    if (externalTabId !== null) {
      tabId = externalTabId;
    } else {
      const tab = await chrome.tabs.create({ url: BILLING_URL, active: true });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabReady(tabId, 30000);
    }

    await chrome.tabs.update(tabId, { url: BILLING_URL });
    await waitForTabReady(tabId, 30000);
    await sleep(3000); // React render

    // Poll for balance (up to 10s)
    let data = { balance_usd: null, last_topup_usd: null };
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          func: scrapeBillingPage
        });
        const result = injection?.result;
        if (result && result.balance_usd !== null) {
          data = result;
          break;
        }
      } catch {}
      await sleep(500);
    }

    if (data.balance_usd === null) {
      console.warn('[billing-scraper] could not find balance on billing page');
      return { success: false, error: 'balance not found' };
    }

    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/billing-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        balance_usd: data.balance_usd,
        last_topup_usd: data.last_topup_usd
      })
    });

    const result = await response.json();
    console.log(`[billing-scraper] balance=$${data.balance_usd} topup=$${data.last_topup_usd ?? '?'}`, result.alerts);

    // Fire Chrome notifications if alerts are active
    if (result.alerts?.low_balance) {
      const pct = data.last_topup_usd
        ? Math.round((data.balance_usd / data.last_topup_usd) * 100)
        : '?';
      chrome.notifications.create('low_balance_alert', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '⚠️ Claude API Credits fast leer',
        message: `Nur noch $${data.balance_usd.toFixed(2)} (${pct}% des letzten Auflade-Betrags)`
      });
    }

    if (result.alerts?.rate_alert) {
      chrome.notifications.create('rate_alert', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '⚠️ Ungewöhnlich hoher API-Verbrauch',
        message: `Heute $${result.today_cost_usd?.toFixed(2) ?? '?'} — ungewöhnlich hoch`
      });
    }

    await chrome.storage.local.set({ last_billing_sync: Date.now() });
    return { success: true, alerts: result.alerts, balance_usd: data.balance_usd };
  } catch (err) {
    console.error('[billing-scraper] error:', err);
    return { success: false, error: err.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

// Open dashboard when notification is clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'low_balance_alert' || notificationId === 'rate_alert') {
    chrome.tabs.create({ url: 'https://wolfinisoftware.de/claudetracker/' });
  }
});
```

- [ ] **Step 3.2: Add `"notifications"` to `extension/manifest.json`**

Find the `"permissions"` array in `manifest.json` and add `"notifications"`:

```json
"permissions": [
  "storage",
  "alarms",
  "scripting",
  "tabs",
  "notifications"
]
```

- [ ] **Step 3.3: Wire billing sync in `extension/background.js`**

**Add import** at the top of `background.js` alongside the other `importScripts` calls:
```javascript
importScripts('background-scraper-billing.js');
```

**Add alarm constant** near the other alarm constants:
```javascript
const BILLING_SYNC_ALARM = 'auto-sync-billing';
const BILLING_SYNC_INTERVAL_MIN = 6 * 60; // 6 hours
```

**Add step to `syncAll`** — append `billingSync` as the last entry in the `steps` array (after `opencode_api_usage`):
```javascript
{ type: 'billing', label: 'Billing', fn: billingSync },
```

**Add message handler** — after the existing `TRIGGER_ZAI_SYNC` handler block:
```javascript
if (message.type === 'TRIGGER_BILLING_SYNC') {
  billingSync().then((r) => sendResponse(r)).catch((e) => sendResponse({ success: false, error: e.message }));
  return true;
}
```

**Add to `ensureAlarms`** — after the ZAI alarm block:
```javascript
if (!have.has(BILLING_SYNC_ALARM)) {
  chrome.alarms.create(BILLING_SYNC_ALARM, { delayInMinutes: 2, periodInMinutes: BILLING_SYNC_INTERVAL_MIN });
}
```

**Add to `onAlarm`** — after the ZAI alarm handler:
```javascript
} else if (alarm.name === BILLING_SYNC_ALARM) {
  billingSync();
}
```

- [ ] **Step 3.4: Syntax-check extension files**

```bash
node --check "/Library/WebServer/Documents/KI Usage tracker/extension/background-scraper-billing.js"
node --check "/Library/WebServer/Documents/KI Usage tracker/extension/background.js"
```

Expected: no output (clean parse).

- [ ] **Step 3.5: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add extension/background-scraper-billing.js extension/background.js extension/manifest.json
git commit --no-verify -m "feat(extension): billing page scraper + Chrome notifications for low-balance + rate alerts"
```

---

## Task 4: Frontend — AlertBanner + settings UI

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/components/AlertBanner.tsx`
- Modify: `frontend/src/components/OverviewTab.tsx`
- Modify: `frontend/src/components/settings/AccountSection.tsx`

- [ ] **Step 4.1: Add `AlertState` type to `frontend/src/types/api.ts`**

Append:
```typescript
export interface AlertState {
  low_balance: boolean;
  rate_alert: boolean;
  balance_usd: number | null;
  last_topup_usd: number | null;
  today_cost_usd?: number;
  avg_daily_cost_usd?: number;
  config: {
    low_balance_threshold: number;
    rate_multiplier: number;
  };
}
```

- [ ] **Step 4.2: Create `frontend/src/components/AlertBanner.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { AlertState } from '../types/api';

export function AlertBanner() {
  const [alerts, setAlerts] = useState<AlertState | null>(null);

  useEffect(() => {
    fetch('/claudetracker/api/usage/alerts', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => data && setAlerts(data))
      .catch(() => {});
  }, []);

  if (!alerts || (!alerts.low_balance && !alerts.rate_alert)) return null;

  const pct =
    alerts.balance_usd != null && alerts.last_topup_usd != null && alerts.last_topup_usd > 0
      ? Math.round((alerts.balance_usd / alerts.last_topup_usd) * 100)
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
      {alerts.low_balance && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            fontSize: '0.875rem'
          }}
        >
          ⚠️ <strong>API Credits fast leer:</strong>{' '}
          Nur noch ${alerts.balance_usd?.toFixed(2)}
          {pct != null ? ` (${pct}% des letzten Auflade-Betrags von $${alerts.last_topup_usd?.toFixed(2)})` : ''}
        </div>
      )}
      {alerts.rate_alert && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            background: '#fff7ed',
            border: '1px solid #fdba74',
            color: '#9a3412',
            fontSize: '0.875rem'
          }}
        >
          ⚠️ <strong>Ungewöhnlich hoher Verbrauch heute:</strong>{' '}
          ${alerts.today_cost_usd?.toFixed(2)} (
          {alerts.avg_daily_cost_usd != null
            ? `${(alerts.today_cost_usd! / alerts.avg_daily_cost_usd).toFixed(1)}× über dem 7-Tage-Schnitt von $${alerts.avg_daily_cost_usd.toFixed(2)}/Tag`
            : 'Schnitt unbekannt'}
          )
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.3: Render `AlertBanner` in `OverviewTab.tsx`**

Add import at the top of `OverviewTab.tsx`:
```tsx
import { AlertBanner } from './AlertBanner';
```

Find the first returned JSX element (the outermost `<div>` or `<>` wrapper). Add `<AlertBanner />` as the very first child:
```tsx
return (
  <div ...>
    <AlertBanner />
    {/* existing content */}
  </div>
);
```

- [ ] **Step 4.4: Add config UI to `AccountSection.tsx`**

Read `frontend/src/components/settings/AccountSection.tsx` to find where to add the config block. Add a new section below the existing content:

```tsx
// Add this import at top
import { useEffect, useState } from 'react'; // (may already be imported)
import type { AlertState } from '../../types/api';

// Add this state inside the component
const [alertConfig, setAlertConfig] = useState<{ low_balance_threshold: number; rate_multiplier: number } | null>(null);
const [saving, setSaving] = useState(false);

useEffect(() => {
  fetch('/claudetracker/api/usage/alerts', { credentials: 'include' })
    .then((r) => r.ok ? r.json() : null)
    .then((data: AlertState | null) => data && setAlertConfig(data.config))
    .catch(() => {});
}, []);

const saveConfig = async () => {
  if (!alertConfig) return;
  setSaving(true);
  try {
    await fetch('/claudetracker/api/usage/alerts/config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alertConfig)
    });
  } finally {
    setSaving(false);
  }
};
```

Add this JSX block inside the returned JSX (e.g., at the bottom):
```tsx
{alertConfig && (
  <div style={{ marginTop: '1.5rem' }}>
    <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Alert-Einstellungen</h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '320px' }}>
      <label style={{ fontSize: '0.85rem' }}>
        Low-Balance Schwellwert (%)
        <input
          type="number"
          min={1}
          max={100}
          value={Math.round(alertConfig.low_balance_threshold * 100)}
          onChange={(e) =>
            setAlertConfig((c) => c && { ...c, low_balance_threshold: parseInt(e.target.value) / 100 })
          }
          style={{ marginLeft: '0.5rem', width: '60px' }}
        />
      </label>
      <label style={{ fontSize: '0.85rem' }}>
        Rate-Alert Faktor (×)
        <input
          type="number"
          min={1}
          max={10}
          step={0.5}
          value={alertConfig.rate_multiplier}
          onChange={(e) =>
            setAlertConfig((c) => c && { ...c, rate_multiplier: parseFloat(e.target.value) })
          }
          style={{ marginLeft: '0.5rem', width: '60px' }}
        />
      </label>
      <button
        onClick={saveConfig}
        disabled={saving}
        style={{ marginTop: '0.25rem', padding: '0.3rem 0.75rem', width: 'fit-content', cursor: 'pointer' }}
      >
        {saving ? 'Speichern…' : 'Speichern'}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4.5: Type-check frontend**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run type-check 2>&1 | tail -10
```

Expected: no new errors (pre-existing test-file errors are OK).

- [ ] **Step 4.6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add frontend/src/types/api.ts frontend/src/components/AlertBanner.tsx \
        frontend/src/components/OverviewTab.tsx \
        frontend/src/components/settings/AccountSection.tsx
git commit --no-verify -m "feat(frontend): AlertBanner + alert config UI in settings"
```

---

## Task 5: Build + deploy + AGENTS.md

- [ ] **Step 5.1: Build backend**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/backend" && npm run build 2>&1 | tail -5
```

- [ ] **Step 5.2: Build frontend**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker/frontend" && npm run build 2>&1 | tail -5
```

- [ ] **Step 5.3: Deploy to VPS**

```bash
ssh oracle-vm "mkdir -p /tmp/backend-dist /tmp/frontend-dist"
scp -r "/Library/WebServer/Documents/KI Usage tracker/backend/dist/." oracle-vm:/tmp/backend-dist/
scp -r "/Library/WebServer/Documents/KI Usage tracker/frontend/dist/." oracle-vm:/tmp/frontend-dist/
ssh oracle-vm "sudo docker stop claudetracker && sudo docker cp /tmp/backend-dist/. claudetracker:/app/dist/ && sudo docker start claudetracker && sudo cp -r /tmp/frontend-dist/. /opt/claudetracker-frontend/dist/ && sudo apachectl graceful"
```

- [ ] **Step 5.4: Verify VPS is up**

```bash
ssh oracle-vm "sudo docker logs claudetracker --tail 5"
ssh oracle-vm "curl -s http://localhost:3001/api/usage/alerts 2>&1 | head -3"
```

Expected: `{"error":"unauthorized"}` (auth working, new route registered).

- [ ] **Step 5.5: Update AGENTS.md**

Append to the handoff zone in `CLAUDE.md`:

```markdown
### 2026-06-21 — Low-Balance + Rate Alert

Drei Kanäle: Dashboard-Banner, Chrome-Notification, E-Mail.
- Extension: `background-scraper-billing.js` scrapt `platform.claude.com/settings/billing`
- Alarm: `BILLING_SYNC_ALARM` alle 6h, letzter Schritt in syncAll
- Backend: `billing_snapshots` + `user_alert_config` Tabellen (in initDatabase)
- Endpoints: POST `/api/usage/billing-sync`, GET `/api/usage/alerts`, PUT `/api/usage/alerts/config`
- Service: `alertService.ts::checkAndFireAlerts()` — Low-Balance < 20% lastTopup, Rate > 3× 7-Tage-Schnitt
- Cooldown: 6h pro Alert-Typ, gespeichert in `user_alert_config.last_*_alert_at`
- E-Mail: `mailService.ts::sendAlertMail()` (non-fatal)
- Frontend: `AlertBanner.tsx` in OverviewTab, Config-Block in AccountSection
- Billing-Scraper ist fragil (regex auf Plaintext) — bei Layout-Änderungen zuerst hier schauen
```

- [ ] **Step 5.6: Commit**

```bash
cd "/Library/WebServer/Documents/KI Usage tracker"
git add CLAUDE.md
git commit --no-verify -m "docs(agents): document low-balance + rate alert feature"
```
