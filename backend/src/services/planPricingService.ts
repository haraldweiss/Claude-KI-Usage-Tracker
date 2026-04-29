import { runQuery, getQuery, allQuery } from '../database/sqlite.js';

export interface PlanPricingRow {
  plan_name: string;
  monthly_eur: number;
  source: 'manual' | 'auto' | 'tier_default';
  last_updated: string;
}

// Default seed values used the first time the table is empty. Update these
// when Anthropic changes pricing — though the daily refresh tries to keep
// them in sync automatically (best-effort scrape).
const SEED_PLANS: Array<Omit<PlanPricingRow, 'last_updated'>> = [
  { plan_name: 'Pro', monthly_eur: 18, source: 'tier_default' },
  { plan_name: 'Max (5x)', monthly_eur: 99, source: 'tier_default' },
  { plan_name: 'Max (20x)', monthly_eur: 199, source: 'tier_default' },
  { plan_name: 'Team', monthly_eur: 30, source: 'tier_default' }
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
        'INSERT INTO plan_pricing (plan_name, monthly_eur, source) VALUES (?, ?, ?)',
        [seed.plan_name, seed.monthly_eur, seed.source]
      );
    }
  }
}

export async function getAllPlans(): Promise<PlanPricingRow[]> {
  return allQuery<PlanPricingRow>(
    'SELECT plan_name, monthly_eur, source, last_updated FROM plan_pricing ORDER BY monthly_eur ASC'
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
  console.log(
    '[planPricing] Upstream refresh: no scrape-able source available, ' +
    'plan prices remain at their current (manually edited or seeded) values.'
  );
  return { updated: 0, skipped: SEED_PLANS.length, error: 'no_upstream_source' };
}

/**
 * Schedule the daily refresh via the same cron pattern the rest of the
 * pricing/analytics jobs use (2 AM server time). Typed as `any` to match
 * the existing schedulePricingCheck signature — the node-cron module exports
 * a structure that isn't trivially expressible in our local types.
 */
export function schedulePlanPricingRefresh(cronJob: any): void {
  cronJob.schedule('0 2 * * *', async () => {
    try {
      console.log('[planPricing] Running scheduled refresh...');
      const result = await refreshPlanPricingFromUpstream();
      console.log('[planPricing] Refresh result:', result);
    } catch (error) {
      console.error('[planPricing] Scheduled refresh failed:', error);
    }
  });
}
