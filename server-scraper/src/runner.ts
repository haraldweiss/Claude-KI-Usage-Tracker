/**
 * KI Usage Tracker — Scraper Runner
 *
 * Orchestrates all scrapers: iterates through the SCRAPER_REGISTRY,
 * calls each scraper's handler, collects results, and manages the
 * shared browser lifecycle.
 *
 * Two scraper patterns are supported:
 *   1. Self-contained: manages own page + posts to API (claude-ai, console, openai-api)
 *   2. Unified (page, config): receives a Page + config, returns rows (codex)
 */
import { closeBrowser, getContext, saveCookies } from './browser.js';
import { getActiveProviderKeys, postUsage } from './api.js';
import type { ScraperConfig, ScraperResult, UsageTrackPayload } from './types.js';
import { SCRAPER_REGISTRY } from './types.js';

// ---- Scraper imports ----
import { scrapeClaudeAi } from './scrapers/claude-ai.js';
import { scrapeAnthropicConsole } from './scrapers/anthropic-console.js';
import { scrapeOpenAiApi } from './scrapers/openai-api.js';
import { scrapeOpenCodeGo } from './scrapers/opencode-go.js';
import { scrapeZai } from './scrapers/zai.js';
import { scrapeClaudeCode } from './scrapers/claude-code.js';
import { scrapeOpenCodeApiUsage } from './scrapers/opencode-api-usage.js';
import { scrape as scrapeCodex } from './scrapers/codex.js';

// ---- Handlers ----

/** Self-contained handlers — manage their own page + API posting */
const SELF_CONTAINED: Record<string, () => Promise<ScraperResult>> = {
  claude_ai: scrapeClaudeAi,
  console: scrapeAnthropicConsole,
  openai_api: scrapeOpenAiApi,
  opencode_go: scrapeOpenCodeGo,
  zai: scrapeZai,
  claude_code: scrapeClaudeCode,
  opencode_api: scrapeOpenCodeApiUsage,
};

/** Unified handlers — receive (page, config), return ScraperResult with optional rows[] */
interface UnifiedResult extends ScraperResult {
  rows?: UsageTrackPayload[];
}
type UnifiedHandler = (page: import('playwright').Page, config: ScraperConfig) => Promise<UnifiedResult>;

const UNIFIED: Record<string, UnifiedHandler> = {
  codex: scrapeCodex,
};

// ---- Provider gating ----

/** Maps scraper registry keys to provider_config keys (console ≠ anthropic_api). */
const SCRAPER_PROVIDER_KEY: Record<string, string> = {
  claude_ai: 'claude_ai',
  console: 'anthropic_api',
  claude_code: 'claude_code',
  opencode_go: 'opencode_go',
  zai: 'zai',
  opencode_api: 'opencode_api',
  codex: 'codex',
  openai_api: 'openai_api',
};

// ---- Run Options ----

export interface RunOptions {
  /** Only run these scraper keys (default: all in registry) */
  scrapers?: string[];
  /** Close browser after all scrapers finish (default: true) */
  closeOnFinish?: boolean;
}

// ---- Run All ----

/**
 * Run all (or selected) scrapers and return results.
 */
export async function runAll(options: RunOptions = {}): Promise<ScraperResult[]> {
  const { scrapers: filter, closeOnFinish = true } = options;

  const keys = filter && filter.length > 0
    ? filter.filter((k) => SCRAPER_REGISTRY[k] !== undefined)
    : Object.keys(SCRAPER_REGISTRY);

  const results: ScraperResult[] = [];

  // Provider gating: skip scrapers whose plan is unassigned or expired
  // (plan_valid_until reached). null = config unavailable → fail open.
  const activeProviders = await getActiveProviderKeys();

  for (const key of keys) {
    const config = SCRAPER_REGISTRY[key];
    if (!config) {
      results.push({ success: false, source: key, error: `Unknown scraper key "${key}"` });
      continue;
    }

    if (activeProviders) {
      const providerKey = SCRAPER_PROVIDER_KEY[key] ?? key;
      if (!activeProviders.has(providerKey)) {
        console.log(`\n=== ${config.label} (${key}) ===`);
        console.log(`  ⏭️  ${config.source}: provider inactive (plan expired or unassigned) — skipping`);
        results.push({ success: true, source: config.source, skipped: true, reason: 'provider_inactive' });
        continue;
      }
    }

    console.log(`\n=== ${config.label} (${key}) ===`);

    try {
      let result: ScraperResult;

      if (SELF_CONTAINED[key]) {
        // Pattern 1: scraper handles everything
        result = await SELF_CONTAINED[key]();
      } else if (UNIFIED[key]) {
        // Pattern 2: create page, call scraper, post rows
        const context = await getContext(config.cookieKey);
        const page = await context.newPage();
        try {
          const r = await UNIFIED[key](page, config);
          if (r.success && r.rows && r.rows.length > 0) {
            let posted = 0;
            for (const row of r.rows) {
              try {
                await postUsage(row);
                posted++;
              } catch (postErr) {
                console.error(`[${key}] post row failed:`, postErr);
              }
            }
            result = { ...r, posted };
            // Save cookies after successful scrape
            await saveCookies(context, config.cookieKey);
          } else {
            result = r;
          }
        } finally {
          await page.close().catch(() => {});
        }
      } else {
        // Pattern 3: not yet implemented
        console.log(`[${key}] no handler implemented yet — skipping`);
        result = {
          success: false,
          source: config.source,
          skipped: true,
          reason: 'not_implemented',
        };
      }

      results.push(result);

      // Print one-line status
      if (result.success) {
        const detail = result.skipped
          ? `skipped: ${result.reason}`
          : `posted: ${result.posted ?? 0} rows`;
        console.log(`  ✅ ${config.source}: ${detail}`);
      } else {
        console.log(`  ❌ ${config.source}: ${result.error || result.reason || 'unknown error'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${key}: ${msg}`);
      results.push({ success: false, source: key, error: msg });
    }
  }

  if (closeOnFinish) {
    await closeBrowser();
  }

  return results;
}
