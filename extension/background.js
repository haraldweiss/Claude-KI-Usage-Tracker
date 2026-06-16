// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss

// ── Module imports (MV3 service worker: importScripts shares global scope) ──
importScripts(
  'background-utils.js',
  'background-scraper-claude.js',
  'background-scraper-console.js',
  'background-scraper-claude-code.js',
  'background-scraper-opencode.js',
  'background-scraper-zai.js'
);

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
// claude.ai/settings/usage still works in normal browser tabs.
// Extension tabs redirect to platform.claude.com, so we try both.
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
const DEFAULT_OPENCODE_GO_URL = 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go';

async function getOpenCodeGoUrl() {
  try {
    const stored = await chrome.storage.local.get('opencode_go_url');
    if (typeof stored.opencode_go_url === 'string' && stored.opencode_go_url.length > 0) {
      return stored.opencode_go_url;
    }
  } catch { /* fall through */ }
  return DEFAULT_OPENCODE_GO_URL;
}

// z.ai GLM Coding Plan — scrapes the my-plan + usage console pages for the
// subscription price and the 5h / weekly / monthly quota percentages. Daily
// cadence: the figures lag by ~10 min and don't change minute-to-minute.
const ZAI_SYNC_ALARM = 'auto-sync-zai';
const ZAI_SYNC_INTERVAL_MIN = 24 * 60;

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

  if (message.type === 'TRIGGER_ZAI_SYNC') {
    zaiSync()
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
    { type: 'zai', label: 'z.ai', fn: zaiSync },
  ];

  const stepResults = [];
  for (const step of steps) {
    let outcome;
    try {
      const result = await step.fn();
      if (result?.success) outcome = { label: step.label, status: 'ok' };
      else if (result?.skipped) outcome = { label: step.label, status: 'skipped', message: result?.reason || 'nichts zu syncen', url: result?.url, preview: result?.preview };
      else outcome = { label: step.label, status: 'error', message: result?.error || 'unbekannt' };
    } catch (err) {
      outcome = { label: step.label, status: 'error', message: err?.message || String(err) };
    }
    stepResults.push(outcome);
    await chrome.storage.local.set({
      last_sync_all: { status: 'running', startedAt, steps: stepResults }
    });
  }

  await cleanupAllTabs();

  await chrome.storage.local.set({
    last_sync_all: { status: 'done', startedAt, finishedAt: Date.now(), steps: stepResults }
  });

  // Check usage thresholds after sync completes
  checkUsageThresholds();
}

// ---------------------------------------------------------------------------
// Usage threshold monitoring
// ---------------------------------------------------------------------------

const THRESHOLD_PCT = 90;
const THRESHOLD_ALERTS_KEY = 'threshold_alerts';

// Called after syncAll and periodically by alarm. Fetches current usage from
// the backend, checks every pct field against THRESHOLD_PCT, updates the
// extension badge (count of sources over threshold), shows a Chrome
// notification on newly crossed thresholds, and fires a webhook if configured.
async function checkUsageThresholds() {
  const stats = await getMonthlyStats();
  if (!stats?.combined) return;

  const { combined } = stats;
  const alerts = [];

  // Claude.ai
  const meta = combined.claude_ai?.meta;
  if (meta) {
    if (typeof meta.session_pct === 'number')
      alerts.push({ source: 'claude_ai_session', label: 'Claude.ai Sitzung', pct: meta.session_pct });
    if (typeof meta.weekly_all_models_pct === 'number')
      alerts.push({ source: 'claude_ai_weekly', label: 'Claude.ai Wochenlimit', pct: meta.weekly_all_models_pct });
  }

  // OpenCode Go
  const og = combined.opencode_go;
  if (og) {
    if (typeof og.continuous_pct === 'number')
      alerts.push({ source: 'opencode_go_continuous', label: 'OpenCode Go Fortlaufend', pct: og.continuous_pct });
    if (typeof og.weekly_pct === 'number')
      alerts.push({ source: 'opencode_go_weekly', label: 'OpenCode Go Wöchentlich', pct: og.weekly_pct });
    if (typeof og.monthly_pct === 'number')
      alerts.push({ source: 'opencode_go_monthly', label: 'OpenCode Go Monatlich', pct: og.monthly_pct });
  }

  // z.ai
  const z = combined.zai;
  if (z) {
    if (typeof z.five_hour_pct === 'number')
      alerts.push({ source: 'zai_5h', label: 'z.ai 5h-Limit', pct: z.five_hour_pct });
    if (typeof z.weekly_pct === 'number')
      alerts.push({ source: 'zai_weekly', label: 'z.ai Wöchentlich', pct: z.weekly_pct });
    if (typeof z.monthly_pct === 'number')
      alerts.push({ source: 'zai_monthly', label: 'z.ai Monatlich', pct: z.monthly_pct });
  }

  // Fetch previously notified alerts to detect newly crossed thresholds
  const stored = await chrome.storage.local.get(THRESHOLD_ALERTS_KEY);
  const previousAlerts = stored[THRESHOLD_ALERTS_KEY] || {};
  const nowOver = {};
  const newlyCrossed = [];

  for (const a of alerts) {
    if (a.pct >= THRESHOLD_PCT) {
      nowOver[a.source] = a.pct;
      const prev = previousAlerts[a.source];
      if (typeof prev !== 'number' || prev < THRESHOLD_PCT) {
        newlyCrossed.push(a);
      }
    }
  }

  await chrome.storage.local.set({ [THRESHOLD_ALERTS_KEY]: nowOver });

  // Update badge — show count of over-threshold sources, or normal badge
  const count = Object.keys(nowOver).length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
  } else {
    updateBadge();
  }

  // Notification + webhook for newly crossed thresholds
  if (newlyCrossed.length === 0) return;

  const message = newlyCrossed.map((a) => `${a.label}: ${a.pct}%`).join('\n');
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: `⚠️ ${count} KI-Kontingent${count > 1 ? 'e' : ''} fast erschöpft`,
    message,
    priority: 2,
    silent: false,
    requireInteraction: true
  });

  const { webhook_url } = await chrome.storage.local.get('webhook_url');
  if (!webhook_url) return;

  try {
    await fetch(webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'threshold_reached',
        threshold_pct: THRESHOLD_PCT,
        crossed: newlyCrossed.map((a) => ({ source: a.source, label: a.label, pct: a.pct })),
        all_usage: alerts.map((a) => ({ source: a.source, pct: a.pct })),
        timestamp: new Date().toISOString()
      })
    });
  } catch (e) {
    console.error('Threshold webhook error:', e);
  }
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
  if (!have.has(ZAI_SYNC_ALARM)) {
    // Last of the daily scrapes; stagger another couple of minutes out.
    chrome.alarms.create(ZAI_SYNC_ALARM, {
      delayInMinutes: 9,
      periodInMinutes: ZAI_SYNC_INTERVAL_MIN
    });
  }
  if (!have.has('retry-queue')) {
    chrome.alarms.create('retry-queue', { delayInMinutes: 1, periodInMinutes: 5 });
  }
  if (!have.has('refresh-badge')) {
    chrome.alarms.create('refresh-badge', { delayInMinutes: 1, periodInMinutes: 3 });
  }
  if (!have.has('check-thresholds')) {
    chrome.alarms.create('check-thresholds', { delayInMinutes: 1, periodInMinutes: 5 });
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
  } else if (alarm.name === ZAI_SYNC_ALARM) {
    zaiSync();
  } else if (alarm.name === 'retry-queue') {
    retryQueuedData();
  } else if (alarm.name === 'refresh-badge') {
    updateBadge();
  } else if (alarm.name === 'check-thresholds') {
    checkUsageThresholds();
  }
});

// Initial badge update so the badge isn't blank right after install / reload
updateBadge();
