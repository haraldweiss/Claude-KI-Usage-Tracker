async function discoverWorkspaces(tabId) {
  const errors = [];

  // Step 1: load the keys page (the workspace links are in the sidebar nav
  // but rendered dynamically by React).
  await chrome.tabs.update(tabId, { url: CONSOLE_KEYS_URL });
  await waitForTabReady(tabId, 30000);

  // Step 2: inject observer + wait for React to render workspace links.
  // We inject, wait 15s for React to settle, then read results once.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__wsLinks = [];
        const seen = new Map();
        function scan() {
          for (const a of document.querySelectorAll('a[href*="/settings/workspaces/"], a[href*="wrkspc_"]')) {
            const href = a.getAttribute('href');
            if (!href) continue;
            const m = href.match(/\/settings\/workspaces\/([^/]+)/);
            if (!m) continue;
            const name = (a.textContent || '').trim().replace(/[^\w\s\-_.]/g, '');
            if (!name || seen.has(name) || /^Workspaces?$/i.test(name)) continue;
            seen.set(name, m[1]);
          }
          if (seen.size > 0) window.__wsLinks = [...seen.entries()].map(([n, i]) => ({ name: n, id: i }));
        }
        scan();
        for (const a of document.querySelectorAll('nav a[href*="/workspaces"]')) {
          if (a.getAttribute('href') === '/settings/workspaces' || /workspaces/i.test(a.textContent)) {
            a.click(); break;
          }
        }
        const target = document.querySelector('nav') || document.body;
        new MutationObserver(() => scan()).observe(target, { childList: true, subtree: true });
        setInterval(scan, 1000);
        setTimeout(scan, 12000);
      }
    });
  } catch (e) {
    errors.push('inject: ' + e.message);
  }

  // Wait for React to render, then read once
  await sleep(8000);
  let entries = [];
  try {
    const poll = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.__wsLinks || []
    });
    entries = (poll[0]?.result || []);
  } catch (e) {
    errors.push('read: ' + e.message);
  }

  // Step 2b: if keys page didn't have workspace links, try the workspace
  // list page (/settings/workspaces) with the same observer approach.
  if (entries.length === 0) {
    await chrome.tabs.update(tabId, { url: 'https://platform.claude.com/settings/workspaces' });
    await sleep(3000);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          window.__wsLinks = [];
          const seen = new Map();
          function wsScan() {
            for (const a of document.querySelectorAll('a[href*="/settings/workspaces/"], a[href*="wrkspc_"]')) {
              const href = a.getAttribute('href');
              if (!href) continue;
              const m = href.match(/\/settings\/workspaces\/([^/]+)/);
              if (!m) continue;
              const name = (a.textContent || '').trim().replace(/[^\w\s\-_.]/g, '');
              if (!name || seen.has(name) || /^Workspaces?$/i.test(name)) continue;
              seen.set(name, m[1]);
            }
            if (seen.size > 0) window.__wsLinks = [...seen.entries()].map(([n, i]) => ({ name: n, id: i }));
          }
          wsScan();
          new MutationObserver(() => wsScan()).observe(document.body, { childList: true, subtree: true });
          setTimeout(wsScan, 10000);
        }
      });
    } catch {}
    await sleep(12000);
    try {
      const wsPoll = await chrome.scripting.executeScript({
        target: { tabId }, func: () => window.__wsLinks || []
      });
      const wsEntries = (wsPoll[0]?.result || []);
      if (wsEntries.length > 0) entries.push(...wsEntries);
    } catch {}
  }

  if (entries.length === 0) {
    return { workspaces: [], errors: ['no workspace links found via observer'] };
  }

  // Step 3: resolve IDs (keyword IDs like 'default' → real wrkspc_ ID)
  // by navigating to each workspace's keys page and extracting the URL.
  const workspaces = [];
  for (const e of entries) {
    if (e.id && e.id.startsWith('wrkspc_')) {
      workspaces.push({ id: e.id, name: e.name });
    } else {
      const wsUrl = `${WORKSPACE_KEYS_PREFIX}${e.id}/keys`;
      await chrome.tabs.update(tabId, { url: wsUrl });
      const settled = await waitForUrlPrefix(tabId, WORKSPACE_KEYS_PREFIX, 15000);
      if (settled) {
        const realId = extractWorkspaceId(settled);
        workspaces.push({ id: realId || e.id, name: e.name });
      } else {
        errors.push(`could not resolve workspace URL for "${e.name}"`);
      }
    }
  }

  return { workspaces, errors };
}

// Single-workspace keys scrape. Navigates the tab to the workspace's keys
// page, polls for the table, and returns { rows, diag }. Pure data — the
// caller decides what to do with the rows.
async function scrapeWorkspaceKeys(tabId, workspaceId) {
  await chrome.tabs.update(tabId, { url: workspaceKeysUrl(workspaceId) });
  const settled = await waitForUrlPrefix(tabId, WORKSPACE_KEYS_PREFIX, 30000);
  if (!settled) {
    return { rows: [], reason: `keys page never loaded for ${workspaceId}` };
  }
  return await pollForConsoleRows(tabId, 30000, 500);
}

function formatScrapeFailure(diag) {
  diag = diag || {};
  if (diag.reason) return diag.reason;
  if (diag.tables_seen === 0) return 'keine Tabelle gefunden';
  if (!diag.candidate_headers) {
    const seen = (diag.all_headers || []).map((h) => `[${h.join(' | ')}]`).join(' / ');
    return `keine Kosten-Spalte. Headers: ${seen || '(leer)'}`;
  }
  if (diag.body_row_count === 0) return 'Tabelle leer (Zeilen rendern noch?)';
  if (diag.rows_skipped_no_cost > 0) {
    return `alle ${diag.body_row_count} Zeilen ohne Kosten. Beispiele: ${(diag.cost_samples || []).join(' | ')}`;
  }
  return 'unbekannt';
}

async function consoleSync() {
  let createdTabId = null;

  try {
    const existing = await chrome.tabs.query({ url: `${WORKSPACE_KEYS_PREFIX}*` });
    let tabId;

    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: CONSOLE_KEYS_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabReady(tabId, 30000);
    }

    // Load the cached workspace list. Re-discover via click-simulation if
    // the cache is empty or older than the TTL.
    const cached = await chrome.storage.local.get([
      'workspace_ids_cache',
      'workspace_discovery_last_run'
    ]);
    let workspaces = Array.isArray(cached.workspace_ids_cache)
      ? cached.workspace_ids_cache
      : [];
    const cacheStale =
      !cached.workspace_discovery_last_run ||
      Date.now() - cached.workspace_discovery_last_run > WORKSPACE_DISCOVERY_TTL_MS;

    const discoveryErrors = [];
    if (workspaces.length === 0 || cacheStale) {
      const discovery = await discoverWorkspaces(tabId);
      if (discovery.workspaces.length > 0) {
        workspaces = discovery.workspaces;
        await chrome.storage.local.set({
          workspace_ids_cache: workspaces,
          workspace_discovery_last_run: Date.now()
        });
      }
      discoveryErrors.push(...discovery.errors);
    }

    if (workspaces.length === 0) {
      // Fallback: scrape the current page (still showing the active workspace's
      // keys table from the initial load). This gives us at least one
      // workspace's data, even without successful discovery.
      const data = await pollForConsoleRows(tabId, 30000, 500);
      if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
        return {
          skipped: true,
          reason: `keine Workspaces entdeckt: ${discoveryErrors.join('; ') || 'unbekannt'}` +
            (data ? ', scrape: ' + formatScrapeFailure(data) : '')
        };
      }
      workspaces = [{ id: 'fallback', name: 'Default' }];
      // The scraped rows already contain workspace info from the table column.
      // Post them directly under a synthetic workspace entry.
      const apiBase = await getApiBase();
      let totalPosted = 0;
      for (const row of data.rows) {
        try {
          await authFetch(`${apiBase}/usage/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: row.key_name ? `Anthropic API (${row.key_name})` : 'Anthropic API',
              input_tokens: 0,
              output_tokens: 0,
              source: 'anthropic_console_sync',
              workspace: row.workspace || 'Default',
              key_name: row.key_name || undefined,
              key_id_suffix: row.key_id_suffix || undefined,
              cost_usd: row.cost_usd
            })
          });
          totalPosted += 1;
        } catch (err) {
          console.error('Console-sync fallback row failed:', err);
        }
      }
      const diagStr = discoveryErrors.length ? ` (discovery: ${discoveryErrors.join('; ')})` : '';
      console.log(`Console-sync fallback: ${totalPosted}/${data.rows.length} rows from active workspace${diagStr}`);
      await chrome.storage.local.set({ last_console_sync: Date.now() });
      return {
        success: true,
        posted: totalPosted,
        total: data.rows.length,
        workspaces: 1,
        fallback: true,
        discoveryErrors
      };
    }

    // Scrape each workspace's keys page; post one record per row. Backend
    // appends; ApiKeysDetailTable in the dashboard groups by
    // source+workspace+key_id_suffix at render time.
    const apiBase = await getApiBase();
    let totalPosted = 0;
    let totalRows = 0;
    const workspaceFailures = [];

    for (const ws of workspaces) {
      const data = await scrapeWorkspaceKeys(tabId, ws.id);
      if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
        workspaceFailures.push(`${ws.name}: ${formatScrapeFailure(data)}`);
        continue;
      }
      totalRows += data.rows.length;
      for (const row of data.rows) {
        try {
          await authFetch(`${apiBase}/usage/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: row.key_name ? `Anthropic API (${row.key_name})` : 'Anthropic API',
              input_tokens: 0,
              output_tokens: 0,
              source: 'anthropic_console_sync',
              // Per-workspace keys pages drop the Workspace column from the
              // table (it's redundant). Fall back to the switcher-name we
              // already captured so every row still gets a workspace tag.
              workspace: row.workspace || ws.name,
              key_name: row.key_name || undefined,
              key_id_suffix: row.key_id_suffix || undefined,
              cost_usd: row.cost_usd
            })
          });
          totalPosted += 1;
        } catch (err) {
          console.error(`Console-sync row failed (${ws.name}):`, err);
        }
      }
    }

    await chrome.storage.local.set({ last_console_sync: Date.now() });
    const extras = [];
    if (workspaceFailures.length) extras.push(`failures: ${workspaceFailures.join(' | ')}`);
    if (discoveryErrors.length) extras.push(`discovery: ${discoveryErrors.join('; ')}`);
    console.log(
      `Console-sync ok: ${totalPosted}/${totalRows} rows across ${workspaces.length} workspaces` +
        (extras.length ? ` — ${extras.join(' | ')}` : '')
    );
    return {
      success: true,
      posted: totalPosted,
      total: totalRows,
      workspaces: workspaces.length,
      workspaceFailures,
      discoveryErrors
    };
  } catch (error) {
    console.error('Console-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    trackTabCleanup(createdTabId);
  }
}

// Polls a tab for the Anthropic Console keys table. Retries the scrape
// every `intervalMs` until rows are found or `budgetMs` elapses. The scrape
// itself runs inside the page so we get the live DOM each attempt.
async function pollForConsoleRows(tabId, budgetMs = 30000, intervalMs = 500) {
  const deadline = Date.now() + budgetMs;
  let lastResult = { rows: [], reason: 'never_ran' };

  while (Date.now() < deadline) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeConsoleKeysTable
      });
      lastResult = injection?.result || lastResult;
      if (lastResult && Array.isArray(lastResult.rows) && lastResult.rows.length > 0) {
        return lastResult;
      }
    } catch (err) {
      // Tab may not be ready for executeScript yet; just retry.
      lastResult = { rows: [], reason: `inject_error: ${err?.message || err}` };
    }
    await sleep(intervalMs);
  }
  return lastResult;
}

// Inlined scrape function — kept top-level so executeScript can serialize it.
// Returns rich diagnostic info alongside the rows so the caller can tell the
// difference between "no table found", "found a table but no Cost column",
