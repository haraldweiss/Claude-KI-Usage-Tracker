/**
 * OpenCode Go workspace scraper.
 *
 * Scrapes the OpenCode Go workspace page for plan name, usage percentages
 * (continuous/fortlaufend, weekly/wöchentlich, monthly/monatlich) and
 * reset timers.
 *
 * Mirrors extension/background-scraper-opencode.js logic.
 */
import { postUsage } from '../api.js';
import { saveCookies, getContext } from '../browser.js';
import type { ScraperResult } from '../types.js';

const OPENCODE_WORKSPACE_URL = 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go';
const COOKIE_KEY = 'opencode-go';

/**
 * Scrape OpenCode Go workspace usage.
 */
export async function scrapeOpenCodeGo(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    console.log('[opencode-go] navigating to workspace…');
    await page.goto(OPENCODE_WORKSPACE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // opencode.ai bounces through auth.opencode.ai/authorize. Playwright
    // follows HTTP redirects automatically, but the auth server may take
    // time to validate the cookie and issue the redirect back. The cookie
    // from the extension has domain=auth.opencode.ai — it is sent during
    // the auth redirect leg, not on the initial opencode.ai request.
    await page.waitForTimeout(3000);
    const maxWait = Date.now() + 30000;
    let landed = false;
    let lastUrl = '';
    while (Date.now() < maxWait) {
      const url = page.url();
      if (url !== lastUrl) {
        console.log('[opencode-go] URL:', url.substring(0, 80));
        lastUrl = url;
      }
      if (url.startsWith('https://opencode.ai/') && !url.includes('auth.opencode')) {
        landed = true;
        break;
      }
      await page.waitForTimeout(300);
    }
    if (!landed) {
      const url = page.url();
      // If we're still on auth.opencode.ai, the cookie might be invalid
      if (url.includes('auth.opencode.ai')) {
        console.log('[opencode-go] stuck on auth — cookie may be invalid');
        return { success: false, source: 'opencode_go_sync', skipped: true, reason: 'login_required' };
      }
      console.log('[opencode-go] unexpected final URL:', url);
      return { success: false, source: 'opencode_go_sync', skipped: true, reason: `unexpected_url` };
    }

    // Let React render
    await page.waitForTimeout(3000);

    // Extract usage data
    const data = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const result: Record<string, unknown> = {};

      // Plan name: "Du hast OpenCode Go abonniert." or "You have ... subscribed"
      const planMatch = text.match(/(?:Du hast|You have)\s+(.+?)\s+(?:abonniert|subscribed)/i);
      if (planMatch && planMatch[1].trim().length < 80) result.plan_name = planMatch[1].trim();

      // Reset time regex — supports DE and EN variants
      const resetRe = /(?:Setzt\s+zur(?:ück)?(?:\s+in)?|Zurücksetzung(?:\s+in)?|Wird\s+zurückgesetzt(?:\s+in)?|Resets?(?:\s+in)?|Endet\s+in)\s+([^\n·•]{1,60})/i;

      // Helper: extract percentage for a section label
      const extractPctAndReset = (labels: string[]) => {
        for (const label of labels) {
          const pctRe = new RegExp(`${label}[\\s\\S]{0,200}?(\\d+)\\s*%`, 'i');
          const pctMatch = text.match(pctRe);
          if (!pctMatch) continue;
          const pct = parseInt(pctMatch[1], 10);
          const matchEnd = (pctMatch.index ?? 0) + pctMatch[0].length;

          // Try reset in matched body first
          let reset = pctMatch[0].match(resetRe)?.[1]?.trim() ?? null;
          // Fallback: scan after match
          if (!reset) {
            const tail = text.slice(matchEnd, matchEnd + 200);
            reset = tail.match(resetRe)?.[1]?.trim() ?? null;
          }
          return { pct, reset };
        }
        return { pct: null, reset: null };
      };

      const continuous = extractPctAndReset([
        'Fortlaufend(?![a-zäöüß])', 'Continuous(?![a-z])',
        'Fortlaufende Nutzung', 'Continuous usage',
      ]);
      if (continuous.pct !== null) result.continuous_pct = continuous.pct;
      if (continuous.reset) result.continuous_reset_in = continuous.reset;

      const weekly = extractPctAndReset([
        'Wöchentlich(?![a-zäöüß])', 'Weekly(?![a-z])',
        'Wöchentliche Nutzung', 'Weekly usage',
      ]);
      if (weekly.pct !== null) result.weekly_pct = weekly.pct;
      if (weekly.reset) result.weekly_reset_in = weekly.reset;

      const monthly = extractPctAndReset([
        'Monatlich(?![a-zäöüß])', 'Monthly(?![a-z])',
        'Monatliche Nutzung', 'Monthly usage',
      ]);
      if (monthly.pct !== null) result.monthly_pct = monthly.pct;
      if (monthly.reset) result.monthly_reset_in = monthly.reset;

      result.scraped_at = new Date().toISOString();
      return result;
    });

    if (data.continuous_pct == null && data.weekly_pct == null && data.monthly_pct == null) {
      console.log('[opencode-go] no usage figures found, skipping POST');
      await saveCookies(context, COOKIE_KEY);
      return { success: false, source: 'opencode_go_sync', skipped: true, reason: 'no_data' };
    }

    await saveCookies(context, COOKIE_KEY);

    await postUsage({
      model: 'OpenCode Go (Sync)',
      input_tokens: 0,
      output_tokens: 0,
      source: 'opencode_go_sync',
      conversation_id: `server-scraper-${startTs}`,
      response_metadata: data as Record<string, unknown>,
    });

    console.log(`[opencode-go] posted: plan=${data.plan_name ?? '?'} continuous=${data.continuous_pct ?? '?'}%`);
    return { success: true, source: 'opencode_go_sync' };
  } catch (err) {
    console.error('[opencode-go] error:', err);
    return { success: false, source: 'opencode_go_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
