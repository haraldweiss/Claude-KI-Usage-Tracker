/**
 * ChatGPT Codex scraper.
 *
 * Scrapes codex usage analytics from chatgpt.com/codex/settings/usage.
 * Extracts: plan name, 5h limit %, weekly limit %, credit usage.
 *
 * Requires: logged-in session to chatgpt.com.
 */
import type { Page } from 'playwright';
import type { ScraperResult, ScraperConfig } from '../types.js';

const CODEX_URL = 'https://chatgpt.com/codex/settings/usage';

function extractCodexUsage(): Record<string, unknown> | null {
  const body = document.body.innerText || '';

  // Plan name
  const planMatch = body.match(/(?:Plan|Abo|Subscription)[:\s]+([A-Za-z0-9\s]+)/i);
  const planName = planMatch ? planMatch[1].trim() : 'Unknown';

  // Usage percentages — look for patterns like "5h 82%" or "Weekly 38%"
  const usage: Record<string, unknown> = { plan_name: planName };

  // 5h/Weekly limits
  const fiveHourMatch = body.match(/(?:5h|5\s*hours?|Std\.?)[^0-9]*?(\d{1,3})\s*%/i);
  if (fiveHourMatch) usage.five_hour_pct = parseInt(fiveHourMatch[1]);

  const weeklyMatch = body.match(/(?:Woche?|Weekly|wöchentlich)[^0-9]*?(\d{1,3})\s*%/i);
  if (weeklyMatch) usage.weekly_pct = parseInt(weeklyMatch[1]);

  // Credits
  const creditMatch = body.match(/(?:Credits?|Guthaben|Credits? limit)[^0-9]*?(\d{1,3})\s*%/i);
  if (creditMatch) usage.credit_pct = parseInt(creditMatch[1]);

  // Free remaining (e.g., "5h 99% frei")
  const freeMatch = body.match(/(\d{1,3})\s*%\s*frei/i);
  if (freeMatch) usage.free_pct = parseInt(freeMatch[1]);

  console.log('[codex] extracted:', JSON.stringify(usage));
  return usage;
}

export async function scrape(page: Page, config: ScraperConfig): Promise<ScraperResult> {
  console.log('[codex] navigating to', CODEX_URL);
  await page.goto(CODEX_URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
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
  const planName = (usage.plan_name as string) || 'Unknown';
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
