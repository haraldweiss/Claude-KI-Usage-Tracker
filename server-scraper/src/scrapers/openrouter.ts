import { postUsage } from '../api.js';
import { getContext, saveCookies } from '../browser.js';
import type { ScraperResult } from '../types.js';

const CREDITS_URL = 'https://openrouter.ai/workspaces/default';
const ACTIVITY_URL = 'https://openrouter.ai/activity';
const COOKIE_KEY = 'openrouter';

/**
 * Scrape OpenRouter credits balance + 30-day activity (cost, tokens, requests, model breakdown).
 * Follows the extension's openrouterSync() logic from extension/background.js.
 */
export async function scrapeOpenRouter(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    // Step 1: scrape credits page
    console.log('[openrouter] navigating to credits page…');
    await page.goto(CREDITS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(6000);

    const creditsData = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      // Credits balance: "Credits $N.NN" or "$N.NN credits"
      const creditMatch = text.match(/(?:credits?|balance|guthaben)[:\s]*\$?\s*([\d.,]+)/i)
        || text.match(/\$\s*([\d.,]+)\s*(?:credits?|EUR|USD)/i);
      // Model count: "N models" or "N modelle"
      const modelMatch = text.match(/(\d+)\s*(?:models?|modelle)/i);
      return {
        credits_remaining: creditMatch ? parseFloat(creditMatch[1].replace(',', '')) : null,
        model_count: modelMatch ? parseInt(modelMatch[1], 10) : null,
      };
    });
    console.log('[openrouter] credits:', JSON.stringify(creditsData));

    // Step 2: scrape activity page (last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from = thirtyDaysAgo.toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const activityUrl = `${ACTIVITY_URL}?from=${from}&to=${to}&date_preset=past_30_days`;

    console.log('[openrouter] navigating to activity page…');
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);

    const usageData = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      // Total spend
      const totalMatch = text.match(/(?:total|gesamt|spend|ausgaben)[:\s]*\$?\s*([\d.,]+)/i)
        || text.match(/\$\s*([\d.,]+)\s*(?:total|gesamt)/i);
      // Total tokens
      const tokenMatch = text.match(/(?:tokens?|token)[:\s]*([\d.,]+)/i);
      // Total requests
      const reqMatch = text.match(/(?:requests?|anfragen)[:\s]*([\d.,]+)/i);
      // Model breakdown rows from table
      const rows: string[][] = [];
      try {
        const tableRows = document.querySelectorAll('table tbody tr, [role="row"]');
        for (const tr of tableRows) {
          const cells = [...tr.querySelectorAll('td, [role="cell"]')]
            .map(c => c.textContent?.trim() || '')
            .filter(c => c.length > 0);
          if (cells.length >= 2) rows.push(cells);
        }
      } catch { /* table may not exist */ }

      return {
        total_cost_usd: totalMatch ? parseFloat(totalMatch[1].replace(',', '')) : null,
        total_tokens: tokenMatch ? parseInt(tokenMatch[1].replace(/,/g, ''), 10) : null,
        total_requests: reqMatch ? parseInt(reqMatch[1].replace(/,/g, ''), 10) : null,
        model_rows: rows.slice(0, 50),
      };
    });
    console.log('[openrouter] usage:', JSON.stringify(usageData));

    await saveCookies(context, COOKIE_KEY);

    // Merge credits + usage and post
    const combined = { ...creditsData, ...usageData };
    await postUsage({
      model: 'OpenRouter',
      input_tokens: 0,
      output_tokens: 0,
      source: 'openrouter_sync',
      conversation_id: `server-scraper-${startTs}`,
      response_metadata: combined as Record<string, unknown>,
    });

    console.log('[openrouter] posted:', JSON.stringify(combined));
    return { success: true, source: 'openrouter_sync' };
  } catch (err) {
    console.error('[openrouter] error:', err);
    return { success: false, source: 'openrouter_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
