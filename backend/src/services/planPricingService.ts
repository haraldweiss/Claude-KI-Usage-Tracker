// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import { convertUsdToEur } from './exchangeRateService.js';
import logger from '../utils/logger.js';

export interface PlanPricingRow {
  plan_name: string;
  monthly_eur: number;
  min_seats: number;
  source: 'manual' | 'auto' | 'tier_default';
  last_updated: string;
}

// Default seed values used the first time the table is empty. Update these
// when Anthropic changes pricing — though the daily refresh tries to keep
// them in sync automatically (best-effort scrape).
const SEED_PLANS: Array<Omit<PlanPricingRow, 'last_updated'>> = [
  { plan_name: 'Pro', monthly_eur: 18, min_seats: 1, source: 'tier_default' },
  { plan_name: 'Max (5x)', monthly_eur: 99, min_seats: 1, source: 'tier_default' },
  { plan_name: 'Max (20x)', monthly_eur: 199, min_seats: 1, source: 'tier_default' },
  { plan_name: 'Team', monthly_eur: 125, min_seats: 5, source: 'tier_default' },
  { plan_name: 'OpenCode Go', monthly_eur: 0, min_seats: 1, source: 'tier_default' },
  // z.ai GLM Coding Plan. Seed reflects the "Lite" tier ($16.2/mo ≈ 14.90 €
  // at the conservative fallback rate); the extension's zai_sync overwrites
  // this with the live scraped price (and the actual plan name) on first run.
  { plan_name: 'GLM Coding Lite-Monthly Plan', monthly_eur: 14.9, min_seats: 1, source: 'tier_default' },
  // ChatGPT / Codex subscription plans. Seed at conservative USD→EUR rates
  // (≈0.92). The extension does not yet scrape the specific plan name, so
  // these serve as a reference until the ChatGPT plan name is extracted from
  // the analytics page.
  { plan_name: 'ChatGPT Go', monthly_eur: 7.5, min_seats: 1, source: 'tier_default' },
  { plan_name: 'ChatGPT Plus', monthly_eur: 18.5, min_seats: 1, source: 'tier_default' },
  { plan_name: 'ChatGPT Pro', monthly_eur: 92, min_seats: 1, source: 'tier_default' },
  { plan_name: 'ChatGPT Pro (20x)', monthly_eur: 185, min_seats: 1, source: 'tier_default' }
];

/**
 * Insert seed rows on first run. Idempotent: only fills in plan_name values
 * that don't already exist in the table — never overwrites manual user edits.
 */
export async function seedPlanPricingIfEmpty(): Promise<void> {
  for (const seed of SEED_PLANS) {
    const existing = await getQuery<PlanPricingRow>(
      'SELECT plan_name FROM plan_pricing WHERE plan_name = ?',
      [seed.plan_name]
    );
    if (!existing) {
      await runQuery(
        'INSERT INTO plan_pricing (plan_name, monthly_eur, min_seats, source) VALUES (?, ?, ?, ?)',
        [seed.plan_name, seed.monthly_eur, seed.min_seats, seed.source]
      );
    }
  }
}

export async function getAllPlans(): Promise<PlanPricingRow[]> {
  return allQuery<PlanPricingRow>(
    'SELECT plan_name, monthly_eur, min_seats, source, last_updated FROM plan_pricing ORDER BY monthly_eur ASC'
  );
}

export async function getPlanPrice(planName: string): Promise<number | null> {
  const row = await getQuery<{ monthly_eur: number }>(
    'SELECT monthly_eur FROM plan_pricing WHERE plan_name = ?',
    [planName]
  );
  return row?.monthly_eur ?? null;
}

export async function updatePlanPrice(
  planName: string,
  monthlyEur: number,
  source: PlanPricingRow['source'] = 'manual'
): Promise<void> {
  // Upsert. We don't differentiate 'created' vs 'updated' for the caller —
  // the row exists after this returns, with the requested values.
  const existing = await getQuery<{ plan_name: string }>(
    'SELECT plan_name FROM plan_pricing WHERE plan_name = ?',
    [planName]
  );
  if (existing) {
    await runQuery(
      `UPDATE plan_pricing
       SET monthly_eur = ?, source = ?, last_updated = CURRENT_TIMESTAMP
       WHERE plan_name = ?`,
      [monthlyEur, source, planName]
    );
  } else {
    await runQuery(
      `INSERT INTO plan_pricing (plan_name, monthly_eur, source)
       VALUES (?, ?, ?)`,
      [planName, monthlyEur, source]
    );
  }
}

/**
 * Best-effort daily refresh from the public Anthropic pricing page. The page
 * is HTML and not stable, so we only update rows whose source is 'auto' or
 * 'tier_default' — never overriding manual user edits. If scraping fails,
 * we log and exit silently; the existing values stay valid.
 */
export async function refreshPlanPricingFromUpstream(): Promise<{
  updated: number;
  skipped: number;
  error?: string;
}> {
  // Anthropic's pricing page (https://www.anthropic.com/pricing) does not
  // expose machine-readable pricing for the claude.ai consumer plans. The
  // numbers move only when Anthropic announces a change, which is rare.
  // Implementation note: we keep this hook in place so the daily cron has
  // something to call — if a future page layout becomes scrape-able we can
  // fill in the parser here. For now, the function is a no-op that logs
  // its intent so the user knows the daily job ran.
  logger.info(
    '[planPricing] Upstream refresh: no scrape-able source available, ' +
    'plan prices remain at their current (manually edited or seeded) values.'
  );
  return { updated: 0, skipped: SEED_PLANS.length, error: 'no_upstream_source' };
}

/**
 * Scrape the OpenCode Go pricing page to extract the monthly subscription
 * price and update the DB. Only overwrites rows whose source is not 'manual',
 * so user edits are preserved.
 *
 * The page at https://opencode.ai/go displays:
 *   "Subscribe to Go $10/month"
 * Price is in USD; we convert to EUR using the latest exchange rate.
 */
export async function refreshOpenCodeGoPricing(): Promise<{
  updated: boolean;
  monthly_usd: number | null;
  monthly_eur: number | null;
  error?: string;
}> {
  try {
    const res = await fetch('https://opencode.ai/docs/de/go/');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching opencode.ai/docs/de/go`);
    }
    const html = await res.text();

    // Extract the monthly price. The docs page (German) shows:
    // "OpenCode Go ist ein kostengünstiges Abonnement — 5 $ für deinen
    //  ersten Monat, danach 10 $/Monat"
    const priceMatch = html.match(/\$?(\d+)\s*\$?\s*\/\s*(?:month|Monat)/i)
      || html.match(/danach\s+\$?(\d+)\s*\$?\s*\/\s*(?:month|Monat)/i);
    if (!priceMatch || !priceMatch[1]) {
      return { updated: false, monthly_usd: null, monthly_eur: null, error: 'price_not_found' };
    }

    const monthlyUsd = parseFloat(priceMatch[1]);
    if (!isFinite(monthlyUsd) || monthlyUsd <= 0) {
      return { updated: false, monthly_usd: null, monthly_eur: null, error: 'invalid_price' };
    }

    // Convert to EUR using the latest exchange rate.
    const fx = await convertUsdToEur(monthlyUsd);
    const monthlyEur = fx.eur;

    // Check if the row exists and is not user-edited (source != 'manual').
    const existing = await getQuery<{ source: PlanPricingRow['source'] }>(
      'SELECT source FROM plan_pricing WHERE plan_name = ?',
      ['OpenCode Go']
    );

    if (existing && existing.source === 'manual') {
      logger.info(`[openCodeGoPricing] Skipping — "OpenCode Go" is manually edited`);
      return { updated: false, monthly_usd: monthlyUsd, monthly_eur: monthlyEur, error: 'manual_override' };
    }

    await runQuery(
      `INSERT INTO plan_pricing (plan_name, monthly_eur, source, last_updated)
       VALUES (?, ?, 'auto', CURRENT_TIMESTAMP)
       ON CONFLICT(plan_name) DO UPDATE SET
         monthly_eur = excluded.monthly_eur,
         source = 'auto',
         last_updated = CURRENT_TIMESTAMP`,
      ['OpenCode Go', monthlyEur]
    );

    // Also extract the per-period dollar limits for logging.
    // Docs page: "5-Stunden-Limit — 12 $ Nutzung"
    //             "Wöchentliches Limit — 30 $ Nutzung"
    //             "Monatliches Limit — 60 $ Nutzung"
    const limit5h = html.match(/(?:\d+\s*[-–—]\s*)\$?(\d+)\s*\$/i);
    const limitWeekly = html.match(/Wöchentliches\s+Limit\s*[-–—]\s*\$?(\d+)\s*\$?/i);
    const limitMonthly = html.match(/Monatliches\s+Limit\s*[-–—]\s*\$?(\d+)\s*\$?/i);

    logger.info(
      `[openCodeGoPricing] Updated "OpenCode Go" to ${monthlyUsd} USD ≈ ${monthlyEur.toFixed(2)} EUR` +
      (limit5h ? ` · 5h: ${limit5h[1]} $` : '') +
      (limitWeekly ? ` · Woche: ${limitWeekly[1]} $` : '') +
      (limitMonthly ? ` · Monat: ${limitMonthly[1]} $` : '')
    );
    return { updated: true, monthly_usd: monthlyUsd, monthly_eur: monthlyEur };
  } catch (error) {
    const msg = (error as Error).message;
logger.error({ err: msg }, '[openCodeGoPricing] Fetch failed:');
    return { updated: false, monthly_usd: null, monthly_eur: null, error: msg };
  }
}

/**
 * Schedule the daily refresh via the same cron pattern the rest of the
 * pricing/analytics jobs use (2 AM server time). Calls both the existing
 * Anthropic plan refresh (best-effort) and the OpenCode Go scraper.
 * Typed as `any` to match the existing schedulePricingCheck signature —
 * the node-cron module exports a structure that isn't trivially expressible
 * in our local types.
 */
export function schedulePlanPricingRefresh(cronJob: any): void {
  cronJob.schedule('0 2 * * *', async () => {
    try {
      logger.info('[planPricing] Running scheduled refresh...');
      const result = await refreshPlanPricingFromUpstream();
      logger.info({ data: result }, '[planPricing] Anthropic plans result');
    } catch (error) {
logger.error({ err: error }, '[planPricing] Anthropic plans refresh failed:');
    }

    try {
      const opencodeResult = await refreshOpenCodeGoPricing();
      logger.info({ data: opencodeResult }, '[planPricing] OpenCode Go result');
    } catch (error) {
logger.error({ err: error }, '[planPricing] OpenCode Go refresh failed:');
    }
  });
}
