// © 2026 Harald Weiss
// KI Usage Tracker — Viewer-only popup.
// Scraping runs server-side via Playwright (server-scraper/).
// This popup just displays data fetched from the backend.

const DEFAULT_API_BASE = 'https://claudetracker.wolfinisoftware.de/api';
const DEFAULT_DASHBOARD_URL = 'https://claudetracker.wolfinisoftware.de';

document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  await loadStats();

  document.getElementById('refresh-btn').addEventListener('click', loadStats);
  document.getElementById('export-cookies-btn').addEventListener('click', exportCookiesToServer);
  document.getElementById('hard-sync-btn').addEventListener('click', syncHardSources);
  document.getElementById('open-dashboard').addEventListener('click', async () => {
    const { dashboard_url } = await chrome.storage.local.get('dashboard_url');
    chrome.tabs.create({ url: dashboard_url || DEFAULT_DASHBOARD_URL });
  });
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-reset').addEventListener('click', resetSettings);
  document.getElementById('open-token-page').addEventListener('click', async () => {
    const { dashboard_url } = await chrome.storage.local.get('dashboard_url');
    chrome.tabs.create({ url: (dashboard_url || DEFAULT_DASHBOARD_URL) + '/settings' });
  });
});

async function initSettings() {
  const stored = await chrome.storage.local.get(['api_base', 'dashboard_url', 'api_token', 'webhook_url']);
  document.getElementById('api-base-input').value = stored.api_base || DEFAULT_API_BASE;
  document.getElementById('dashboard-url-input').value = stored.dashboard_url || DEFAULT_DASHBOARD_URL;
  document.getElementById('api-token-input').value = stored.api_token || '';
  document.getElementById('webhook-url-input').value = stored.webhook_url || '';

  const footerEl = document.getElementById('footer-api-base');
  if (footerEl) {
    try { footerEl.textContent = new URL(stored.api_base || DEFAULT_API_BASE).host; } catch { footerEl.textContent = stored.api_base || DEFAULT_API_BASE; }
  }
}

async function saveSettings() {
  const apiBase = document.getElementById('api-base-input').value.trim();
  const dashboardUrl = document.getElementById('dashboard-url-input').value.trim();
  const apiToken = document.getElementById('api-token-input').value.trim();
  const webhookUrl = document.getElementById('webhook-url-input').value.trim();
  const status = document.getElementById('settings-status');

  if (!apiBase || !dashboardUrl) {
    status.textContent = '⚠️ Backend- und Dashboard-URL müssen ausgefüllt sein';
    status.style.color = '#c33'; return;
  }
  await chrome.storage.local.set({
    api_base: apiBase.replace(/\/+$/, ''),
    dashboard_url: dashboardUrl.replace(/\/+$/, ''),
    api_token: apiToken,
    webhook_url: webhookUrl || undefined,
  });
  status.textContent = '✅ Gespeichert.';
  status.style.color = '#3a3';
  await initSettings();
}

async function resetSettings() {
  await chrome.storage.local.remove(['api_base', 'dashboard_url', 'api_token', 'webhook_url']);
  await initSettings();
  document.getElementById('settings-status').textContent = 'Auf Standard zurückgesetzt.';
}

async function loadStats() {
  const loadingEl = document.getElementById('loading');
  const statsContainer = document.getElementById('stats-container');
  const errorContainer = document.getElementById('error-container');
  loadingEl.style.display = 'block';
  statsContainer.style.display = 'none';
  errorContainer.innerHTML = '';

  try {
    const stats = await fetchMonthlyStats();
    if (stats) {
      displayStats(stats);
      loadingEl.style.display = 'none';
      statsContainer.style.display = 'block';
    } else {
      showError('Backend nicht erreichbar. Prüfe Backend-URL & Auth in den Einstellungen.');
    }
  } catch (err) {
    showError(err.message);
  }
}

async function fetchMonthlyStats() {
  const { api_base, api_token } = await chrome.storage.local.get(['api_base', 'api_token']);
  const baseUrl = (api_base || DEFAULT_API_BASE).replace(/\/+$/, '');
  const headers = {};
  if (api_token) headers['Authorization'] = `Bearer ${api_token}`;

  const response = await fetch(`${baseUrl}/usage/summary?period=month`, { headers });
  if (!response.ok) return null;
  return response.json();
}

function displayStats(stats) {
  const cg = stats?.combined;
  if (!cg) { showError('Keine Daten vom Backend.'); return; }

  // Grand total: cost_eur from combined sources + flat plan fees
  const caTotal = Number(cg?.claude_ai?.cost_eur ?? cg?.claude_ai?.total_eur ?? 0);
  const anthropicApiEur = Number(cg?.anthropic_api?.cost_eur_equivalent ?? 0);
  const opencodeApiEur = Number(cg?.opencode_api?.total_eur ?? 0);
  const codexEur = Number(cg?.codex?.plan_cost_eur ?? cg?.codex?.total_eur ?? 0);
  const openaiApiEur = Number(cg?.openai_api?.cost_usd ?? 0) * 0.92;
  const opencodeGoEur = (cg?.opencode_go?.plan_name === 'OpenCode Go') ? 20 : 10;
  const zaiEur = 15;

  const grandTotal = caTotal + anthropicApiEur + opencodeApiEur + codexEur + openaiApiEur + opencodeGoEur + zaiEur;
  document.getElementById('grand-total').textContent = formatEur(grandTotal);

  // Helper to show/hide rows
  const showRow = (id, elId, content) => {
    const row = document.getElementById(id);
    const el = document.getElementById(elId);
    if (!row || !el) return;
    if (content) {
      row.style.display = '';
      el.textContent = content;
      el.classList.remove('warning');
    } else {
      row.style.display = 'none';
    }
  };

  // Claude.ai
  const ca = cg?.claude_ai;
  if (ca && ca.meta) {
    const monthlyEur = Number(ca.meta.spending_eur ?? ca.cost_eur ?? 0);
    const parts = [];
    if (Number.isFinite(monthlyEur) && monthlyEur > 0) parts.push(formatEur(monthlyEur));
    const sessionPct = Number(ca.meta.session_pct);
    const weeklyPct = Number(ca.meta.weekly_pct);
    if (Number.isFinite(sessionPct)) parts.push(`S ${sessionPct}%`);
    if (Number.isFinite(weeklyPct)) parts.push(`W ${weeklyPct}%`);
    showRow('claude-ai-row', 'claude-ai-summary', parts.length > 0 ? parts.join(' · ') : 'aktiv');
  } else if (ca && ca.cost_eur) {
    showRow('claude-ai-row', 'claude-ai-summary', formatEur(ca.cost_eur));
  } else {
    showRow('claude-ai-row', 'claude-ai-summary', null);
  }

  // Anthropic Console
  const ap = cg?.anthropic_api;
  if (ap) {
    const costEur = Number(ap.cost_eur_equivalent ?? 0);
    const keyCount = ap.by_workspace?.length || 0;
    const costPart = Number.isFinite(costEur) && costEur > 0 ? formatEur(costEur) : '€0.00';
    showRow('anthropic-api-row', 'anthropic-api-summary', costPart + (keyCount > 0 ? ` · ${keyCount} Keys` : ''));
  } else {
    showRow('anthropic-api-row', 'anthropic-api-summary', null);
  }

  // Claude Code
  showRow('claude-code-row', 'claude-code-summary',
    cg?.claude_code ? `${cg.claude_code.length} Keys` : null);

  // OpenCode Go
  const og = cg?.opencode_go;
  if (og) {
    const parts = [];
    let maxPct = 0;
    if (typeof og.continuous_pct === 'number') { parts.push(`F ${og.continuous_pct}%`); maxPct = Math.max(maxPct, og.continuous_pct); }
    if (typeof og.weekly_pct === 'number') { parts.push(`W ${og.weekly_pct}%`); maxPct = Math.max(maxPct, og.weekly_pct); }
    if (typeof og.monthly_pct === 'number') { parts.push(`M ${og.monthly_pct}%`); maxPct = Math.max(maxPct, og.monthly_pct); }
    const text = parts.length > 0 ? parts.join(' · ') : (og.plan_name || 'aktiv');
    showRow('opencode-row', 'opencode-go-summary', text);
    const el = document.getElementById('opencode-go-summary');
    if (el) el.classList.toggle('warning', maxPct >= 90);
  } else {
    showRow('opencode-row', 'opencode-go-summary', null);
  }

  // z.ai
  const zai = cg?.zai;
  if (zai) {
    const parts = [];
    let maxPct = 0;
    if (typeof zai.five_hour_pct === 'number') { parts.push(`5h ${zai.five_hour_pct}%`); maxPct = Math.max(maxPct, zai.five_hour_pct); }
    if (typeof zai.weekly_pct === 'number') { parts.push(`W ${zai.weekly_pct}%`); maxPct = Math.max(maxPct, zai.weekly_pct); }
    if (typeof zai.monthly_pct === 'number') { parts.push(`M ${zai.monthly_pct}%`); maxPct = Math.max(maxPct, zai.monthly_pct); }
    const text = parts.length > 0 ? parts.join(' · ') : (zai.plan_name || 'aktiv');
    showRow('zai-row', 'zai-summary', text);
    const el = document.getElementById('zai-summary');
    if (el) el.classList.toggle('warning', maxPct >= 90);
  } else {
    showRow('zai-row', 'zai-summary', null);
  }

  // OpenCode API
  const oa = cg?.opencode_api;
  if (oa) {
    const inK = Math.round((oa.total_input_tokens || 0) / 1000);
    const outK = Math.round((oa.total_output_tokens || 0) / 1000);
    const costStr = oa.total_cost_usd > 0 ? '$' + oa.total_cost_usd.toFixed(2) : '' + (inK + outK) + 'K Tokens';
    const keyCount = oa.by_key?.length || 0;
    showRow('opencode-api-row', 'opencode-api-summary',
      keyCount > 0 ? costStr + ' · ' + keyCount + ' Keys' : costStr);
  } else {
    showRow('opencode-api-row', 'opencode-api-summary', null);
  }

  // Codex
  const cx = cg?.codex;
  if (cx) {
    const fiveHour = Number(cx.five_hour_remaining_pct);
    const weekly = Number(cx.weekly_remaining_pct);
    const parts = [];
    if (Number.isFinite(fiveHour)) parts.push('5h ' + fiveHour + '% frei');
    if (Number.isFinite(weekly)) parts.push('Woche ' + weekly + '% frei');
    const text = parts.length > 0 ? parts.join(' · ') : 'aktiv';
    showRow('codex-row', 'codex-summary', text);
    const el = document.getElementById('codex-summary');
    const minRemaining = Math.min(Number.isFinite(fiveHour) ? fiveHour : 100, Number.isFinite(weekly) ? weekly : 100);
    if (el) el.classList.toggle('warning', minRemaining < 20);
  } else {
    showRow('codex-row', 'codex-summary', null);
  }

  // OpenAI API
  const oi = cg?.openai_api;
  if (oi) {
    const cost = Number(oi.cost_usd);
    const input = Number(oi.total_input_tokens || oi.input_tokens);
    const output = Number(oi.total_output_tokens || oi.output_tokens);
    const requests = Number(oi.requests);
    const costPart = Number.isFinite(cost) ? '$' + cost.toFixed(2) + ' MTD' : '$0.00 MTD';
    const tokensPart = (Number.isFinite(input) || Number.isFinite(output))
      ? formatNumber((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)) + ' Tokens'
      : '';
    const reqPart = Number.isFinite(requests) ? requests + ' Requests' : '';
    showRow('openai-api-row', 'openai-api-summary', [costPart, tokensPart, reqPart].filter(Boolean).join(' · '));
  } else {
    showRow('openai-api-row', 'openai-api-summary', null);
  }

  // Sync timestamp from backend (if available)
  const lastSyncEl = document.getElementById('last-sync-time');
  if (lastSyncEl && stats.last_scrape_at) {
    lastSyncEl.textContent = new Date(stats.last_scrape_at).toLocaleString('de-DE');
  } else if (lastSyncEl) {
    lastSyncEl.textContent = '—';
  }
}

function showError(message) {
  const errorContainer = document.getElementById('error-container');
  errorContainer.replaceChildren();
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = message;
  errorContainer.appendChild(div);
  document.getElementById('loading').style.display = 'none';
  document.getElementById('stats-container').style.display = 'none';
}

function formatEur(value) {
  if (value === null || value === undefined || !isFinite(value)) return '0,00 €';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatNumber(num) {
  if (!Number.isFinite(Number(num))) return '0';
  num = Number(num);
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Trigger sync of the 4 sources that need httponly cookies (macOS Keychain).
 */
async function syncHardSources() {
  const btn = document.getElementById('hard-sync-btn');
  const status = document.getElementById('hard-sync-status');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Sync läuft...';
  btn.disabled = true;
  status.textContent = 'Öffne Tabs...';

  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout nach 120s')), 120000);
      chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC_HARD_SOURCES' }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });

    if (result?.results) {
      const ok = result.results.filter(r => r.ok).length;
      const fail = result.results.filter(r => !r.ok).length;
      const details = result.results.map(r => `${r.source}: ${r.ok ? '✅' : '❌'}`).join(' · ');
      status.textContent = `${ok} ok, ${fail} fehlgeschlagen — ${details}`;
      btn.textContent = '✅ Sync fertig';
    } else {
      status.textContent = '❌ Keine Ergebnisse';
      btn.textContent = originalText;
    }
  } catch (err) {
    status.textContent = '❌ ' + err.message;
    btn.textContent = originalText;
  }
  setTimeout(() => {
    btn.textContent = originalText;
    btn.disabled = false;
    // Auto-refresh stats
    loadStats();
  }, 5000);
}

/**
 * Read cookies from Chrome and trigger a file download.
 * The file is saved locally, then we rsync to the server.
 */
async function exportCookiesToServer() {
  const btn = document.getElementById('export-cookies-btn');
  const originalText = btn.textContent;
  btn.textContent = '⏳ Lese Cookies…';
  btn.disabled = true;

  try {
    // Must use sendMessage to background.js — chrome.cookies.getAll is
    // unreliable in the popup context. Background.js has the getAllCookies()
    // function with a 10s timeout.
    const cookies = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 10000);
      chrome.runtime.sendMessage({ type: 'GET_COOKIES' }, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });

    if (!cookies || cookies.length === 0) {
      btn.textContent = '❌ Keine Cookies — SW-Console prüfen';
      // Also try to get debug info from background
      chrome.runtime.sendMessage({ type: 'DEBUG_COOKIES' });
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
      return;
    }

    const json = JSON.stringify(cookies, null, 2);

    // Trigger download
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playwright-cookies-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    // Also trigger upload to server-scraper
    chrome.runtime.sendMessage({ type: 'EXPORT_COOKIES_NOW' }, (resp) => {
      if (resp?.ok) console.log('[popup] cookies uploaded to server');
    });

    btn.textContent = `✅ ${cookies.length} Cookies → Download + Upload`;
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
  } catch (err) {
    btn.textContent = `❌ ${err.message}`;
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
  }
}
