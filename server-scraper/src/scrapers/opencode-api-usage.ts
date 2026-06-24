/**
 * OpenCode API usage scraper.
 *
 * Scrapes https://opencode.ai/workspace/<id>/usage for per-API-key usage data.
 * Extracts: per-key aggregates (cost, input/output tokens) + "Alle Keys" grand total.
 *
 * Simplified for server-side scraping: posts per-key aggregates + grand total.
 * Individual transaction rows are omitted (YAGNI — aggregates give the cost picture).
 *
 * Mirrors extension/background-scraper-opencode-usage.js logic.
 */
import { postUsage } from '../api.js';
import { saveCookies, getContext } from '../browser.js';
import type { ScraperResult } from '../types.js';

const OPENCODE_GO_URL = 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go';
const COOKIE_KEY = 'opencode-api';

/**
 * Derive usage URL from go workspace URL.
 */
function usageUrl(): string {
  return OPENCODE_GO_URL.replace(/\/go(?:\/.*)?$/, '/usage');
}

/**
 * Today's date string for dedup in conversation_id.
 */
function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sanitize a key name for use in conversation_id.
 */
function sanitize(name: string): string {
  return (name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
}

/**
 * Scrape the usage table and return rows + discovered key names.
 */
async function scrapeUsagePage(page: import('playwright').Page): Promise<{
  rows: Array<{
    event_date: string; model: string; input_tokens: number; output_tokens: number;
    cost_usd: number; session_id: string | null; key_name: string | null;
  }>;
  diag: Record<string, unknown>;
}> {
  return page.evaluate(() => {
    const diag: Record<string, unknown> = { tables_seen: 0, rows_found: 0, method: 'none' };
    const rows: Array<{
      event_date: string; model: string; input_tokens: number; output_tokens: number;
      cost_usd: number; session_id: string | null; key_name: string | null;
    }> = [];

    // Normalize date
    const normalizeDate = (dateStr: string): string => {
      if (!dateStr) return new Date().toISOString().slice(0, 10);
      try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch { /* ignore */ }
      return new Date().toISOString().slice(0, 10);
    };

    // Try DOM-based table extraction
    const tables = [...document.querySelectorAll('table, [role="table"], [role="grid"]')];
    diag.tables_seen = tables.length;

    for (const table of tables) {
      const headerEls = table.querySelectorAll('thead th, thead td, [role="columnheader"]');
      const headers = [...headerEls].map((h) => h.textContent.trim().toLowerCase());
      if (headers.length === 0) continue;

      const hasMatch = headers.some((h) => /datum|date|model|modell|input|output|kosten|cost|sitzung|session/i.test(h));
      if (!hasMatch) continue;

      const colMap: Record<string, number> = { date: -1, model: -1, input: -1, output: -1, cost: -1, session: -1 };
      for (let hi = 0; hi < headers.length; hi++) {
        const h = headers[hi];
        if (colMap.date === -1 && /datum|date|zeit|time/.test(h)) colMap.date = hi;
        if (colMap.model === -1 && /modell|model/.test(h)) colMap.model = hi;
        if (colMap.input === -1 && (h === 'input' || h === 'in' || h.includes('input'))) colMap.input = hi;
        if (colMap.output === -1 && (h === 'output' || h === 'out' || h.includes('output'))) colMap.output = hi;
        if (colMap.cost === -1 && /kosten|cost|preis|price|usd|\$/.test(h)) colMap.cost = hi;
        if (colMap.session === -1 && /sitzung|session|conversation|id/.test(h)) colMap.session = hi;
      }
      if (colMap.model === -1 || (colMap.input === -1 && colMap.cost === -1)) continue;

      const tbody = table.querySelector('tbody');
      const tableRows = tbody
        ? [...tbody.querySelectorAll('tr, [role="row"]')]
        : [...table.querySelectorAll('tr, [role="row"]')];

      for (const tr of tableRows) {
        const cells = [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')];
        if (cells.length < 2) continue;

        const rawDate = colMap.date >= 0 ? (cells[colMap.date]?.textContent || '').trim() : '';
        const model = colMap.model >= 0 ? (cells[colMap.model]?.textContent || '').trim() : '';
        const rawInput = colMap.input >= 0 ? (cells[colMap.input]?.textContent || '').trim() : '0';
        const rawOutput = colMap.output >= 0 ? (cells[colMap.output]?.textContent || '').trim() : '0';
        const rawCost = colMap.cost >= 0 ? (cells[colMap.cost]?.textContent || '').trim() : '$0';
        const session = colMap.session >= 0 ? (cells[colMap.session]?.textContent || '').trim() : '';

        if (!model) continue;

        rows.push({
          event_date: rawDate,
          model,
          input_tokens: parseInt(rawInput.replace(/[^0-9]/g, '')) || 0,
          output_tokens: parseInt(rawOutput.replace(/[^0-9]/g, '')) || 0,
          cost_usd: parseFloat(rawCost.replace(/[^0-9.]/g, '')) || 0,
          session_id: session || null,
          key_name: null,
        });
      }
      if (rows.length > 0) {
        diag.method = 'dom';
        diag.rows_found = rows.length;
        return { rows, diag };
      }
    }

    // Fallback: text-based row extraction
    const text = document.body.innerText || '';
    const dateRe = /([A-Z][a-z]{2}\s+\d{1,2},\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
    const rowStarts: Array<{ index: number; date: string }> = [];
    let dateMatch: RegExpExecArray | null;
    while ((dateMatch = dateRe.exec(text)) !== null) {
      rowStarts.push({ index: dateMatch.index, date: dateMatch[1].trim() });
    }

    for (let ri = 0; ri < rowStarts.length; ri++) {
      const start = rowStarts[ri];
      const end = ri + 1 < rowStarts.length ? rowStarts[ri + 1].index : text.length;
      const block = text.slice(start.index, end);

      const modelMatch = block.match(/[A-Z][a-z]{2}\s+\d{1,2},\s*\d{1,2}:\d{2}(?:\s*AM|PM)?\s+([A-Za-z0-9_.\-\/]+)/);
      const model2 = modelMatch ? modelMatch[1].trim() : '';
      const numbers = block.match(/(\d{3,})/g) || [];
      const costMatch = block.match(/\$?(\d+\.\d+)/);
      const sessionMatch = block.match(/[0-9a-fA-F-]{8,}/);

      if (model2) {
        rows.push({
          event_date: start.date,
          model: model2,
          input_tokens: numbers.length >= 1 ? parseInt(numbers[0], 10) : 0,
          output_tokens: numbers.length >= 2 ? parseInt(numbers[1], 10) : 0,
          cost_usd: costMatch ? parseFloat(costMatch[1]) : 0,
          session_id: sessionMatch ? sessionMatch[0] : null,
          key_name: null,
        });
      }
    }

    diag.method = 'text';
    diag.rows_found = rows.length;
    return { rows, diag };
  });
}

/**
 * Discover individual API key names from the dropdown filter.
 */
async function discoverKeyNames(page: import('playwright').Page): Promise<string[]> {
  try {
    const keys = await page.evaluate(() => {
      const result: string[] = [];

      // Try <select> elements
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const label = (sel.getAttribute('aria-label') || sel.name || sel.id || '').toLowerCase();
        if (label.includes('key') || label.includes('schlüssel') || label.includes('api')) {
          for (const opt of sel.options) {
            const text = opt.textContent.trim();
            if (text && text !== 'Alle Keys' && text !== 'All Keys' && text !== '—' && text.length < 80) {
              result.push(text);
            }
          }
          if (result.length > 0) return result;
        }
      }

      // Try ARIA combobox/listbox
      const combos = document.querySelectorAll('[role="combobox"], [role="listbox"]');
      for (const combo of combos) {
        const items = combo.querySelectorAll('[role="option"], option');
        for (const item of items) {
          const text = item.textContent.trim();
          if (text && text !== 'Alle Keys' && text !== 'All Keys' && text !== '—' && text.length < 80) {
            result.push(text);
          }
        }
        if (result.length > 0) return result;
      }

      return result;
    });
    // Deduplicate
    return [...new Set(keys)];
  } catch (err) {
    console.warn('[opencode-api] key discovery failed:', err);
    return [];
  }
}

/**
 * Switch the filter to a specific key and scrape its data.
 */
async function switchToKeyAndScrape(
  page: import('playwright').Page,
  keyName: string
): Promise<Array<{
  event_date: string; model: string; input_tokens: number; output_tokens: number;
  cost_usd: number; session_id: string | null; key_name: string;
}>> {
  try {
    // Click the filter option
    await page.evaluate((name) => {
      // Try <select> first
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const label = (sel.getAttribute('aria-label') || sel.name || sel.id || '').toLowerCase();
        if (label.includes('key') || label.includes('schlüssel') || label.includes('api')) {
          for (let oi = 0; oi < sel.options.length; oi++) {
            if (sel.options[oi].textContent.trim() === name) {
              sel.selectedIndex = oi;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
        }
      }
      // Try ARIA option click
      const items = document.querySelectorAll('[role="option"]');
      for (const item of items) {
        if (item.textContent.trim() === name) {
          (item as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, keyName);

    // Wait for table to re-render
    await page.waitForTimeout(2000);

    const data = await scrapeUsagePage(page);
    if (data.rows.length > 0) {
      for (const row of data.rows) {
        row.key_name = keyName;
      }
    }
    return data.rows;
  } catch (err) {
    console.warn(`[opencode-api] key switch failed for "${keyName}":`, err);
    return [];
  }
}

/**
 * Aggregate rows into per-key totals.
 */
function aggregateRows(
  rows: Array<{ input_tokens: number; output_tokens: number; cost_usd: number; model: string }>
): { total_input: number; total_output: number; total_cost: number; row_count: number; model_breakdown: Record<string, { input: number; output: number; cost: number; count: number }> } {
  let total_input = 0, total_output = 0, total_cost = 0;
  const modelBreakdown: Record<string, { input: number; output: number; cost: number; count: number }> = {};

  for (const row of rows) {
    total_input += row.input_tokens;
    total_output += row.output_tokens;
    total_cost += row.cost_usd;
    if (!modelBreakdown[row.model]) {
      modelBreakdown[row.model] = { input: 0, output: 0, cost: 0, count: 0 };
    }
    modelBreakdown[row.model].input += row.input_tokens;
    modelBreakdown[row.model].output += row.output_tokens;
    modelBreakdown[row.model].cost += row.cost_usd;
    modelBreakdown[row.model].count += 1;
  }

  return { total_input, total_output, total_cost, row_count: rows.length, model_breakdown: modelBreakdown };
}

/**
 * Scrape OpenCode API usage.
 */
export async function scrapeOpenCodeApiUsage(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    const url = usageUrl();
    console.log(`[opencode-api] navigating to ${url}…`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for auth redirect chain
    const maxWait = Date.now() + 20000;
    let landed = false;
    while (Date.now() < maxWait) {
      const currentUrl = page.url();
      if (currentUrl.startsWith('https://opencode.ai/')) {
        landed = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!landed) {
      const currentUrl = page.url();
      if (currentUrl.includes('auth.opencode.ai')) {
        console.log('[opencode-api] login required');
        return { success: false, source: 'opencode_api_usage_sync', skipped: true, reason: 'login_required' };
      }
      console.log(`[opencode-api] unexpected URL: ${currentUrl}`);
      return { success: false, source: 'opencode_api_usage_sync', skipped: true, reason: `unexpected_url: ${currentUrl}` };
    }

    // Let table render
    await page.waitForTimeout(3000);

    // Step 1: scrape "Alle Keys" view
    const allKeysData = await scrapeUsagePage(page);
    if (!allKeysData.rows || allKeysData.rows.length === 0) {
      console.log(`[opencode-api] no rows found (method=${allKeysData.diag.method})`);
      await saveCookies(context, COOKIE_KEY);
      return { success: false, source: 'opencode_api_usage_sync', skipped: true, reason: 'no_rows' };
    }

    // Step 2: discover individual key names
    const keyNames = await discoverKeyNames(page);
    console.log(`[opencode-api] discovered ${keyNames.length} keys`);

    // Step 3: per-key aggregates
    const perKeyData: Array<{ key_name: string; rows: typeof allKeysData.rows }> = [];
    for (const keyName of keyNames) {
      const rows = await switchToKeyAndScrape(page, keyName);
      if (rows.length > 0) {
        perKeyData.push({ key_name: keyName, rows });
      }
    }

    await saveCookies(context, COOKIE_KEY);

    // Step 4: POST data
    let posted = 0;

    // Grand total (Alle Keys)
    const grandTotal = aggregateRows(allKeysData.rows);
    try {
      await postUsage({
        model: 'OpenCode API (Alle Keys)',
        input_tokens: grandTotal.total_input,
        output_tokens: grandTotal.total_output,
        source: 'opencode_api_sync',
        conversation_id: `opencode-api-aggr-alle-keys-${todayDateStr()}`,
        cost_usd: grandTotal.total_cost,
        response_metadata: {
          type: 'grand_total',
          total_rows: grandTotal.row_count,
          model_breakdown: grandTotal.model_breakdown,
          scraped_at: new Date().toISOString(),
        },
      });
      posted++;
    } catch (err) {
      console.error('[opencode-api] grand total POST failed:', err);
    }

    // Per-key aggregates
    for (const entry of perKeyData) {
      const agg = aggregateRows(entry.rows);
      try {
        await postUsage({
          model: 'OpenCode API',
          input_tokens: agg.total_input,
          output_tokens: agg.total_output,
          source: 'opencode_api_sync',
          conversation_id: `opencode-api-aggr-${sanitize(entry.key_name)}-${todayDateStr()}`,
          cost_usd: agg.total_cost,
          response_metadata: {
            type: 'per_key_aggregate',
            key_name: entry.key_name,
            total_rows: agg.row_count,
            model_breakdown: agg.model_breakdown,
            scraped_at: new Date().toISOString(),
          },
        });
        posted++;
      } catch (err) {
        console.error(`[opencode-api] aggregate POST failed for ${entry.key_name}:`, err);
      }
    }

    console.log(`[opencode-api] posted: ${posted} rows (${allKeysData.rows.length} scraped, ${keyNames.length} keys)`);
    return { success: true, source: 'opencode_api_sync', posted };
  } catch (err) {
    console.error('[opencode-api] error:', err);
    return { success: false, source: 'opencode_api_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
