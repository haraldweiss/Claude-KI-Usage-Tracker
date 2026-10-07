/**
 * ChatGPT Codex scraper.
 *
 * Reads current shared plan limits from ChatGPT Usage Overview.
 * Extracts: plan name, 5h limit %, weekly limit %, credit usage.
 *
 * Requires: logged-in session to chatgpt.com.
 */
import type { Page } from 'playwright';
import type { ScraperResult, ScraperConfig, UsageTrackPayload } from '../types.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseCodexUsageText } = require('./usage-parser-codex.cjs') as {
  parseCodexUsageText: (text: string) => { success: boolean; data?: Record<string, unknown> };
};
const CODEX_URL = 'https://chatgpt.com/settings/usage?tab=overview';

export async function scrape(page: Page, config: ScraperConfig): Promise<ScraperResult & { rows?: UsageTrackPayload[] }> {
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

  const parsed = parseCodexUsageText(await page.locator('body').innerText());
  const usage = parsed.success ? parsed.data : null;
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
