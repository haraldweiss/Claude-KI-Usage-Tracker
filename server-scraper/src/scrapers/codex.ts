/**
 * ChatGPT Codex scraper.
 *
 * Scrapes codex usage analytics from chatgpt.com/codex/cloud/settings/analytics.
 * Extracts: plan name, 5h limit %, weekly limit %, credit usage.
 *
 * Requires: logged-in session to chatgpt.com.
 */
import type { Page } from 'playwright';
import type { ScraperResult, ScraperConfig } from '../types.js';

const CODEX_URL = 'https://chatgpt.com/codex/cloud/settings/analytics';

function extractCodexUsage(): Record<string, unknown> | null {
  const body = document.body.innerText || '';
  const usage: Record<string, unknown> = {};

  // Plan name: prefer the explicit "ChatGPT <tier>" header (current UI),
  // fall back to the older "Plan: <tier>" label.
  const planMatch = body.match(/ChatGPT\s+(Pro|Plus|Go|Free)\b/i)
    || body.match(/(?:Plan|Abo|Subscription)\s*[:\-]?\s*(Pro|Plus|Go|Free)\b/i);
  if (planMatch) {
    const tier = planMatch[1];
    usage.plan_name = 'ChatGPT ' + tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
  }

  // Remaining percentages. Labels vary across locales / UI versions:
  //   "5-hour limit", "5 hour usage limit", "5 Stunden Nutzungsgrenze"
  //   "Weekly limit", "Weekly usage limit", "Wöchentliches Nutzungslimit"
  //   "Monthly limit", "Monthly usage limit", "Monatliches Nutzungslimit"
  // NOTE: no nested named functions here — esbuild/tsx injects a `__name`
  // helper for them, which is undefined inside page.evaluate().
  const labelPatterns: Array<[string, string]> = [
    ['five_hour_remaining_pct', '5\\s*[-–—]?\\s*(?:Std\\.?|Stunden|hours?)(?:\\s*(?:Nutzungsgrenze|usage limit|limit))?'],
    ['weekly_remaining_pct', '(?:Wöchentliches?\\s+Nutzungslimit|Wöchentlich|Weekly(?:\\s+usage)?\\s+limit|Weekly)'],
    ['monthly_remaining_pct', '(?:Monatliches?\\s+Nutzungslimit|Monatlich|Monthly(?:\\s+usage)?\\s+limit|Monthly)'],
  ];
  for (let i = 0; i < labelPatterns.length; i++) {
    const key = labelPatterns[i][0];
    const label = labelPatterns[i][1];
    const m = body.match(new RegExp('(?:' + label + ')[\\s\\S]{0,100}?([0-9]{1,3})\\s*%', 'i'));
    if (m) usage[key] = parseInt(m[1], 10);
  }

  console.log('[codex] extracted:', JSON.stringify(usage));
  return Object.keys(usage).length > 0 ? usage : null;
}

export async function scrape(page: Page, config: ScraperConfig): Promise<ScraperResult> {
  console.log('[codex] navigating to', CODEX_URL);
  await page.goto(CODEX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
    console.log('[codex] navigation timeout — page may be slow');
  });
  await page.waitForTimeout(3000);

  // Check for login redirect
  const url = page.url();
  if (url.includes('/login') || url.includes('/auth')) {
    return { success: false, source: config.source, error: 'Not logged in — run `tsx src/login.ts codex` first' };
  }

  const usage = await page.evaluate(extractCodexUsage);
  if (!usage) {
    return { success: true, source: config.source, skipped: true, reason: 'no_usage_data' };
  }

  // Post as a single usage record
  const planName = (usage.plan_name as string) || 'Codex';
  const row = {
    model: `codex:${planName}`,
    input_tokens: 0,
    output_tokens: 0,
    source: config.source,
    conversation_id: `server-codex-${Date.now()}`,
    response_metadata: usage,
  };

  return {
    success: true,
    source: config.source,
    rows: [row],
    posted: 1,
    reason: `Plan: ${planName}`,
  };
}
