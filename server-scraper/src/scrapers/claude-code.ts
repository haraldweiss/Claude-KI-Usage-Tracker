/**
 * Claude Code usage scraper.
 *
 * Scrapes the Claude Code usage page on platform.claude.com for:
 * - Total lines accepted
 * - Accept rate percentage
 * - Per-member/API-key table: name, cost, lines, role
 *
 * Mirrors extension/background-scraper-claude-code.js logic.
 */
import { postUsage } from '../api.js';
import { saveCookies, getContext } from '../browser.js';
import type { ScraperResult } from '../types.js';

const CLAUDE_CODE_USAGE_URL = 'https://platform.claude.com/claude-code/usage';
const COOKIE_KEY = 'claude-code';

/**
 * Scrape Claude Code usage stats.
 */
export async function scrapeClaudeCode(): Promise<ScraperResult> {
  const context = await getContext(COOKIE_KEY);
  const page = await context.newPage();
  const startTs = Date.now();

  try {
    console.log('[claude-code] navigating to usage page…');
    await page.goto(CLAUDE_CODE_USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check for redirect (no subscription)
    const currentUrl = page.url();
    if (!currentUrl.startsWith('https://platform.claude.com/')) {
      console.log('[claude-code] redirected — no active Claude Code subscription');
      return { success: false, source: 'claude_code_sync', skipped: true, reason: 'redirected_kein_abo' };
    }

    // Poll for table to finish skeleton-loading (Loading... placeholders)
    let attempts = 0;
    while (attempts < 8) {
      const stillLoading = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return /^\s*Loading\.\.\.\s*$/m.test(text) || text.includes('Loading...');
      });
      if (!stillLoading) break;
      await page.waitForTimeout(2000);
      attempts++;
    }

    if (attempts >= 8) {
      console.log('[claude-code] page still loading after 16s, scraping anyway');
    }

    // Extract usage data
    const data = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const result: Record<string, unknown> = {};

      // Top-level metrics
      const linesMatch = text.match(/(?:Lines of code accepted|Akzeptierte Codezeilen|Zeilen Code akzeptiert)\s*[:\n]+\s*([\d.,]+)/i);
      if (linesMatch) result.total_lines_accepted = parseInt(linesMatch[1].replace(/[.,]/g, ''), 10) || null;

      const acceptMatch = text.match(/(?:Suggestion accept rate|Akzeptanzrate|Vorschlags?-?Akzeptanzrate)\s*[:\n]+\s*([\d.,]+)\s*%/i);
      if (acceptMatch) result.accept_rate_pct = parseFloat(acceptMatch[1].replace(',', '.'));

      // Per-member table
      const tables = document.querySelectorAll('table');
      const rows: Array<{
        name: string; role: string; cost_usd: number; lines: number; key_id_suffix: string
      }> = [];

      for (const table of tables) {
        const headers = [...table.querySelectorAll('thead th, thead td')]
          .map((h) => h.textContent.trim().toLowerCase());

        const memberIdx = headers.findIndex((h) =>
          ['members', 'member', 'mitglieder', 'mitglied', 'name'].some((n) => h.includes(n))
        );
        const spendIdx = headers.findIndex((h) =>
          h.startsWith('spend') || h.startsWith('ausgaben') || h.includes('kosten')
        );
        const linesIdx = headers.findIndex((h) =>
          h.startsWith('lines') || h.startsWith('zeilen')
        );
        if (spendIdx === -1) continue;

        for (const tr of table.querySelectorAll('tbody tr')) {
          const cells = [...tr.querySelectorAll('td')];
          if (cells.length === 0) continue;

          const memberRaw = (cells[memberIdx >= 0 ? memberIdx : 0]?.textContent || '').trim();
          if (!memberRaw || /^Loading\.{3}$/i.test(memberRaw)) continue;

          const tagMatch = memberRaw.match(/\[([^\]]+)\]/);
          const role = tagMatch ? tagMatch[1].toLowerCase().replace(/\s+/g, '_') : 'user';
          const name = memberRaw.replace(/\[[^\]]+\]/g, '').trim();

          const spendRaw = (cells[spendIdx]?.textContent || '').trim();
          const spendMatch = spendRaw.match(/[\d.,]+/);
          const cost_usd = spendMatch ? parseFloat(spendMatch[0].replace(',', '.')) : 0;

          const linesRaw = linesIdx >= 0 ? (cells[linesIdx]?.textContent || '').trim() : '0';
          const lines = parseInt(linesRaw.replace(/[^\d]/g, ''), 10) || 0;

          const key_id_suffix = name.length >= 4 ? name.slice(-4) : name;
          rows.push({ name, role, cost_usd, lines, key_id_suffix });
        }
        if (rows.length > 0) break;
      }

      result.rows = rows;
      return result;
    });

    const rows = data.rows as Array<{
      name: string; role: string; cost_usd: number; lines: number; key_id_suffix: string
    }> | undefined;

    if (!rows || rows.length === 0) {
      console.log('[claude-code] no table data found');
      await saveCookies(context, COOKIE_KEY);
      return { success: false, source: 'claude_code_sync', skipped: true, reason: 'no_table_data' };
    }

    await saveCookies(context, COOKIE_KEY);

    // Post per-member rows
    let posted = 0;
    for (const row of rows) {
      try {
        await postUsage({
          model: row.role === 'api_key'
            ? `Claude Code (${row.name})`
            : `Claude Code · ${row.name}`,
          input_tokens: 0,
          output_tokens: row.lines,
          source: 'claude_code_sync',
          conversation_id: `server-scraper-${startTs}-${row.key_id_suffix}`,
          workspace: 'Claude Code',
          cost_usd: row.cost_usd,
          response_metadata: {
            role: row.role,
            lines_accepted: row.lines,
            total_lines_accepted: data.total_lines_accepted,
            accept_rate_pct: data.accept_rate_pct,
          },
        });
        posted++;
      } catch (err) {
        console.error(`[claude-code] row post failed for ${row.name}:`, err);
      }
    }

    console.log(`[claude-code] posted: ${posted}/${rows.length} rows`);
    return { success: true, source: 'claude_code_sync', posted };
  } catch (err) {
    console.error('[claude-code] error:', err);
    return { success: false, source: 'claude_code_sync', error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}
