// Default API base for a fresh install. Users running the backend on a VPS
// override this from the popup via chrome.storage.local.api_base. Every
// fetch resolves the URL fresh so a settings change takes effect on the
// next call without reloading the extension.
const DEFAULT_API_BASE = 'http://localhost:3000/api';
const API_BASE_STORAGE_KEY = 'api_base';
const QUEUE_STORAGE_KEY = 'usage_queue';

async function getApiBase() {
  try {
    const stored = await chrome.storage.local.get(API_BASE_STORAGE_KEY);
    const url = stored?.[API_BASE_STORAGE_KEY];
    if (typeof url === 'string' && url.length > 0) {
      // Strip trailing slash for predictable path joins ('/api' is appended elsewhere).
      return url.replace(/\/+$/, '');
    }
  } catch {
    // chrome.storage can throw during early service-worker startup; fall through.
  }
  return DEFAULT_API_BASE;
}

async function getAuthHeaders() {
  try {
    const stored = await chrome.storage.local.get('api_token');
    if (stored.api_token) {
      return { Authorization: `Bearer ${stored.api_token}` };
    }
  } catch { /* ignore */ }
  return {};
}

// Wrap fetch with our auth header injection. Every backend call goes through
// this so adding/changing headers in one place is enough.
async function authFetch(url, init = {}) {
  const auth = await getAuthHeaders();
  return fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), ...auth }
  });
}
const AUTO_SYNC_ALARM = 'auto-sync-claude';
const AUTO_SYNC_INTERVAL_MIN = 10;
const USAGE_PAGE_URL = 'https://claude.ai/settings/usage';

// Plan B: Console scraping. Console totals update with significant lag and
// don't change minute-to-minute, so 24h is plenty.
const CONSOLE_SYNC_ALARM = 'auto-sync-console';
const CONSOLE_SYNC_INTERVAL_MIN = 24 * 60;
const CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

// Claude Code has its own usage page that reports per-key spend and lines-of-
// code metrics. The settings/keys page reports 0 USD for claude_code_*-keys
// because their billing flows through this surface instead.
const CLAUDE_CODE_SYNC_ALARM = 'auto-sync-claude-code';
const CLAUDE_CODE_SYNC_INTERVAL_MIN = 24 * 60;
const CLAUDE_CODE_USAGE_URL = 'https://platform.claude.com/claude-code';

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRACK_USAGE') {
    trackUsage(message.data)
      .then((response) => sendResponse({ success: true, data: response }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_TODAY_STATS') {
    getTodayStats()
      .then((stats) => sendResponse(stats))
      .catch(() => sendResponse(null));
    return true;
  }

  if (message.type === 'GET_MONTHLY_STATS') {
    getMonthlyStats()
      .then((stats) => sendResponse(stats))
      .catch(() => sendResponse(null));
    return true;
  }

  if (message.type === 'TRIGGER_AUTO_SYNC') {
    autoSync()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'TRIGGER_CONSOLE_SYNC') {
    consoleSync()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'TRIGGER_CLAUDE_CODE_SYNC') {
    claudeCodeSync()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'TRIGGER_SYNC_ALL') {
    // Fire-and-forget: the popup will close as soon as the first hidden tab
    // opens, so we orchestrate here and persist the result to storage. The
    // popup reads `last_sync_all` next time it opens.
    syncAll();
    sendResponse({ success: true, started: true });
    return false;
  }

  if (message.type === 'GET_LAST_SYNC_ALL') {
    chrome.storage.local.get('last_sync_all').then((d) => sendResponse(d.last_sync_all || null));
    return true;
  }
});

async function syncAll() {
  const startedAt = Date.now();
  await chrome.storage.local.set({
    last_sync_all: { status: 'running', startedAt, steps: [] }
  });

  const steps = [
    { type: 'auto', label: 'Claude.ai', fn: autoSync },
    { type: 'console', label: 'Console', fn: consoleSync },
    { type: 'claude_code', label: 'Claude Code', fn: claudeCodeSync },
  ];

  const stepResults = [];
  for (const step of steps) {
    let outcome;
    try {
      const result = await step.fn();
      if (result?.success) outcome = { label: step.label, status: 'ok' };
      else if (result?.skipped) outcome = { label: step.label, status: 'skipped', message: result?.reason || 'nichts zu syncen' };
      else outcome = { label: step.label, status: 'error', message: result?.error || 'unbekannt' };
    } catch (err) {
      outcome = { label: step.label, status: 'error', message: err?.message || String(err) };
    }
    stepResults.push(outcome);
    await chrome.storage.local.set({
      last_sync_all: { status: 'running', startedAt, steps: stepResults }
    });
  }

  await chrome.storage.local.set({
    last_sync_all: { status: 'done', startedAt, finishedAt: Date.now(), steps: stepResults }
  });
}

// ---------------------------------------------------------------------------
// Backend integration
// ---------------------------------------------------------------------------

async function trackUsage(data) {
  try {
    const payload = {
      model: data.model,
      input_tokens: data.input_tokens,
      output_tokens: data.output_tokens,
      conversation_id: data.conversation_id,
      source: data.source || 'claude_ai',
      // Plan B: console scraping fields. Strip undefined keys so the
      // backend validators don't reject them.
      workspace: data.workspace,
      key_name: data.key_name,
      key_id_suffix: data.key_id_suffix,
      cost_usd: data.cost_usd
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error('Failed to track usage');

    const result = await response.json();
    updateBadge();
    return result;
  } catch (error) {
    console.error('Error tracking usage:', error);
    await queueUsageData(data);
    throw error;
  }
}

async function getTodayStats() {
  try {
    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/summary?period=day`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return await response.json();
  } catch (error) {
    console.error('Error getting stats:', error);
    return null;
  }
}

async function getMonthlyStats() {
  try {
    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/summary?period=month`);
    if (!response.ok) throw new Error('Failed to fetch monthly stats');
    return await response.json();
  } catch (error) {
    console.error('Error getting monthly stats:', error);
    return null;
  }
}

async function updateBadge() {
  try {
    const stats = await getTodayStats();
    if (stats && stats.total_tokens) {
      chrome.action.setBadgeText({ text: String(Math.floor(stats.total_tokens / 1000)) + 'K' });
      chrome.action.setBadgeBackgroundColor({ color: '#3B82F6' });
    }
  } catch (error) {
    console.error('Error updating badge:', error);
  }
}

// ---------------------------------------------------------------------------
// Retry queue (for trackUsage failures while backend is down)
// ---------------------------------------------------------------------------

async function queueUsageData(data) {
  try {
    const queue = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    const currentQueue = queue[QUEUE_STORAGE_KEY] || [];
    currentQueue.push(data);
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: currentQueue });
  } catch (error) {
    console.error('Error queuing data:', error);
  }
}

async function retryQueuedData() {
  try {
    const queue = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
    const currentQueue = queue[QUEUE_STORAGE_KEY] || [];
    if (currentQueue.length === 0) return;

    const toRetry = [...currentQueue];
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: [] });

    for (const data of toRetry) {
      try {
        await trackUsage(data);
      } catch (error) {
        await queueUsageData(data);
      }
    }
  } catch (error) {
    console.error('Error retrying queued data:', error);
  }
}

// ---------------------------------------------------------------------------
// Automatic sync from Claude's settings/usage page
//
// We can't read per-message token counts from Claude.ai (those aren't exposed
// in any frontend response), so the canonical data source is the rendered
// settings/usage page. Every AUTO_SYNC_INTERVAL_MIN minutes we either reuse an
// existing usage tab or open a hidden one, scrape, post, and close it.
// ---------------------------------------------------------------------------

async function autoSync() {
  let createdTabId = null;

  try {
    // Reuse an existing tab if the user already has one open
    const existing = await chrome.tabs.query({ url: 'https://claude.ai/settings/usage*' });
    let tabId;

    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: USAGE_PAGE_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabComplete(tab.id, 30000);
      // Give React a moment to render the usage figures
      await sleep(2500);
    }

    // Inject the scrape function directly via scripting API instead of relying
    // on the content script's message listener. This works even if the tab was
    // open before the extension was reloaded (where the content script would
    // be stale or absent and chrome.tabs.sendMessage fails with
    // "Receiving end does not exist").
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // We scrape against the page text rather than DOM nodes because
        // claude.ai's usage page is a hashed-class-name React app — the
        // labels are stable, the class names are not.
        const text = document.body.innerText || '';

        // Helper: read the first number after a label. Handles German and
        // English with localized number formats ("31,35" or "31.35").
        const numAfter = (regex) => {
          const m = text.match(regex);
          if (!m) return null;
          const cleaned = m[1].replace(/\s/g, '').replace(',', '.');
          const n = parseFloat(cleaned);
          return isFinite(n) ? n : null;
        };

        // Plan name: appears near top of page, just after "Plan-Nutzungslimits"
        // (or "Plan usage limits" in English). The plan label is the next
        // non-empty line and looks like "Max (5x)", "Pro", "Team", etc.
        let plan_name = null;
        const planLabelMatch = text.match(/Plan-Nutzungslimits\s*\n+\s*([^\n]+)/i)
          || text.match(/Plan usage limits\s*\n+\s*([^\n]+)/i);
        if (planLabelMatch) {
          const candidate = planLabelMatch[1].trim();
          if (candidate.length < 80) plan_name = candidate;
        }

        // Session usage % — labeled "Aktuelle Sitzung" / "Current session".
        // The percent appears on the same row but a different DOM line; we
        // accept any % within ~200 chars after the label.
        const sessionMatch =
          text.match(/Aktuelle Sitzung[\s\S]{0,200}?(\d+)\s*%/i) ||
          text.match(/Current session[\s\S]{0,200}?(\d+)\s*%/i);
        const session_pct = sessionMatch ? parseInt(sessionMatch[1], 10) : null;

        const allModelsMatch =
          text.match(/Alle Modelle[\s\S]{0,200}?(\d+)\s*%/i) ||
          text.match(/All models[\s\S]{0,200}?(\d+)\s*%/i);
        const weekly_all_models_pct = allModelsMatch ? parseInt(allModelsMatch[1], 10) : null;

        const sonnetMatch =
          text.match(/Nur Sonnet[\s\S]{0,200}?(\d+)\s*%/i) ||
          text.match(/Sonnet only[\s\S]{0,200}?(\d+)\s*%/i);
        const weekly_sonnet_pct = sonnetMatch ? parseInt(sonnetMatch[1], 10) : null;

        // Additional usage block — three numbers we want:
        //   "31,35 € ausgegeben"  → spent_eur
        //   "63% verbraucht"       → spent_pct (of monthly limit)
        //   "50 €" Monatslimit     → monthly_limit_eur
        //   "20,50 €" Aktuelles Guthaben → balance_eur
        const spent_eur = numAfter(/([\d.,]+)\s*€\s*ausgegeben/i)
          ?? numAfter(/([\d.,]+)\s*€\s*spent/i);
        const spent_pct_match =
          text.match(/(\d+)\s*%\s*verbraucht/i) ||
          text.match(/(\d+)\s*%\s*used/i);
        const spent_pct = spent_pct_match ? parseInt(spent_pct_match[1], 10) : null;

        // Labels for "Monatliches Ausgabenlimit" and "Aktuelles Guthaben"
        // appear AFTER their values on the page. A naive regex grabs the
        // first "<n> €" anywhere on the page, which is the spent figure.
        // Walk lines instead and read the value from the line just above
        // each label.
        const lines = text.split('\n').map((s) => s.trim());
        const valueAboveLabel = (labels) => {
          for (let i = 1; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            for (const label of labels) {
              const labelLower = label.toLowerCase();
              // Match exact or as a prefix — Anthropic appends suffixes like
              // " · Automatisches Neuladen aus" to some labels.
              if (lower === labelLower || lower.startsWith(labelLower)) {
                for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
                  const m = lines[j].match(/([\d.,]+)\s*€/);
                  if (m) {
                    const n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
                    return isFinite(n) ? n : null;
                  }
                }
              }
            }
          }
          return null;
        };

        const monthly_limit_eur = valueAboveLabel([
          'Monatliches Ausgabenlimit',
          'Monthly spending limit',
          'Monthly spend limit'
        ]);
        const balance_eur = valueAboveLabel([
          'Aktuelles Guthaben',
          'Current balance'
        ]);

        // Reset date for the additional usage cycle ("Zurücksetzung am May 1")
        const resetMatch =
          text.match(/Zurücksetzung am\s+([^\n]{1,40})/i) ||
          text.match(/Resets on\s+([^\n]{1,40})/i);
        const reset_date = resetMatch ? resetMatch[1].trim() : null;

        return {
          plan_name,
          session_pct,
          weekly_all_models_pct,
          weekly_sonnet_pct,
          spent_eur,
          spent_pct,
          monthly_limit_eur,
          balance_eur,
          reset_date,
          scraped_at: new Date().toISOString()
        };
      }
    });

    const data = injection?.result;
    if (!data) {
      throw new Error('Scrape returned no result');
    }
    if (data.spent_eur == null && data.weekly_all_models_pct == null) {
      console.log('Auto-sync: page returned no usage figures, skipping POST');
      return { skipped: true, reason: 'no_data' };
    }

    const apiBase = await getApiBase();
    const backendResponse = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Claude (Official Sync)',
        // Encode the headline numbers in the existing columns so the rest
        // of the dashboard keeps working without schema churn.
        // - cost goes through the pricing pipeline, so we'd lose precision;
        //   we send 0 here and rely on response_metadata for the truth.
        // - input_tokens and output_tokens carry the legacy fields the
        //   original scraper used (kept for backward compat: spent_eur*1000
        //   and weekly% respectively).
        input_tokens: Math.round((data.spent_eur || 0) * 1000),
        output_tokens: data.weekly_all_models_pct ?? 0,
        conversation_id: `auto-sync-${Date.now()}`,
        source: 'claude_official_sync',
        // Everything else lives here as JSON. Backend stores it verbatim.
        response_metadata: data
      })
    });

    if (!backendResponse.ok) {
      throw new Error('Backend rejected sync: ' + backendResponse.status);
    }

    await chrome.storage.local.set({ last_auto_sync: Date.now() });
    updateBadge();
    console.log('Auto-sync ok:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Auto-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Plan B: console.anthropic.com scraping
//
// We can't use the Anthropic Admin Usage/Cost API (no admin key available),
// so we scrape the rendered keys table the same way we scrape claude.ai's
// usage page. Per-key cumulative cost is exactly what the Console shows in
// the "Cost" column of /settings/keys.
// ---------------------------------------------------------------------------

async function consoleSync() {
  let createdTabId = null;

  try {
    const existing = await chrome.tabs.query({ url: 'https://console.anthropic.com/settings/keys*' });
    let tabId;

    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: CONSOLE_KEYS_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabComplete(tab.id, 30000);
    }

    // Poll the page for the keys table. The Console SPA hydrates async after
    // navigation/load, and reused tabs may also be mid-render. We retry the
    // scrape every 500 ms until either rows are returned or we hit a 30 s
    // budget. Returns the scrape result of the last successful call.
    const data = await pollForConsoleRows(tabId, 30000, 500);

    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      const diag = data || {};
      let reason;
      if (diag.tables_seen === 0) {
        reason = 'keine Tabelle gefunden';
      } else if (!diag.candidate_headers) {
        const seen = (diag.all_headers || []).map((h) => `[${h.join(' | ')}]`).join(' / ');
        reason = `keine Cost-Spalte. Headers: ${seen || '(leer)'}`;
      } else if (diag.body_row_count === 0) {
        reason = 'Tabelle leer (Zeilen rendern noch?)';
      } else if (diag.rows_skipped_no_cost > 0) {
        reason = `alle ${diag.body_row_count} Zeilen ohne Kosten. Beispiele: ${(diag.cost_samples || []).join(' | ')}`;
      } else {
        reason = 'unbekannt';
      }
      console.log('Console-sync skipped:', reason, diag);
      return { skipped: true, reason };
    }

    // Post one record per key. The backend appends each one — diffing
    // happens at query time on the dashboard.
    const apiBase = await getApiBase();
    let posted = 0;
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
            workspace: row.workspace || undefined,
            key_name: row.key_name || undefined,
            key_id_suffix: row.key_id_suffix || undefined,
            cost_usd: row.cost_usd
          })
        });
        posted += 1;
      } catch (err) {
        console.error('Console-sync row failed:', err);
      }
    }

    await chrome.storage.local.set({ last_console_sync: Date.now() });
    console.log(`Console-sync ok: ${posted}/${data.rows.length} rows posted`);
    return { success: true, posted, total: data.rows.length };
  } catch (error) {
    console.error('Console-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
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
// "table found but every row has — for cost", etc.
function scrapeConsoleKeysTable() {
  const diag = {
    rows: [],
    tables_seen: 0,
    candidate_headers: null,
    all_headers: [],
    body_row_count: 0,
    rows_skipped_no_cost: 0,
    rows_skipped_other: 0,
    cost_samples: [],
  };

  // Try real <table> first, then fall back to ARIA tables (div-based grids).
  const realTables = Array.from(document.querySelectorAll('table'));
  const ariaTables = Array.from(document.querySelectorAll('[role="table"]'));
  const tables = realTables.length > 0 ? realTables : ariaTables;
  diag.tables_seen = tables.length;

  // Lenient match: lowercase + word-boundary contains. Handles "Cost",
  // "Cost (USD)", "Cost ▲", "Cost  ⓘ", "MTD Cost", etc. Strict match for
  // 'key' / 'workspace' would also fail with sort-indicator suffixes — same
  // treatment.
  const matchHeader = (headers, needle, opts = {}) => {
    const re = opts.exact
      ? new RegExp(`^${needle}\\b`)
      : new RegExp(`\\b${needle}\\b`);
    return headers.findIndex((h) => re.test(h));
  };

  for (const table of tables) {
    // Real <table>: headers from thead. ARIA: role="columnheader".
    const headerEls = realTables.length > 0
      ? table.querySelectorAll('thead th, thead td')
      : table.querySelectorAll('[role="columnheader"]');
    const headers = Array.from(headerEls).map((h) => h.textContent.trim().toLowerCase());
    diag.all_headers.push(headers);

    const costIdx = matchHeader(headers, 'cost');
    if (costIdx === -1) continue;
    diag.candidate_headers = headers;

    const keyIdx = matchHeader(headers, 'key');
    const workspaceIdx = matchHeader(headers, 'workspace');
    const lastUsedIdx = headers.findIndex((h) => /\blast used\b/.test(h));

    const rows = realTables.length > 0
      ? Array.from(table.querySelectorAll('tbody tr'))
      : Array.from(table.querySelectorAll('[role="row"]')).filter(
          (r) => !r.querySelector('[role="columnheader"]')
        );
    diag.body_row_count = rows.length;

    for (const row of rows) {
      const cells = realTables.length > 0
        ? Array.from(row.querySelectorAll('td'))
        : Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"]'));
      if (cells.length === 0) { diag.rows_skipped_other++; continue; }

      const costRaw = (cells[costIdx]?.textContent || '').trim();
      if (diag.cost_samples.length < 8) diag.cost_samples.push(costRaw);
      if (!costRaw || costRaw === '—' || costRaw === '-' || costRaw === '0') {
        diag.rows_skipped_no_cost++;
        continue;
      }

      const numMatch = costRaw.match(/[\d.,]+/);
      if (!numMatch) { diag.rows_skipped_no_cost++; continue; }
      const cost_usd = parseFloat(numMatch[0].replace(',', '.'));
      if (!isFinite(cost_usd) || cost_usd < 0) { diag.rows_skipped_other++; continue; }

      const keyCell = keyIdx >= 0 ? cells[keyIdx] : cells[0];
      const keyText = (keyCell?.textContent || '').trim();
      const skIdx = keyText.indexOf('sk-ant-');
      const key_name = skIdx > 0 ? keyText.substring(0, skIdx).trim() : keyText.trim() || null;
      const masked = skIdx >= 0 ? keyText.substring(skIdx).trim() : '';
      const key_id_suffix = masked.length >= 4 ? masked.slice(-4) : null;

      const workspace = workspaceIdx >= 0
        ? (cells[workspaceIdx]?.textContent || '').trim().split('\n')[0].trim() || null
        : null;
      const last_used = lastUsedIdx >= 0
        ? (cells[lastUsedIdx]?.textContent || '').trim() || null
        : null;

      diag.rows.push({ key_name, key_id_suffix, workspace, cost_usd, last_used });
    }

    return diag;
  }
  return diag;
}

// ---------------------------------------------------------------------------
// Plan B (3rd source): platform.claude.com/claude-code
//
// The settings/keys console page reports 0 USD for claude_code_*-keys because
// their billing surfaces here instead. We post one usage record per row in
// the team table (real per-key spend + lines-of-code accepted) plus a single
// aggregate row carrying the page-level metrics (total lines accepted,
// suggestion accept rate).
// ---------------------------------------------------------------------------

async function claudeCodeSync() {
  let createdTabId = null;

  try {
    const existing = await chrome.tabs.query({ url: 'https://platform.claude.com/claude-code*' });
    let tabId;

    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: CLAUDE_CODE_USAGE_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabComplete(tab.id, 30000);
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

        // Top-level metrics — labeled exactly like in the screenshot.
        // English labels are the live ones; we don't expect German here.
        const linesMatch = text.match(/Lines of code accepted\s*\n+\s*([\d.,]+)/i);
        const total_lines_accepted = linesMatch
          ? parseInt(linesMatch[1].replace(/[.,]/g, ''), 10) || null
          : null;

        const acceptMatch = text.match(/Suggestion accept rate\s*\n+\s*([\d.,]+)\s*%/i);
        const accept_rate_pct = acceptMatch
          ? parseFloat(acceptMatch[1].replace(',', '.'))
          : null;

        // Team table — has a "Spend this month" + "Lines this month" header.
        // Walk every <table> on the page and pick the one whose <thead>
        // includes both columns.
        const tables = Array.from(document.querySelectorAll('table'));
        const rows = [];
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('thead th, thead td'))
            .map((h) => h.textContent.trim().toLowerCase());
          const memberIdx = headers.findIndex((h) => h === 'members' || h === 'member');
          const spendIdx = headers.findIndex((h) => h.startsWith('spend'));
          const linesIdx = headers.findIndex((h) => h.startsWith('lines'));
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

        return { total_lines_accepted, accept_rate_pct, rows };
      }
    });

    const data = injection?.result;
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      console.log('Claude-code-sync: no rows scraped, skipping');
      return { skipped: true, reason: 'no_rows' };
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

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Alarms (replace setInterval — service workers can be terminated; alarms wake
// them back up reliably).
// ---------------------------------------------------------------------------

function ensureAlarms() {
  chrome.alarms.create(AUTO_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: AUTO_SYNC_INTERVAL_MIN
  });
  chrome.alarms.create(CONSOLE_SYNC_ALARM, {
    // Run once a few minutes after startup so we have at least one snapshot
    // even on fresh installs, then settle into the daily cadence.
    delayInMinutes: 3,
    periodInMinutes: CONSOLE_SYNC_INTERVAL_MIN
  });
  chrome.alarms.create(CLAUDE_CODE_SYNC_ALARM, {
    // Stagger the second daily scrape by a few minutes so we don't open
    // two background tabs in the same second on cold start.
    delayInMinutes: 5,
    periodInMinutes: CLAUDE_CODE_SYNC_INTERVAL_MIN
  });
  chrome.alarms.create('retry-queue', { delayInMinutes: 1, periodInMinutes: 5 });
  chrome.alarms.create('refresh-badge', { delayInMinutes: 1, periodInMinutes: 3 });
}

chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM) {
    autoSync();
  } else if (alarm.name === CONSOLE_SYNC_ALARM) {
    consoleSync();
  } else if (alarm.name === CLAUDE_CODE_SYNC_ALARM) {
    claudeCodeSync();
  } else if (alarm.name === 'retry-queue') {
    retryQueuedData();
  } else if (alarm.name === 'refresh-badge') {
    updateBadge();
  }
});

// Initial badge update so the badge isn't blank right after install / reload
updateBadge();
