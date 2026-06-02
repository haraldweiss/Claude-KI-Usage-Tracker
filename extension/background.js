// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Default API base for a fresh install. Users running the backend on a VPS
// override this from the popup via chrome.storage.local.api_base. Every
// fetch resolves the URL fresh so a settings change takes effect on the
// next call without reloading the extension.
const DEFAULT_API_BASE = 'https://claudetracker.wolfinisoftware.de/api';
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
// Anthropic redirects console.anthropic.com/settings/keys → platform.claude.com,
// so we go straight there. Old console.anthropic.com host_permission stays as
// a fallback in case Anthropic flips the redirect back.
const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys';
const WORKSPACE_KEYS_PREFIX = 'https://platform.claude.com/settings/workspaces/';
// Re-run workspace discovery (click through switcher) at most once a week.
// Daily sync uses the cached list of workspace IDs so we don't pay the
// click-simulation cost every day.
const WORKSPACE_DISCOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function workspaceKeysUrl(workspaceId) {
  return `${WORKSPACE_KEYS_PREFIX}${workspaceId}/keys`;
}

function extractWorkspaceId(url) {
  if (!url) return null;
  const m = url.match(/\/workspaces\/(wrkspc_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// Claude Code has its own usage page that reports per-key spend and lines-of-
// code metrics. The settings/keys page reports 0 USD for claude_code_*-keys
// because their billing flows through this surface instead.
const CLAUDE_CODE_SYNC_ALARM = 'auto-sync-claude-code';
const CLAUDE_CODE_SYNC_INTERVAL_MIN = 24 * 60;
const CLAUDE_CODE_USAGE_URL = 'https://platform.claude.com/claude-code';

// OpenCode Go — scrapes the workspace usage page to capture subscription plan
// name, usage percentages (continuous, weekly, monthly), and reset timers.
const OPENCODE_GO_SYNC_ALARM = 'auto-sync-opencode-go';
const OPENCODE_GO_SYNC_INTERVAL_MIN = 24 * 60;
const OPENCODE_GO_WORKSPACE_URL = 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go';

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

  if (message.type === 'TRIGGER_OPENCODE_GO_SYNC') {
    opencodeGoSync()
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
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
    { type: 'opencode_go', label: 'OpenCode Go', fn: opencodeGoSync },
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

// Stable string of the headline figures, used to detect whether values
// actually changed between two syncs. scraped_at is excluded on purpose —
// it changes every run and would mask a no-op data plateau.
const AUTO_SYNC_SIGNATURE_FIELDS = [
  'weekly_all_models_pct',
  'weekly_sonnet_pct',
  'session_pct',
  'spent_eur',
  'spent_pct',
  'balance_eur'
];
function autoSyncSignature(d) {
  return AUTO_SYNC_SIGNATURE_FIELDS.map((f) => `${f}=${d?.[f] ?? ''}`).join('|');
}

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
      await sleep(4000);
    }

    // Inject the scrape function directly via scripting API instead of relying
    // on the content script's message listener. This works even if the tab was
    // open before the extension was reloaded (where the content script would
    // be stale or absent and chrome.tabs.sendMessage fails with
    // "Receiving end does not exist").
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body.innerText || '';

        const numAfter = (regex) => {
          const m = text.match(regex);
          if (!m) return null;
          const cleaned = m[1].replace(/\s/g, '').replace(',', '.');
          const n = parseFloat(cleaned);
          return isFinite(n) ? n : null;
        };

        // Plan name: appears near top of page, just after "Plan-Nutzungslimits"
        // (or "Plan usage limits" in English). The plan label is the next
        // non-empty line.
        let plan_name = null;
        const planLabelMatch = text.match(/Plan-Nutzungslimits\s*\n+\s*([^\n]+)/i)
          || text.match(/Plan usage limits\s*\n+\s*([^\n]+)/i);
        if (planLabelMatch) {
          const candidate = planLabelMatch[1].trim();
          if (candidate.length < 80) plan_name = candidate;
        }

        // Extract percentage and optional reset text around a section label.
        // The current layout puts the reset BETWEEN the label and the
        // percentage, older layouts put it AFTER or BEFORE. Search inside the
        // match body first, then after, then before. Accept "Zurücksetzung"
        // (with or without "in", e.g. "Zurücksetzung in 5 Min." or
        // "Zurücksetzung Do., 00:00") alongside "Reset" / "Reset in".
        const extractPctAndReset = (labels) => {
          for (const label of labels) {
            const pctRe = new RegExp(`${label}[\\s\\S]{0,200}?(\\d+)\\s*%`, 'i');
            const pctMatch = text.match(pctRe);
            if (!pctMatch) continue;
            const pct = parseInt(pctMatch[1], 10);
            const matchEnd = (pctMatch.index ?? 0) + pctMatch[0].length;

            const resetRe = /(?:Reset(?:\s+in)?|Zurücksetzung(?:\s+in)?)\s+([^\n·•]{1,60})/i;
            // Current layout: reset BETWEEN label and percentage
            let reset = pctMatch[0].match(resetRe)?.[1]?.trim() ?? null;

            // Legacy: reset AFTER the percentage
            if (!reset) {
              const tail = text.slice(matchEnd, matchEnd + 80);
              reset = tail.match(resetRe)?.[1]?.trim() ?? null;
            }

            // Legacy: reset BEFORE the label
            if (!reset) {
              const head = text.slice(Math.max(0, (pctMatch.index ?? 0) - 120), pctMatch.index ?? 0);
              reset = head.match(resetRe)?.[1]?.trim() ?? null;
            }

            return { pct, reset };
          }
          return { pct: null, reset: null };
        };

        const session = extractPctAndReset([
          'Aktuelle Sitzung',
          'Current session'
        ]);
        const session_pct = session.pct;
        const session_reset_in = session.reset;

        // Extract the absolute session limit (e.g. "5" from "5-Stunden-Limit" or
        // "5" from "5-hour limit"). The new layout only shows "Aktuelle Sitzung"
        // without the limit value — will be null unless Anthropic brings it back.
        const session_limit_hours = (() => {
          const m = text.match(/(\d+)\s*-?(?:Stunden[- ]Limit|hour[- ]limit)/i);
          return m ? parseInt(m[1], 10) : null;
        })();

        const allModels = extractPctAndReset([
          'Wöchentlich\\s*·\\s*alle Modelle',
          'Wöchentliche\\s*Limits',
          'Weekly\\s*·\\s*all models',
          'Weekly\\s*limits',
          'Alle Modelle',
          'All models'
        ]);
        const weekly_all_models_pct = allModels.pct;
        const weekly_all_models_reset_in = allModels.reset;

        const sonnet = extractPctAndReset([
          'Nur Sonnet',
          'Sonnet only'
        ]);
        const weekly_sonnet_pct = sonnet.pct;
        const weekly_sonnet_reset_in = sonnet.reset;

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
          session_reset_in,
          session_limit_hours,
          weekly_all_models_pct,
          weekly_all_models_reset_in,
          weekly_sonnet_pct,
          weekly_sonnet_reset_in,
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

    // Track value-change history alongside the sync timestamp. The popup
    // surfaces "Werte unverändert seit X" so the user can spot the case
    // where the sync itself keeps succeeding but the scraped figures have
    // plateaued (e.g. claude.ai's settings page is cached and the numbers
    // haven't refreshed in hours).
    const sig = autoSyncSignature(data);
    const prev = await chrome.storage.local.get([
      'last_auto_sync_signature',
      'last_auto_sync_change_at'
    ]);
    const now = Date.now();
    const changed = prev.last_auto_sync_signature !== sig;
    await chrome.storage.local.set({
      last_auto_sync: now,
      last_auto_sync_signature: sig,
      last_auto_sync_change_at: changed ? now : (prev.last_auto_sync_change_at || now),
      last_auto_sync_data: data
    });
    updateBadge();
    console.log('Auto-sync ok');
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

// ---------------------------------------------------------------------------
// Workspace discovery (click-simulation on the platform.claude.com switcher).
//
// Anthropic doesn't expose a JSON endpoint for the workspaces visible to the
// logged-in user — they're rendered via React Server Components and the IDs
// only live in React closures, not the DOM. The workspace switcher dropdown
// shows the names; clicking an option navigates the tab to
// /workspaces/<id>/... which lets us read the ID off the URL.
//
// Strategy: open the keys entry page (which always lands on the active
// workspace's keys), capture that ID, then for each remaining option in the
// switcher, click → wait for URL change → capture wrkspc_ ID. Cache the
// (id, name) map for a week so we don't repeat clicking on every daily sync.
// ---------------------------------------------------------------------------

// Injected into the platform.claude.com page. Reads workspace names and IDs
// from the sidebar navigation (`<nav>` element) which contains direct links
// to each workspace's settings page: /settings/workspaces/<id>.
// Returns the visible option names + which one is selected, or an error.
async function openSwitcherAndReadOptions() {
  // Collect workspace links from the sidebar nav
  const links = document.querySelectorAll('nav a[href*="/settings/workspaces/"]');
  const seen = new Map();
  for (const a of links) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const m = href.match(/\/settings\/workspaces\/([^/]+)/);
    if (!m) continue;
    const id = m[1];
    const name = (a.textContent || '').trim();
    if (!name || seen.has(name)) continue;
    seen.set(name, id);
  }
  const options = [...seen.entries()]
    .filter(([name, id]) => name && id && !/^Workspaces?$/i.test(name))
    .map(([name, id]) => ({
      name,
      // 'default' is a reserved keyword, not a wrkspc_ ID; the active
      // workspace's real ID can be read from the URL once navigated there.
      id: id === 'default' ? null : id,
      selected: location.href.includes(`/workspaces/${id}`)
    }));
  if (options.length > 0) return { options };
  // Fallback: try the dropdown click-simulation
  return await openSwitcherByClick();
}

// Fallback: click-simulation approach used when sidebar nav links are not
// available (e.g. the page has a different layout). Tries candidate trigger
// buttons until one opens a [role=listbox] or [role=menu] dropdown with
// workspace options.
async function openSwitcherByClick() {
  const dropdownRoles = ['[role="listbox"]', '[role="menu"]'];
  function readDropdown(dd) {
    const items = [...dd.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]')]
      .filter((el) => !el.hasAttribute('data-disabled'))
      .map((el) => ({
        name: el.textContent.trim().split('\n')[0].trim(),
        selected: el.getAttribute('aria-selected') === 'true' ||
                  el.getAttribute('aria-checked') === 'true'
      }))
      .filter((o) => o.name && !/^(Alle (Workspaces|Arbeitsbereiche)|Loading|Laden)/i.test(o.name));
    return items.length > 0 ? items : null;
  }
  for (const sel of dropdownRoles) {
    const dd = document.querySelector(sel);
    if (dd) {
      const items = readDropdown(dd);
      if (items) return { options: items };
    }
  }

  const triggerSelectors = [
    '[role="combobox"]',
    'button[aria-haspopup="listbox"]',
    '[aria-haspopup="listbox"]',
    'button[aria-haspopup="menu"]',
    '[aria-haspopup="menu"]',
    'button[aria-expanded][aria-controls]'
  ];
  const candidates = [];
  for (const sel of triggerSelectors) {
    for (const c of document.querySelectorAll(sel)) {
      if (c.closest('[role="listbox"]') || c.closest('[role="menu"]')) continue;
      if (!candidates.includes(c)) candidates.push(c);
    }
  }
  if (candidates.length === 0) {
    const interactiveSample = [...document.querySelectorAll('[aria-haspopup]')]
      .slice(0, 5)
      .map((el) => `${el.tagName}[aria-haspopup="${el.getAttribute('aria-haspopup')}"]`)
      .join(', ');
    return { error: `switcher trigger not found; sample aria-haspopup: ${interactiveSample || '(none)'}` };
  }

  for (const trigger of candidates) {
    trigger.click();
    let found = false;
    for (let i = 0; i < 15; i++) {
      for (const sel of dropdownRoles) {
        const dd = document.querySelector(sel);
        if (dd && dd.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]').length > 0) {
          found = true;
          break;
        }
      }
      if (found) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (found) {
      const dd = document.querySelector(dropdownRoles[0]) || document.querySelector(dropdownRoles[1]);
      const items = readDropdown(dd);
      if (items) return { options: items };
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((r) => setTimeout(r, 200));
  }
  return { error: 'no trigger opened a workspace-switcher dropdown' };
}

// Injected: finds the workspace-switcher trigger (trying all candidates),
// opens the dropdown, then clicks the option whose first-line text matches
// `targetName`. Returns whether the click landed; the caller watches the
// tab URL for the actual ID.
async function clickOptionByName(targetName) {
  const triggerSelectors = [
    '[role="combobox"]',
    'button[aria-haspopup="listbox"]',
    '[aria-haspopup="listbox"]',
    'button[aria-haspopup="menu"]',
    '[aria-haspopup="menu"]',
    'button[aria-expanded][aria-controls]'
  ];
  const candidates = [];
  for (const sel of triggerSelectors) {
    for (const c of document.querySelectorAll(sel)) {
      if (c.closest('[role="listbox"]') || c.closest('[role="menu"]')) continue;
      if (!candidates.includes(c)) candidates.push(c);
    }
  }
  if (candidates.length === 0) return { error: 'switcher trigger not found' };

  const dropdownRoles = ['[role="listbox"]', '[role="menu"]'];
  for (const trigger of candidates) {
    trigger.click();
    let dropdown = null;
    for (let i = 0; i < 15; i++) {
      for (const sel of dropdownRoles) {
        const dd = document.querySelector(sel);
        if (dd) {
          const items = dd.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]');
          if (items.length > 0) {
            dropdown = dd;
            break;
          }
        }
      }
      if (dropdown) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!dropdown) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const items = [...dropdown.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]')];
    const target = items.find(
      (el) => !el.hasAttribute('data-disabled') &&
        el.textContent.trim().split('\n')[0].trim() === targetName
    );
    if (target) {
      target.click();
      return { clicked: true };
    }
    // Wrong dropdown — close and try next trigger
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise((r) => setTimeout(r, 200));
  }
  return { error: `option "${targetName}" not found in any dropdown` };
}

// Waits for the tab URL to differ from `oldUrl` AND for loading to complete.
async function waitForUrlChange(tabId, oldUrl, budgetMs = 15000, pollMs = 250) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.url && t.url !== oldUrl && t.status === 'complete') return t.url;
    } catch {
      return null;
    }
    await sleep(pollMs);
  }
  return null;
}

// Injected page diagnostic: returns a summary of interactive elements found
// on the platform.claude.com page to help debug missing workspace switcher.
function diagnosePage() {
  const result = { currentUrl: location.href, elements: [] };

  // Collect buttons with their attributes + visible text (max 20)
  const buttons = document.querySelectorAll('button, [role="button"]');
  let btnCount = 0;
  for (const b of buttons) {
    const text = (b.textContent || '').trim().slice(0, 80);
    if (!text) continue;
    if (btnCount++ >= 20) break;
    const attrs = {};
    for (const attr of ['aria-haspopup', 'aria-expanded', 'aria-controls', 'role', 'type']) {
      const v = b.getAttribute(attr);
      if (v) attrs[attr] = v;
    }
    result.elements.push({ tag: b.tagName, text, attrs });
  }

  // Find nav / aside / select / role=listbox elements
  for (const sel of ['nav', 'aside', 'select', '[role="listbox"]', '[role="navigation"]',
    '[role="tablist"]', '[role="tree"]', '[role="menu"]']) {
    const el = document.querySelector(sel);
    if (el) {
      const text = (el.textContent || '').trim().slice(0, 120);
      result.elements.push({ tag: el.tagName, sel, text, found: true });
    }
  }

  // Look for workspace-like links anywhere in the DOM
  const links = document.querySelectorAll('a[href*="workspace"], a[href*="wrkspc"]');
  for (const a of links) {
    result.elements.push({
      tag: 'a', href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 80)
    });
  }

  return result;
}

// Returns { workspaces: [{id, name}], errors: [...] }.
// Caller owns the tab and is responsible for closing it.
async function discoverWorkspaces(tabId) {
  const errors = [];

  // Step 1: load the entry page. It may or may not redirect from
  // /settings/keys to /settings/workspaces/<id>/keys — either is fine;
  // we just need the page fully loaded.
  await chrome.tabs.update(tabId, { url: CONSOLE_KEYS_URL });
  const settledUrl = await waitForTabReady(tabId, 30000);
  if (!settledUrl) {
    return {
      workspaces: [],
      errors: ['entry page never finished loading']
    };
  }

  // Step 2: open the switcher, read the option names + which one is selected.
  // If no switcher is rendered (e.g. user has only one workspace), fall back
  // to a synthetic single-entry list if we can extract an ID from the URL.
  const probe = await chrome.scripting.executeScript({
    target: { tabId },
    func: openSwitcherAndReadOptions
  });
  const probeResult = probe[0]?.result || {};
  if (probeResult.error || !(probeResult.options?.length)) {
    if (probeResult.error) {
      const msg = `probe: ${probeResult.error}`;
      errors.push(msg);
      console.warn(`discoverWorkspaces: ${msg}`);
    }
    // Diagnostic: dump page structure to understand the UI
    try {
      const diag = await chrome.scripting.executeScript({
        target: { tabId },
        func: diagnosePage
      });
      const info = diag[0]?.result;
      if (info) console.warn('Page diagnostic:', JSON.stringify(info));
    } catch {}
    const activeId = extractWorkspaceId(settledUrl);
    if (activeId) {
      return { workspaces: [{ id: activeId, name: 'Default' }], errors };
    }
    return { workspaces: [], errors };
  }
  const options = probeResult.options;

  // Step 3: build workspace list from nav-link IDs. Options with an `id`
  // can be used directly. Options without an id (e.g. "default" keyword or
  // click-simulation fallback) need a navigation to resolve the real ID.
  const discovered = [];
  const needsUrlResolve = [];

  // 3a — options that already have a wrkspc_ ID
  for (const opt of options) {
    if (opt.id && opt.id.startsWith('wrkspc_')) {
      discovered.push({ id: opt.id, name: opt.name });
      continue;
    }
    needsUrlResolve.push(opt);
  }

  // 3b — check if current URL already has a workspace ID for selected
  const tab = await chrome.tabs.get(tabId);
  const currentId = extractWorkspaceId(tab.url);
  if (currentId) {
    const selected = options.find((o) => o.selected);
    if (selected && !discovered.find((d) => d.name === selected.name)) {
      discovered.push({ id: currentId, name: selected.name });
      const idx = needsUrlResolve.findIndex((o) => o.name === selected.name);
      if (idx >= 0) needsUrlResolve.splice(idx, 1);
    }
  }

  // 3c — resolve remaining (e.g. "default") by navigating to their URL
  for (const opt of needsUrlResolve) {
    const wsUrl = `${WORKSPACE_KEYS_PREFIX}${opt.id || opt.name.toLowerCase()}/keys`;
    await chrome.tabs.update(tabId, { url: wsUrl });
    const resolved = await waitForUrlPrefix(tabId, WORKSPACE_KEYS_PREFIX, 15000);
    if (!resolved) {
      errors.push(`could not resolve workspace URL for "${opt.name}"`);
      continue;
    }
    const resolvedId = extractWorkspaceId(resolved);
    if (!resolvedId) {
      errors.push(`no wrkspc_ in resolved URL for "${opt.name}"`);
      continue;
    }
    discovered.push({ id: resolvedId, name: opt.name });
  }

  // 3d — navigate back to the entry page so caller can scrape it
  await chrome.tabs.update(tabId, { url: CONSOLE_KEYS_URL });
  await waitForTabReady(tabId, 15000);

  return {
    workspaces: discovered,
    errors
  };
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

  // Lenient match: lowercase substring against a list of language variants.
  // Handles English ("Cost", "Cost (USD)") and German ("Kosten",
  // "Schlüssel", "Arbeitsbereich", "Zuletzt verwendet am"), incl. sort
  // indicators and unit suffixes.
  const matchAny = (headers, needles) =>
    headers.findIndex((h) => needles.some((n) => h.includes(n)));

  for (const table of tables) {
    // Real <table>: headers from thead. ARIA: role="columnheader".
    const headerEls = realTables.length > 0
      ? table.querySelectorAll('thead th, thead td')
      : table.querySelectorAll('[role="columnheader"]');
    const headers = Array.from(headerEls).map((h) => h.textContent.trim().toLowerCase());
    diag.all_headers.push(headers);

    const costIdx = matchAny(headers, ['cost', 'kosten']);
    if (costIdx === -1) continue;
    diag.candidate_headers = headers;

    const keyIdx = matchAny(headers, ['key', 'schlüssel', 'schluessel']);
    const workspaceIdx = matchAny(headers, ['workspace', 'arbeitsbereich']);
    const lastUsedIdx = matchAny(headers, ['last used', 'zuletzt verwendet']);

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

async function opencodeGoSync() {
  let createdTabId = null;

  try {
    const existing = await chrome.tabs.query({ url: 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go*' });
    let tabId;

    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: OPENCODE_GO_WORKSPACE_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabComplete(tab.id, 30000);
    }

    // opencode.ai always bounces through auth.opencode.ai/authorize on first
    // open, even when the user is logged in. Wait for the redirect chain to
    // land back on opencode.ai before scraping; otherwise executeScript hits
    // the auth host (not in manifest) and throws. If we never get back, it's
    // an actual login expiry — skip cleanly so the log isn't spammed.
    const landedUrl = await waitForUrlPrefix(tabId, 'https://opencode.ai/', 15000, 250);
    if (!landedUrl) {
      let reason = 'unknown';
      try {
        const t = await chrome.tabs.get(tabId);
        reason = t.url?.startsWith('https://auth.opencode.ai/')
          ? 'login_required'
          : `unexpected_url: ${t.url || '(none)'}`;
      } catch {}
      await chrome.storage.local.set({
        last_opencode_go_sync: Date.now(),
        last_opencode_go_sync_status: reason
      });
      console.log('OpenCode-go-sync skipped:', reason);
      return { skipped: true, reason };
    }
    await sleep(2000); // give React a moment to render the workspace view

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body.innerText || '';

        // Extract plan name: "Du hast OpenCode Go abonniert."
        let plan_name = null;
        const planMatch = text.match(/(?:Du hast|You have)\s+(.+?)\s+(?:abonniert|subscribed)/i);
        if (planMatch) {
          const candidate = planMatch[1].trim();
          if (candidate.length < 80) plan_name = candidate;
        }

        // Helper: extract percentage and reset text around a section label.
        // The opencode.ai layout has shifted: the reset phrase can appear BEFORE
        // or AFTER the percentage, and the wording drifts between releases
        // ("Setzt zurück in", "Zurücksetzung in", "Wird zurückgesetzt in",
        // "Resets in", …). Match all known variants and search both directions,
        // mirroring the claude.ai scraper above.
        const resetRe = /(?:Setzt\s+zur(?:ück)?(?:\s+in)?|Zurücksetzung(?:\s+in)?|Wird\s+zurückgesetzt(?:\s+in)?|Resets?(?:\s+in)?|Endet\s+in)\s+([^\n·•]{1,60})/i;
        const extractPctAndReset = (labels) => {
          for (const label of labels) {
            const pctRe = new RegExp(`${label}[\\s\\S]{0,200}?(\\d+)\\s*%`, 'i');
            const pctMatch = text.match(pctRe);
            if (!pctMatch) continue;
            const pct = parseInt(pctMatch[1], 10);
            const matchEnd = (pctMatch.index ?? 0) + pctMatch[0].length;

            // Current layout puts the reset phrase BETWEEN the section label
            // and the percentage — search inside the matched body first.
            let reset = pctMatch[0].match(resetRe)?.[1]?.trim() ?? null;

            // Legacy layout puts the reset AFTER the percentage — fall back
            // to scanning a window after the match.
            if (!reset) {
              const tail = text.slice(matchEnd, matchEnd + 200);
              reset = tail.match(resetRe)?.[1]?.trim() ?? null;
            }

            return { pct, reset };
          }
          return { pct: null, reset: null };
        };

        // Continuous / weekly / monthly usage. opencode.ai shortened the
        // section labels from "Fortlaufende Nutzung" → "Fortlaufend" etc.
        // The short forms appear directly above the percentage card, so we
        // prefer them; the negative lookahead `(?![a-zäöüß])` keeps
        // "Fortlaufend" from greedily matching "Fortlaufende" in older
        // layouts. The full labels stay as a safety fallback.
        const continuous = extractPctAndReset([
          'Fortlaufend(?![a-zäöüß])',
          'Continuous(?![a-z])',
          'Fortlaufende Nutzung',
          'Continuous usage'
        ]);
        const continuous_pct = continuous.pct;
        const continuous_reset_in = continuous.reset;

        const weekly = extractPctAndReset([
          'Wöchentlich(?![a-zäöüß])',
          'Weekly(?![a-z])',
          'Wöchentliche Nutzung',
          'Weekly usage'
        ]);
        const weekly_pct = weekly.pct;
        const weekly_reset_in = weekly.reset;

        const monthly = extractPctAndReset([
          'Monatlich(?![a-zäöüß])',
          'Monthly(?![a-z])',
          'Monatliche Nutzung',
          'Monthly usage'
        ]);
        const monthly_pct = monthly.pct;
        const monthly_reset_in = monthly.reset;

        return {
          plan_name,
          continuous_pct,
          continuous_reset_in,
          weekly_pct,
          weekly_reset_in,
          monthly_pct,
          monthly_reset_in,
          scraped_at: new Date().toISOString()
        };
      }
    });

    const data = injection?.result;
    if (!data) {
      throw new Error('OpenCode Go scrape returned no result');
    }
    if (data.continuous_pct == null && data.weekly_pct == null && data.monthly_pct == null) {
      console.log('OpenCode-go-sync: page returned no usage figures, skipping POST');
      return { skipped: true, reason: 'no_data' };
    }

    const apiBase = await getApiBase();
    const backendResponse = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'OpenCode Go (Sync)',
        input_tokens: 0,
        output_tokens: 0,
        conversation_id: `opencode-go-sync-${Date.now()}`,
        source: 'opencode_go_sync',
        response_metadata: data
      })
    });

    if (!backendResponse.ok) {
      throw new Error('Backend rejected opencode-go-sync: ' + backendResponse.status);
    }

    await chrome.storage.local.set({
      last_opencode_go_sync: Date.now(),
      last_opencode_go_sync_data: data,
      last_opencode_go_sync_status: 'ok'
    });

    console.log('OpenCode-go-sync ok:', data);
    return { success: true, data };
  } catch (error) {
    console.error('OpenCode-go-sync error:', error);
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

// Polls a tab until its URL starts with `prefix` AND it's done loading, or
// until the budget expires. Needed for sites that OAuth-bounce through a
// foreign auth domain on first open (opencode.ai → auth.opencode.ai →
// callback → workspace). waitForTabComplete alone resolves at the FIRST
// 'complete' event, which can be the auth-host intermediate state; trying
// to executeScript there throws "manifest must request permission".
// Returns the final URL on success, null on timeout.
async function waitForUrlPrefix(tabId, prefix, budgetMs = 15000, pollMs = 250) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.url?.startsWith(prefix) && t.status === 'complete') return t.url;
    } catch {
      return null;
    }
    await sleep(pollMs);
  }
  return null;
}

// Like waitForUrlPrefix but accepts ANY URL as long as the tab is complete.
async function waitForTabReady(tabId, budgetMs = 30000, pollMs = 250) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.url && t.status === 'complete') return t.url;
    } catch {
      return null;
    }
    await sleep(pollMs);
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Alarms (replace setInterval — service workers can be terminated; alarms wake
// them back up reliably).
// ---------------------------------------------------------------------------

// Idempotent: only creates alarms that don't already exist. Safe to call on
// every service-worker wakeup — existing alarms keep their schedule instead
// of being reset, so the period actually elapses and the alarm fires.
async function ensureAlarms() {
  const existing = await chrome.alarms.getAll();
  const have = new Set(existing.map((a) => a.name));

  if (!have.has(AUTO_SYNC_ALARM)) {
    chrome.alarms.create(AUTO_SYNC_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: AUTO_SYNC_INTERVAL_MIN
    });
  }
  if (!have.has(CONSOLE_SYNC_ALARM)) {
    // Run once a few minutes after startup so we have at least one snapshot
    // even on fresh installs, then settle into the daily cadence.
    chrome.alarms.create(CONSOLE_SYNC_ALARM, {
      delayInMinutes: 3,
      periodInMinutes: CONSOLE_SYNC_INTERVAL_MIN
    });
  }
  if (!have.has(CLAUDE_CODE_SYNC_ALARM)) {
    // Stagger the second daily scrape by a few minutes so we don't open
    // two background tabs in the same second on cold start.
    chrome.alarms.create(CLAUDE_CODE_SYNC_ALARM, {
      delayInMinutes: 5,
      periodInMinutes: CLAUDE_CODE_SYNC_INTERVAL_MIN
    });
  }
  if (!have.has(OPENCODE_GO_SYNC_ALARM)) {
    // Stagger a few minutes after the other daily scrapes to spread
    // hidden-tab-open load across the startup window.
    chrome.alarms.create(OPENCODE_GO_SYNC_ALARM, {
      delayInMinutes: 7,
      periodInMinutes: OPENCODE_GO_SYNC_INTERVAL_MIN
    });
  }
  if (!have.has('retry-queue')) {
    chrome.alarms.create('retry-queue', { delayInMinutes: 1, periodInMinutes: 5 });
  }
  if (!have.has('refresh-badge')) {
    chrome.alarms.create('refresh-badge', { delayInMinutes: 1, periodInMinutes: 3 });
  }
}

chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);

// Defensive: also re-register on every service-worker wakeup. If Chrome ever
// loses the alarms (rare MV3 edge case observed in the wild), neither
// onInstalled nor onStartup will fire to restore them — the SW just sits
// there with no schedule. Calling ensureAlarms() at top level closes that
// hole; the getAll() check inside keeps it idempotent.
ensureAlarms();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM) {
    autoSync();
  } else if (alarm.name === CONSOLE_SYNC_ALARM) {
    consoleSync();
  } else if (alarm.name === CLAUDE_CODE_SYNC_ALARM) {
    claudeCodeSync();
  } else if (alarm.name === OPENCODE_GO_SYNC_ALARM) {
    opencodeGoSync();
  } else if (alarm.name === 'retry-queue') {
    retryQueuedData();
  } else if (alarm.name === 'refresh-badge') {
    updateBadge();
  }
});

// Initial badge update so the badge isn't blank right after install / reload
updateBadge();
