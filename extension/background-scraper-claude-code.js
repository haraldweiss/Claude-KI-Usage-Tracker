async function claudeCodeSync(externalTabId = null) {
  let createdTabId = null;

  try {
    let tabId;

    if (externalTabId !== null) {
      tabId = externalTabId;
      // Shared tab from syncAll — navigate to the target URL since it's
      // currently on a different page from a previous scraper.
      await chrome.tabs.update(tabId, { url: CLAUDE_CODE_USAGE_URL });
      await waitForTabReady(tabId, 30000);
    } else {
      const existing = await chrome.tabs.query({ url: 'https://platform.claude.com/claude-code*' });
      if (existing.length > 0) {
        tabId = existing[0].id;
      } else {
        const tab = await chrome.tabs.create({ url: CLAUDE_CODE_USAGE_URL, active: false });
        tabId = tab.id;
        createdTabId = tab.id;
        await waitForTabComplete(tab.id, 30000);
      }
    }

    // Poll for the table to finish skeleton-loading. Anthropic shows
    // 'Loading...' placeholder rows for a few seconds while the data fetches.
    // We retry up to 8 times (~16s) before giving up.
    let attempt = 0;
    let injection;
    while (attempt < 8) {
      await sleep(2000);
      [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = document.body.innerText || '';
          // Quick gate: if any visible cell still says 'Loading...', the
          // skeleton is up — bail out and let the caller retry.
          if (/^\s*Loading\.\.\.\s*$/m.test(text)) {
            return { still_loading: true };
          }
          return { still_loading: false };
        }
      });
      if (!injection?.result?.still_loading) break;
      attempt += 1;
    }

    [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body.innerText || '';

        // Top-level metrics — labels exist in English and German variants.
        const linesMatch = text.match(/(?:Lines of code accepted|Akzeptierte Codezeilen|Zeilen Code akzeptiert)\s*\n+\s*([\d.,]+)/i);
        const total_lines_accepted = linesMatch
          ? parseInt(linesMatch[1].replace(/[.,]/g, ''), 10) || null
          : null;

        const acceptMatch = text.match(/(?:Suggestion accept rate|Akzeptanzrate|Vorschlags?-?Akzeptanzrate)\s*\n+\s*([\d.,]+)\s*%/i);
        const accept_rate_pct = acceptMatch
          ? parseFloat(acceptMatch[1].replace(',', '.'))
          : null;

        // Team table — find the table that has a spend column. We accept
        // English ("Spend this month") and German ("Ausgaben diesen Monat").
        const tables = Array.from(document.querySelectorAll('table'));
        const all_headers = [];
        const rows = [];
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('thead th, thead td'))
            .map((h) => h.textContent.trim().toLowerCase());
          all_headers.push(headers);
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
            const cells = Array.from(tr.querySelectorAll('td'));
            if (cells.length === 0) continue;

            const memberCell = memberIdx >= 0 ? cells[memberIdx] : cells[0];
            const memberRaw = (memberCell?.textContent || '').trim();
            if (!memberRaw) continue;
            // Skip skeleton-loader rows. They render as plain "Loading..."
            // and would otherwise persist forever as bogus DB entries.
            if (/^Loading\.{3}$/i.test(memberRaw)) continue;

            // Split into "name" + tag like "[API KEY]" if present.
            // Anthropic's UI renders the tag in a separate span on the same line.
            const tagMatch = memberRaw.match(/\[([^\]]+)\]/);
            const role = tagMatch ? tagMatch[1].toLowerCase().replace(/\s+/g, '_') : 'user';
            const name = memberRaw.replace(/\[[^\]]+\]/g, '').trim();

            // Spend like "30,45 USD" or "$30.45"
            const spendRaw = (cells[spendIdx]?.textContent || '').trim();
            const spendMatch = spendRaw.match(/[\d.,]+/);
            const cost_usd = spendMatch
              ? parseFloat(spendMatch[0].replace(',', '.'))
              : 0;

            const linesRaw = linesIdx >= 0 ? (cells[linesIdx]?.textContent || '').trim() : '0';
            const lines = parseInt(linesRaw.replace(/[^\d]/g, ''), 10) || 0;

            // Stable identifier: for keys, the last 4 chars of the name
            // (Anthropic exposes only a short suffix, never the full key).
            const key_id_suffix = name.length >= 4 ? name.slice(-4) : name;

            rows.push({ name, role, cost_usd, lines, key_id_suffix });
          }

          if (rows.length > 0) break;
        }

        return { total_lines_accepted, accept_rate_pct, rows, all_headers, tables_seen: tables.length };
      }
    });

    const data = injection?.result;
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      const seen = (data?.all_headers || []).map((h) => `[${h.join(' | ')}]`).join(' / ');
      const reason = data?.tables_seen === 0
        ? 'keine Tabelle'
        : `keine passenden Spalten. Headers: ${seen || '(leer)'}`;
      return { skipped: true, reason };
    }

    const apiBase = await getApiBase();
    let posted = 0;
    for (const row of data.rows) {
      try {
        await authFetch(`${apiBase}/usage/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: row.role === 'api_key'
              ? `Claude Code (${row.name})`
              : `Claude Code · ${row.name}`,
            input_tokens: 0,
            output_tokens: row.lines,
            source: 'claude_code_sync',
            workspace: 'Claude Code',
            key_name: row.name,
            key_id_suffix: row.key_id_suffix,
            cost_usd: row.cost_usd,
            response_metadata: {
              role: row.role,
              lines_accepted: row.lines,
              total_lines_accepted: data.total_lines_accepted,
              accept_rate_pct: data.accept_rate_pct
            }
          })
        });
        posted += 1;
      } catch (err) {
        console.error('Claude-code-sync row failed:', err);
      }
    }

    await chrome.storage.local.set({ last_claude_code_sync: Date.now() });
    console.log(`Claude-code-sync ok: ${posted}/${data.rows.length} rows posted`);
    return { success: true, posted, total: data.rows.length, page_metrics: {
      total_lines_accepted: data.total_lines_accepted,
      accept_rate_pct: data.accept_rate_pct
    }};
  } catch (error) {
    console.error('Claude-code-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Plan B (4th source): opencode.ai workspace usage page
//
// Scrapes the OpenCode Go workspace to get the subscription plan name,
// usage percentages (fortlaufend/continuous, wöchentlich/weekly, monatlich/
// monthly), and their reset timers. One daily snapshot is enough since
// usage percentages change slowly.
// ---------------------------------------------------------------------------
