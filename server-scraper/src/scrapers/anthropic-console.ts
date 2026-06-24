import { postUsage } from '../api.js';
import { saveCookies, getContext } from '../browser.js';
import type { ScraperResult } from '../types.js';

const CONSOLE_URL = 'https://platform.claude.com/settings/keys';
const WORKSPACE_KEYS_PREFIX = 'https://platform.claude.com/settings/workspaces/';
const COOKIE_KEY = 'anthropic-console';

/**
 * Scrape Anthropic Console API keys across all workspaces.
 * Mirrors extension/background-scraper-console.js logic.
 */
export async function scrapeAnthropicConsole(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    console.log('[console] navigating to keys page…');
    await page.goto(CONSOLE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the keys table to render
    await page.waitForTimeout(3000);

    // Try to find workspace switcher in nav sidebar to discover workspaces
    const workspaces = await discoverWorkspaces(page);

    if (workspaces.length === 0) {
      console.log('[console] no workspaces found');
      return { success: false, source: 'anthropic_console_sync', skipped: true, reason: 'no_workspaces' };
    }

    // Save cookies on first successful access
    await saveCookies(context, COOKIE_KEY);

    // Scrape each workspace's keys
    let totalPosted = 0;
    const apiBase = process.env.API_BASE || 'http://localhost:3001/api';

    for (const ws of workspaces) {
      const keysUrl = `${WORKSPACE_KEYS_PREFIX}${ws.id}/keys`;
      console.log(`[console] scraping ${ws.name} (${keysUrl})…`);

      await page.goto(keysUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);

      // Extract keys from table
      const rows = await page.evaluate(() => {
        const result: Array<{ key_name: string; key_id_suffix: string; cost_usd: number }> = [];
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const headers = [...table.querySelectorAll('thead th, thead td')].map((th) =>
            (th.textContent || '').trim().toLowerCase()
          );
          const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('key'));
          const costIdx = headers.findIndex((h) => h.includes('cost') || h.includes('$') || h.includes('spend'));
          const idIdx = headers.findIndex((h) => h.includes('id') || h.includes('suffix'));
          if (nameIdx === -1) continue;

          for (const tr of table.querySelectorAll('tbody tr')) {
            const cells = [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
            if (!cells[nameIdx]) continue;
            const costRaw = cells[costIdx] || '0';
            const cost_usd = parseFloat(costRaw.replace(/[^0-9.]/g, '')) || 0;
            result.push({
              key_name: cells[nameIdx],
              key_id_suffix: idIdx !== -1 ? cells[idIdx] : '',
              cost_usd,
            });
          }
        }
        return result;
      });

      for (const row of rows) {
        try {
          await postUsage({
            model: `Anthropic API (${row.key_name})`,
            input_tokens: 0,
            output_tokens: 0,
            source: 'anthropic_console_sync',
            workspace: ws.name,
            conversation_id: `server-scraper-${startTs}-${ws.id}`,
            cost_usd: row.cost_usd,
          });
          totalPosted++;
        } catch (err) {
          console.error(`[console] row post failed (${ws.name}/${row.key_name}):`, err);
        }
      }
      console.log(`[console] ${ws.name}: ${rows.length} keys, ${totalPosted} posted so far`);
    }

    return { success: true, source: 'anthropic_console_sync', posted: totalPosted };
  } catch (err) {
    console.error('[console] error:', err);
    return { success: false, source: 'anthropic_console_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Extract workspace IDs from the sidebar navigation on platform.claude.com.
 */
async function discoverWorkspaces(page: import('playwright').Page): Promise<Array<{ id: string; name: string }>> {
  try {
    // Look for workspace links in the nav sidebar
    const links = await page.evaluate(() => {
      const results: Array<{ id: string; name: string }> = [];
      // Match nav links matching /settings/workspaces/<id>/*
      for (const a of document.querySelectorAll('a[href*="/settings/workspaces/"]')) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/settings\/workspaces\/([^/]+)/);
        if (match) {
          results.push({
            id: match[1],
            name: a.textContent?.trim() || match[1],
          });
        }
      }
      return results;
    });

    if (links.length > 0) {
      console.log(`[console] discovered ${links.length} workspaces via nav links`);
      return links;
    }

    // Fallback: try the active workspace from URL
    const url = page.url();
    const urlMatch = url.match(/\/settings\/workspaces\/([^/]+)/);
    if (urlMatch) {
      return [{ id: urlMatch[1], name: 'Default' }];
    }

    return [];
  } catch (err) {
    console.warn('[console] workspace discovery failed:', err);
    return [];
  }
}
