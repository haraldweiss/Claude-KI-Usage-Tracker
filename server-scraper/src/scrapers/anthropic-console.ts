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
    await page.goto(CONSOLE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

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

      await page.goto(keysUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
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
 * Extract workspace IDs from the navigation or combobox on platform.claude.com.
 * Uses multiple strategies:
 *   1. Nav sidebar links (a[href*="/settings/workspaces/"])
 *   2. Combobox/select dropdown options
 *   3. Active workspace from URL
 */
async function discoverWorkspaces(page: import('playwright').Page): Promise<Array<{ id: string; name: string }>> {
  try {
    // Strategy 1: Nav sidebar links
    const navLinks = await page.evaluate(() => {
      const results: Array<{ id: string; name: string }> = [];
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

    if (navLinks.length > 0) {
      console.log(`[console] discovered ${navLinks.length} workspaces via nav links`);
      return navLinks;
    }

    // Strategy 2: Combobox/select with workspace options — open the dropdown
    // and read options.
    await page.waitForTimeout(1000);
    const comboWorkspaces = await page.evaluate(() => {
      const results: Array<{ id: string; name: string }> = [];

      // Try to find and open the workspace switcher
      const triggers = document.querySelectorAll<HTMLElement>(
        '[role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]'
      );
      for (const trigger of triggers) {
        const text = trigger.textContent?.trim() || '';
        // Check if this looks like a workspace switcher
        if (text.includes('Workspace') || text.includes('workspace')) {
          trigger.click();
          break;
        }
      }

      // Read options from any visible listbox/menu
      const items = document.querySelectorAll<HTMLElement>('[role="option"], [role="menuitem"]');
      for (const item of items) {
        const name = item.textContent?.trim();
        if (name && name.length > 0 && name.length < 60) {
          // Extract ID from the option if available
          const href = item.getAttribute('href') || item.getAttribute('data-value') || '';
          const match = href.match(/workspaces\/([^/]+)/);
          const id = match ? match[1] : name;
          results.push({ id, name });
        }
      }

      return results;
    });

    if (comboWorkspaces.length > 0) {
      console.log(`[console] discovered ${comboWorkspaces.length} workspaces via combobox`);
      return comboWorkspaces;
    }

    // Strategy 3: Active workspace from URL
    const url = page.url();
    const urlMatch = url.match(/\/settings\/workspaces\/([^/]+)/);
    if (urlMatch) {
      console.log('[console] using active workspace from URL');
      return [{ id: urlMatch[1], name: 'Default' }];
    }

    console.log('[console] no workspaces found');
    return [];
  } catch (err) {
    console.warn('[console] workspace discovery failed:', err);
    return [];
  }
}
