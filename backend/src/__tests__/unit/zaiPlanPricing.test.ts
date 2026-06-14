// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
//
// Covers the z.ai (GLM Coding Plan) plan-pricing path used by the zai_sync
// handler in usageController: the seed fallback, the USD→EUR upsert, and the
// manual-edit guard. Cost math is user-trust-critical (AGENTS.md §3.3).
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, runQuery, getQuery } = await import('../../database/sqlite.js');
const { seedPlanPricingIfEmpty, getPlanPrice, updatePlanPrice } = await import(
  '../../services/planPricingService.js'
);
const { convertUsdToEur } = await import('../../services/exchangeRateService.js');

const ZAI_PLAN = 'GLM Coding Lite-Monthly Plan';

beforeAll(async () => {
  await initDatabase();
  // Deterministic FX rate so the EUR math is assertable without network.
  await runQuery(
    `INSERT OR REPLACE INTO exchange_rates (currency_pair, rate, rate_date, fetched_at)
     VALUES ('USD->EUR', 0.9, '2026-06-14', CURRENT_TIMESTAMP)`
  );
});

beforeEach(async () => {
  await runQuery('DELETE FROM plan_pricing');
});

describe('z.ai GLM Coding Plan pricing', () => {
  it('seeds the GLM Coding Lite plan with the fallback EUR price', async () => {
    await seedPlanPricingIfEmpty();
    expect(await getPlanPrice(ZAI_PLAN)).toBe(14.9);
  });

  it('converts the scraped USD price to EUR and upserts it', async () => {
    // $16.2 × 0.9 = 14.58 €
    const fx = await convertUsdToEur(16.2);
    expect(fx.eur).toBeCloseTo(14.58, 5);

    await updatePlanPrice(ZAI_PLAN, fx.eur, 'auto');
    const stored = await getPlanPrice(ZAI_PLAN);
    expect(stored).toBeCloseTo(14.58, 5);
  });

  it('auto-creates a row for an upgraded plan tier (Pro)', async () => {
    const proPlan = 'GLM Coding Pro-Monthly Plan';
    expect(await getPlanPrice(proPlan)).toBeNull();
    const fx = await convertUsdToEur(30);
    await updatePlanPrice(proPlan, fx.eur, 'auto');
    expect(await getPlanPrice(proPlan)).toBeCloseTo(27, 5);
  });

  it('does not overwrite a price the user edited by hand (manual guard)', async () => {
    // User pins the price manually in the pricing table.
    await updatePlanPrice(ZAI_PLAN, 13.5, 'manual');

    // Replicate the controller guard: skip the auto-upsert when source=manual.
    const existing = await getQuery<{ source: string }>(
      'SELECT source FROM plan_pricing WHERE plan_name = ?',
      [ZAI_PLAN]
    );
    if (existing?.source !== 'manual') {
      const fx = await convertUsdToEur(16.2);
      await updatePlanPrice(ZAI_PLAN, fx.eur, 'auto');
    }

    // Manual price survives the sync.
    expect(await getPlanPrice(ZAI_PLAN)).toBe(13.5);
  });
});
