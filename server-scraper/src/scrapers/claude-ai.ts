import { type Page } from 'playwright';
import { postUsage } from '../api.js';
import { saveCookies, getContext } from '../browser.js';
import type { ScraperResult } from '../types.js';

const USAGE_URL = 'https://claude.ai/settings/usage';
const UPGRADE_URL = 'https://claude.ai/upgrade';
const COOKIE_KEY = 'claude-ai';

/**
 * Scrape Claude.ai consumer subscription usage page.
 * Mirrors extension/background-scraper-claude.js logic.
 */
export async function scrapeClaudeAi(contextCookies?: boolean): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    console.log('[claude-ai] navigating to usage page…');
    await page.goto(USAGE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Check for "no plan" redirect
    const currentUrl = page.url();
    if (currentUrl.startsWith(UPGRADE_URL)) {
      console.log('[claude-ai] no active plan (redirected to /upgrade)');
      return { success: false, source: 'claude_official_sync', skipped: true, reason: 'no_plan' };
    }

    // Wait for the usage data to render
    await page.waitForSelector('[class*="usage"], [class*="spend"], [class*="Usage"], [data-testid*="usage"]', {
      timeout: 15000,
    }).catch(() => {
      console.log('[claude-ai] usage selector not found, trying page text…');
    });

    await page.waitForTimeout(2000);

    // Extract usage data from the page
    const data = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const result: Record<string, number | string | null> = {};

      // Session spend
      const spendMatch = text.match(/(\d+[.,]\d+)\s*[€$]/);
      if (spendMatch) {
        result.spent_eur = parseFloat(spendMatch[1].replace(',', '.'));
      }

      // Percentage values
      const pcts = [...text.matchAll(/(\d+)\s*%/g)];
      const pctValues = pcts.map((m) => parseInt(m[1], 10));
      if (pctValues.length >= 1) result.session_pct = pctValues[0];
      if (pctValues.length >= 2) result.weekly_pct = pctValues[1];
      if (pctValues.length >= 3) result.monthly_pct = pctValues[2];

      // Reset time hints
      const resetMatch = text.match(/[Rr]eset\s+in\s+(\d+)\s*[hH]/);
      if (resetMatch) result.session_reset_in = resetMatch[0];

      // Session limit
      const limitMatch = text.match(/(\d+)[-\s]?[Ss]tunden/);
      if (limitMatch) result.session_limit_hours = parseInt(limitMatch[1], 10);

      return result;
    });

    // Save cookies after successful login
    await saveCookies(context, COOKIE_KEY);

    // Post data to backend
    await postUsage({
      model: 'Claude.ai Consumer',
      input_tokens: 0,
      output_tokens: 0,
      source: 'claude_official_sync',
      conversation_id: `server-scraper-${startTs}`,
      response_metadata: data as Record<string, unknown>,
    });

    console.log(`[claude-ai] posted: spent=${data.spent_eur ?? '?'}€`);
    return { success: true, source: 'claude_official_sync' };
  } catch (err) {
    console.error('[claude-ai] error:', err);
    return { success: false, source: 'claude_official_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
