const API_BASE = 'http://localhost:3000/api';
const QUEUE_STORAGE_KEY = 'usage_queue';
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
});

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

    const response = await fetch(`${API_BASE}/usage/track`, {
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
    const response = await fetch(`${API_BASE}/usage/summary?period=day`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return await response.json();
  } catch (error) {
    console.error('Error getting stats:', error);
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
            for (const label of labels) {
              if (lines[i].toLowerCase() === label.toLowerCase()) {
                // Walk upwards to skip blank lines and find the nearest line
                // containing a € value.
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

    const backendResponse = await fetch(`${API_BASE}/usage/track`, {
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
      // The table is rendered after a short async hop; give it time.
      await sleep(3000);
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Walk every table on the page and pick the one with a "Cost" column.
        // Anthropic's UI uses a real <table> at the time of writing; if they
        // ever switch to a virtualized list this needs updating.
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
          const headers = Array.from(table.querySelectorAll('thead th, thead td'))
            .map((h) => h.textContent.trim().toLowerCase());
          const costIdx = headers.findIndex((h) => h === 'cost');
          if (costIdx === -1) continue;

          const keyIdx = headers.findIndex((h) => h === 'key');
          const workspaceIdx = headers.findIndex((h) => h === 'workspace');
          const lastUsedIdx = headers.findIndex((h) => h === 'last used at' || h === 'last used');

          const rows = Array.from(table.querySelectorAll('tbody tr'));
          const out = [];

          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length === 0) continue;

            const costRaw = (cells[costIdx]?.textContent || '').trim();
            // Skip keys with no usage. Anthropic uses an em-dash placeholder.
            if (!costRaw || costRaw === '—' || costRaw === '-' || costRaw === '0') continue;

            // "0,52 USD" or "0.52 USD" or "$0.52" — normalize to a Number.
            const numMatch = costRaw.match(/[\d.,]+/);
            if (!numMatch) continue;
            const cost_usd = parseFloat(numMatch[0].replace(',', '.'));
            if (!isFinite(cost_usd) || cost_usd < 0) continue;

            const keyCell = keyIdx >= 0 ? cells[keyIdx] : cells[0];
            const keyText = (keyCell?.textContent || '').trim();
            // The cell typically renders two lines: friendly name + masked id.
            // We split on whitespace runs and take the last "sk-ant-..." chunk.
            const parts = keyText.split(/\s+/).filter(Boolean);
            const masked = parts.find((p) => p.startsWith('sk-ant-')) || '';
            const key_id_suffix = masked.length >= 4 ? masked.slice(-4) : null;
            const key_name = parts.find((p) => !p.startsWith('sk-ant-')) || keyText.split(/\s/)[0] || null;

            const workspace = workspaceIdx >= 0
              ? (cells[workspaceIdx]?.textContent || '').trim().split('\n')[0].trim() || null
              : null;
            const last_used = lastUsedIdx >= 0
              ? (cells[lastUsedIdx]?.textContent || '').trim() || null
              : null;

            out.push({ key_name, key_id_suffix, workspace, cost_usd, last_used });
          }

          return { rows: out };
        }
        return { rows: [] };
      }
    });

    const data = injection?.result;
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      console.log('Console-sync: no usable rows scraped, skipping');
      return { skipped: true, reason: 'no_rows' };
    }

    // Post one record per key. The backend appends each one — diffing
    // happens at query time on the dashboard.
    let posted = 0;
    for (const row of data.rows) {
      try {
        await fetch(`${API_BASE}/usage/track`, {
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
      await sleep(3500);
    }

    const [injection] = await chrome.scripting.executeScript({
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

    let posted = 0;
    for (const row of data.rows) {
      try {
        await fetch(`${API_BASE}/usage/track`, {
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
