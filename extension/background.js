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
        const scraped = {
          monthly_spent: 0,
          weekly_used: 0,
          session_used: 0,
          timestamp: new Date().toISOString()
        };
        const allText = document.body.innerText;
        const currencyMatch = allText.match(/[\d,\.]+\s*[€$]|[€$]\s*[\d,\.]+/);
        if (currencyMatch) {
          const amount = currencyMatch[0].replace(/[€$\s]/g, '').replace(',', '.');
          scraped.monthly_spent = parseFloat(amount) || 0;
        }
        const percentMatches = allText.match(/(\d+)\s*%/g);
        if (percentMatches && percentMatches.length > 0) {
          scraped.weekly_used = parseInt(percentMatches[0], 10) || 0;
        }
        return scraped;
      }
    });

    const data = injection?.result;
    if (!data) {
      throw new Error('Scrape returned no result');
    }
    if (!data.monthly_spent && !data.weekly_used) {
      console.log('Auto-sync: page returned no usage figures, skipping POST');
      return { skipped: true, reason: 'no_data' };
    }

    const backendResponse = await fetch(`${API_BASE}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Claude (Official Sync)',
        input_tokens: Math.round((data.monthly_spent || 0) * 1000),
        output_tokens: data.weekly_used || 0,
        conversation_id: `auto-sync-${Date.now()}`,
        source: 'claude_official_sync'
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
  } else if (alarm.name === 'retry-queue') {
    retryQueuedData();
  } else if (alarm.name === 'refresh-badge') {
    updateBadge();
  }
});

// Initial badge update so the badge isn't blank right after install / reload
updateBadge();
