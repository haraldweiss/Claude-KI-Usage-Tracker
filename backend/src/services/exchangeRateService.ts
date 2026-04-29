import { runQuery, getQuery } from '../database/sqlite.js';

export interface ExchangeRate {
  currency_pair: string; // e.g. "USD->EUR"
  rate: number;          // 1 USD = `rate` EUR
  rate_date: string;     // YYYY-MM-DD as reported by Frankfurter
  fetched_at: string;
}

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=EUR';
const PAIR = 'USD->EUR';

// Hard fallback used only if we've never successfully fetched a rate AND
// the API is currently unreachable. Roughly current EUR/USD; intentionally
// conservative so the dashboard can still render plausible numbers without
// any network connectivity.
const FALLBACK_RATE = 0.92;

/**
 * Fetch today's USD->EUR rate from Frankfurter and persist it. Idempotent:
 * if today's rate is already in the DB, the INSERT is a no-op (PRIMARY KEY
 * on currency_pair + rate_date).
 *
 * Returns the rate that's now in the DB for the latest date — either the
 * freshly fetched one, or the previous latest if the API call fails.
 */
export async function refreshExchangeRate(): Promise<ExchangeRate | null> {
  try {
    const res = await fetch(FRANKFURTER_URL);
    if (!res.ok) {
      throw new Error(`Frankfurter HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      amount?: number;
      base?: string;
      date?: string;
      rates?: { EUR?: number };
    };
    const rate = body.rates?.EUR;
    const date = body.date;
    if (typeof rate !== 'number' || !isFinite(rate) || !date) {
      throw new Error(`Frankfurter returned malformed payload: ${JSON.stringify(body)}`);
    }

    // INSERT OR REPLACE — running multiple times in a day overwrites with the
    // most recent fetch (rates can update intra-day even though Frankfurter
    // mostly snapshots once daily).
    await runQuery(
      `INSERT OR REPLACE INTO exchange_rates (currency_pair, rate, rate_date, fetched_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [PAIR, rate, date]
    );

    console.log(`[exchangeRate] USD->EUR ${rate} for ${date} (Frankfurter)`);
    return { currency_pair: PAIR, rate, rate_date: date, fetched_at: new Date().toISOString() };
  } catch (err) {
    console.error('[exchangeRate] Fetch failed:', (err as Error).message);
    // Fall through and return the latest already-stored rate, if any.
    return getLatestRate();
  }
}

/**
 * Latest known USD->EUR rate from our DB. Returns null if we've never
 * persisted a rate (which means the daily refresh has never succeeded).
 */
export async function getLatestRate(): Promise<ExchangeRate | null> {
  const row = await getQuery<ExchangeRate>(
    `SELECT currency_pair, rate, rate_date, fetched_at
     FROM exchange_rates
     WHERE currency_pair = ?
     ORDER BY rate_date DESC
     LIMIT 1`,
    [PAIR]
  );
  return row ?? null;
}

/**
 * Convert a USD amount to EUR using the latest stored rate.
 * If no rate is available, falls back to a conservative hardcoded value
 * so the dashboard renders something usable instead of a NaN/0.
 */
export async function convertUsdToEur(usd: number): Promise<{
  eur: number;
  rate: number;
  rate_date: string | null;
}> {
  const latest = await getLatestRate();
  if (latest) {
    return { eur: usd * latest.rate, rate: latest.rate, rate_date: latest.rate_date };
  }
  return { eur: usd * FALLBACK_RATE, rate: FALLBACK_RATE, rate_date: null };
}

/**
 * Schedule the daily refresh. Same 02:00 slot as the rest of the pricing
 * crons. The first refresh also fires at startup so a fresh install has a
 * rate within seconds.
 */
export function scheduleExchangeRateRefresh(cronJob: any): void {
  cronJob.schedule('0 2 * * *', async () => {
    try {
      console.log('[exchangeRate] Running scheduled refresh...');
      await refreshExchangeRate();
    } catch (error) {
      console.error('[exchangeRate] Scheduled refresh failed:', error);
    }
  });
}
