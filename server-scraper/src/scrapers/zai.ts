/**
 * z.ai (Zhipu) GLM Coding Plan scraper.
 *
 * Scrapes two pages from the z.ai console:
 *   /my-plan → plan name, monthly price (USD), auto-renew date
 *   /usage → 5h / weekly / monthly quota %, absolute reset times
 *
 * Mirrors extension/background-scraper-zai.js logic.
 */
import { postUsage } from '../api.js';
import { saveCookies, getContext } from '../browser.js';
import type { ScraperResult } from '../types.js';

const ZAI_MY_PLAN_URL = 'https://z.ai/manage-apikey/coding-plan/personal/my-plan';
const ZAI_USAGE_URL = 'https://z.ai/manage-apikey/coding-plan/personal/usage';
const COOKIE_KEY = 'zai';

/**
 * Scrape z.ai GLM Coding Plan subscription and usage.
 */
export async function scrapeZai(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    // --- Page 1: My Plan ---
    console.log('[zai] navigating to my-plan…');
    await page.goto(ZAI_MY_PLAN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);

    // Check for login redirect
    const url1 = page.url();
    if (url1.includes('login') || url1.includes('auth') || url1.includes('signin')) {
      console.log('[zai] login required');
      return { success: false, source: 'zai_sync', skipped: true, reason: 'login_required' };
    }

    // Check if we have any usable page content
    const hasContent1 = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.length > 100; // more than just boilerplate
    });
    if (!hasContent1) {
      console.log('[zai] page has no meaningful content (empty/redirect)');
      return { success: false, source: 'zai_sync', skipped: true, reason: 'no_content' };
    }

    // Wait for page to settle before evaluating
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('auth') || currentUrl.includes('signin')) {
      console.log('[zai] redirected to login');
      return { success: false, source: 'zai_sync', skipped: true, reason: 'login_required' };
    }
    const plan = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const result: Record<string, unknown> = {};

      // Plan name — before "Valid"/"Invalid" status badge or tiered name
      const beforeStatus = text.match(/(GLM\s+Coding[^\n]*?Plan)\s*\n\s*(?:Valid|Invalid|Active|Expired|Gültig|Ungültig)/i);
      if (beforeStatus) {
        result.plan_name = beforeStatus[1].trim();
      } else {
        const tiered = text.match(/(GLM\s+Coding\s+\w[^\n]*?\bPlan)/i);
        if (tiered) result.plan_name = tiered[1].trim();
      }

      // Monthly price USD
      const priceMatch = text.match(/\$\s*([\d]+(?:\.\d+)?)/);
      if (priceMatch) {
        const p = parseFloat(priceMatch[1]);
        if (isFinite(p) && p > 0) result.price_usd = p;
      }

      // Auto-renew date
      const renewMatch = text.match(/Auto-renew\s+on\s+([\d.\-/]+)/i)
        || text.match(/(?:Verlängert|Erneuert)[^\n]*?([\d.\-/]{6,})/i);
      if (renewMatch) result.auto_renew_date = renewMatch[1].trim();

      return result;
    });

    // --- Page 2: Usage ---
    console.log('[zai] navigating to usage…');
    await page.goto(ZAI_USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(5000);

    const hasContent2 = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.length > 100;
    });
    if (!hasContent2) {
      console.log('[zai] usage page has no content');
      // Still use plan data if we have it
    }

    // Wait for usage page to settle
    await page.waitForTimeout(2000);
    const usageUrl = page.url();
    if (usageUrl.includes('login') || usageUrl.includes('auth') || usageUrl.includes('signin')) {
      console.log('[zai] redirected to login on usage page');
      return { success: false, source: 'zai_sync', skipped: true, reason: 'login_required' };
    }
    const usage = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const result: Record<string, unknown> = {};

      // Helper: percentage after a label
      const pctAfter = (labels: string[]) => {
        for (const label of labels) {
          const re = new RegExp(label + '[\\s\\S]{0,40}?(\\d+)\\s*%', 'i');
          const m = text.match(re);
          if (m) {
            const n = parseInt(m[1], 10);
            if (isFinite(n)) return { pct: n, end: (m.index ?? 0) + m[0].length };
          }
        }
        return { pct: null, end: -1 };
      };

      // Absolute reset timestamp
      const resetAfter = (startIdx: number) => {
        if (startIdx < 0) return null;
        const tail = text.slice(startIdx, startIdx + 120);
        const m = tail.match(/Reset\s*Time\s*[:：]?\s*([\d]{4}-[\d]{2}-[\d]{2}[\sT][\d]{2}:[\d]{2})/i)
          || tail.match(/(?:Zurücksetzung|Reset)[^\n]*?([\d]{4}-[\d]{2}-[\d]{2}[\sT][\d]{2}:[\d]{2})/i);
        return m ? m[1].trim() : null;
      };

      const fiveHour = pctAfter(['5\\s*Hours?\\s*Quota', '5[- ]?Stunden']);
      const weekly = pctAfter(['Weekly\\s*Quota', 'Wöchentlich']);
      const monthly = pctAfter(['Total\\s*Monthly[^\\n]*Quota', 'Monatlich']);

      if (fiveHour.pct !== null) result.five_hour_pct = fiveHour.pct;
      if (weekly.pct !== null) result.weekly_pct = weekly.pct;
      if (weekly.end >= 0) result.weekly_reset = resetAfter(weekly.end);
      if (monthly.pct !== null) result.monthly_pct = monthly.pct;
      if (monthly.end >= 0) result.monthly_reset = resetAfter(monthly.end);

      return result;
    });

    const data = { ...plan, ...usage, scraped_at: new Date().toISOString() };

    if (data.five_hour_pct == null && data.weekly_pct == null && data.monthly_pct == null && !data.plan_name) {
      console.log('[zai] no usage/plan data found, skipping POST');
      await saveCookies(context, COOKIE_KEY);
      return { success: false, source: 'zai_sync', skipped: true, reason: 'no_data' };
    }

    await saveCookies(context, COOKIE_KEY);

    await postUsage({
      model: 'z.ai GLM Coding Plan (Sync)',
      input_tokens: 0,
      output_tokens: 0,
      source: 'zai_sync',
      conversation_id: `server-scraper-${startTs}`,
      response_metadata: data as Record<string, unknown>,
    });

    console.log(`[zai] posted: plan=${data.plan_name ?? '?'} price=${data.price_usd != null ? '$' + data.price_usd : '?'}`);
    return { success: true, source: 'zai_sync' };
  } catch (err) {
    console.error('[zai] error:', err);
    return { success: false, source: 'zai_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
