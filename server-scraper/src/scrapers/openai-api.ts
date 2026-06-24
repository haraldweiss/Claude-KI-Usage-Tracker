import { postUsage } from '../api.js';
import { getContext, saveCookies } from '../browser.js';
import type { ScraperResult } from '../types.js';

const OPENAI_USAGE_URL = 'https://platform.openai.com/usage';
const COOKIE_KEY = 'openai-api';

/**
 * Scrape OpenAI API month-to-date usage.
 * Mirrors extension/background-scraper-openai-api.js logic.
 */
export async function scrapeOpenAiApi(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    console.log('[openai-api] navigating to usage page…');
    await page.goto(OPENAI_USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const result: Record<string, number | string | null> = {};

      // MTD spend: "$N.NN" or "N.NN $"
      const spendMatch = text.match(/\$?(\d+[.,]\d+)\s*(?:MTD|\$)?/);
      if (spendMatch) result.cost_usd = parseFloat(spendMatch[1].replace(',', '.'));

      // Total tokens
      const tokenMatch = text.match(/(\d+[.,]?\d*)\s*(K|M)?\s*[Tt]okens/);
      if (tokenMatch) {
        let val = parseFloat(tokenMatch[1].replace(',', '.'));
        if (tokenMatch[2]?.toUpperCase() === 'K') val *= 1000;
        if (tokenMatch[2]?.toUpperCase() === 'M') val *= 1_000_000;
        result.total_tokens = Math.round(val);
      }

      // Total requests
      const reqMatch = text.match(/(\d+[.,]?\d*)\s*(K|M)?\s*[Rr]equests/);
      if (reqMatch) {
        let val = parseFloat(reqMatch[1].replace(',', '.'));
        if (reqMatch[2]?.toUpperCase() === 'K') val *= 1000;
        if (reqMatch[2]?.toUpperCase() === 'M') val *= 1_000_000;
        result.requests = Math.round(val);
      }

      return result;
    });

    await saveCookies(context, COOKIE_KEY);

    const costUsd = typeof data.cost_usd === 'number' ? data.cost_usd : 0;
    await postUsage({
      model: 'OpenAI API',
      input_tokens: 0,
      output_tokens: 0,
      source: 'openai_api_sync',
      conversation_id: `server-scraper-${startTs}`,
      cost_usd: costUsd,
      response_metadata: data as Record<string, unknown>,
    });

    console.log('[openai-api] posted:', JSON.stringify(data));
    return { success: true, source: 'openai_api_sync' };
  } catch (err) {
    console.error('[openai-api] error:', err);
    return { success: false, source: 'openai_api_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
