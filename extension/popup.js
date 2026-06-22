// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Default endpoints — used on a fresh install and when the user clicks
// "Zurücksetzen". Overrides live in chrome.storage.local under the same keys.
const DEFAULT_API_BASE = 'https://claudetracker.wolfinisoftware.de/api';
const DEFAULT_DASHBOARD_URL = 'https://claudetracker.wolfinisoftware.de';

// Load stats when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  loadStats();
  renderSyncInfo();

  // If a sync was launched in a previous popup-open and is still running
  // (or just finished), surface it.
  const { last_sync_all } = await chrome.storage.local.get('last_sync_all');
  if (last_sync_all) {
    renderLastSyncAll(last_sync_all);
    if (last_sync_all.status === 'running') {
      const syncBtn = document.getElementById('sync-btn');
      syncBtn.disabled = true;
      syncBtn.textContent = '⏳ Sync läuft…';
      pollSyncAllProgress();
    }
  }

  // Sync alle button — triggers Claude.ai, Anthropic Console, and Claude Code
  document.getElementById('sync-btn').addEventListener('click', () => {
    syncAll();
  });

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadStats();
  });

  // Dashboard button — uses the configured URL, not hardcoded localhost.
  document.getElementById('open-dashboard').addEventListener('click', async () => {
    const { dashboard_url } = await chrome.storage.local.get('dashboard_url');
    chrome.tabs.create({ url: dashboard_url || DEFAULT_DASHBOARD_URL });
  });

  // Settings save / reset
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-reset').addEventListener('click', resetSettings);

  document.getElementById('open-token-page').addEventListener('click', async () => {
    const { dashboard_url } = await chrome.storage.local.get('dashboard_url');
    const url = (dashboard_url || DEFAULT_DASHBOARD_URL) + '/settings';
    chrome.tabs.create({ url });
  });
});

async function initSettings() {
  const stored = await chrome.storage.local.get(['api_base', 'dashboard_url', 'api_token', 'webhook_url']);
  const apiBase = stored.api_base || DEFAULT_API_BASE;
  const dashboardUrl = stored.dashboard_url || DEFAULT_DASHBOARD_URL;

  document.getElementById('api-base-input').value = apiBase;
  document.getElementById('dashboard-url-input').value = dashboardUrl;
  document.getElementById('api-token-input').value = stored.api_token || '';
  document.getElementById('webhook-url-input').value = stored.webhook_url || '';

  const footerEl = document.getElementById('footer-api-base');
  if (footerEl) {
    try { footerEl.textContent = new URL(apiBase).host; } catch { footerEl.textContent = apiBase; }
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
    webhook_url: webhookUrl || undefined
  });
  await chrome.storage.local.remove(['auth_user', 'auth_pass']);  // clean up old
  status.textContent = '✅ Gespeichert.';
  status.style.color = '#3a3';
  await initSettings();
}

async function resetSettings() {
  await chrome.storage.local.remove(['api_base', 'dashboard_url', 'api_token', 'webhook_url', 'auth_user', 'auth_pass']);
  await initSettings();
  document.getElementById('settings-status').textContent = 'Auf localhost zurückgesetzt.';
}

async function loadStats() {
  const loadingEl = document.getElementById('loading');
  const statsContainer = document.getElementById('stats-container');
  const errorContainer = document.getElementById('error-container');

  try {
    chrome.runtime.sendMessage({ type: 'GET_MONTHLY_STATS' }, (stats) => {
      if (stats) {
        displayStats(stats);
        loadingEl.style.display = 'none';
        statsContainer.style.display = 'block';
        errorContainer.innerHTML = '';
      } else {
        showError('Backend nicht erreichbar. Prüfe Backend-URL & Auth in den Einstellungen.');
      }
    });

    setTimeout(() => {
      if (loadingEl.style.display !== 'none') {
        showError('Backend nicht erreichbar. Prüfe Backend-URL & Auth in den Einstellungen.');
      }
    }, 3000);
  } catch (error) {
    showError(error.message);
  }
}

function formatEur(value) {
  if (value === null || value === undefined || !isFinite(value)) return '0,00 €';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatUsd(value) {
  if (value === null || value === undefined || !isFinite(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function displayStats(stats) {
  const zai = stats?.combined?.zai;
  const opencodeGo = stats?.combined?.opencode_go;

  // Compute grand total from remaining (non-Claude) sources
  const cg = stats?.combined;
  const opencodeGoEur = (cg?.opencode_go?.plan_name === 'OpenCode Go') ? 20 : (cg?.opencode_go?.plan_name ? 10 : 0);
  const zaiEur = cg?.zai?.plan_name ? 15 : 0;
  const opencodeApiTotal = cg?.opencode_api?.total_cost_usd ?? 0;
  const openaiApiTotal = cg?.openai_api?.cost_usd ?? 0;
  const approxEur = (opencodeApiTotal + openaiApiTotal) * 0.92;
  const grandTotal = opencodeGoEur + zaiEur + approxEur;
  document.getElementById('grand-total').textContent = formatEur(grandTotal);

  // OpenCode Go — show usage as "plan: C% · W% · M%" when data exists
  const opencodeRow = document.getElementById('opencode-row');
  const opencodeEl = document.getElementById('opencode-go-summary');
  if (opencodeGo && opencodeEl) {
    opencodeRow.style.display = '';
    const parts = [];
    let maxPct = 0;
    if (typeof opencodeGo.continuous_pct === 'number') { parts.push(`F ${opencodeGo.continuous_pct}%`); maxPct = Math.max(maxPct, opencodeGo.continuous_pct); }
    if (typeof opencodeGo.weekly_pct === 'number') { parts.push(`W ${opencodeGo.weekly_pct}%`); maxPct = Math.max(maxPct, opencodeGo.weekly_pct); }
    if (typeof opencodeGo.monthly_pct === 'number') { parts.push(`M ${opencodeGo.monthly_pct}%`); maxPct = Math.max(maxPct, opencodeGo.monthly_pct); }
    opencodeEl.textContent = parts.length > 0 ? parts.join(' · ') : (opencodeGo.plan_name || 'aktiv');
    opencodeEl.classList.toggle('warning', maxPct >= 90);
  } else if (opencodeEl) {
    opencodeRow.style.display = 'none';
    opencodeEl.classList.remove('warning');
  }

  // z.ai GLM Coding Plan — show "5h% · W% · M%" when data exists
  const zaiRow = document.getElementById('zai-row');
  const zaiEl = document.getElementById('zai-summary');
  if (zai && zaiEl) {
    zaiRow.style.display = '';
    const parts = [];
    let maxPct = 0;
    if (typeof zai.five_hour_pct === 'number') { parts.push(`5h ${zai.five_hour_pct}%`); maxPct = Math.max(maxPct, zai.five_hour_pct); }
    if (typeof zai.weekly_pct === 'number') { parts.push(`W ${zai.weekly_pct}%`); maxPct = Math.max(maxPct, zai.weekly_pct); }
    if (typeof zai.monthly_pct === 'number') { parts.push(`M ${zai.monthly_pct}%`); maxPct = Math.max(maxPct, zai.monthly_pct); }
    zaiEl.textContent = parts.length > 0 ? parts.join(' · ') : (zai.plan_name || 'aktiv');
    zaiEl.classList.toggle('warning', maxPct >= 90);
  } else if (zaiEl) {
    zaiRow.style.display = 'none';
  }

  // OpenCode API usage — show token totals and key count
  const opencodeApi = stats?.combined?.opencode_api;
  const opencodeApiRow = document.getElementById('opencode-api-row');
  const opencodeApiEl = document.getElementById('opencode-api-summary');
  if (opencodeApi && opencodeApiEl) {
    opencodeApiRow.style.display = '';
    const inK = Math.round((opencodeApi.total_input_tokens || 0) / 1000);
    const outK = Math.round((opencodeApi.total_output_tokens || 0) / 1000);
    const costStr = opencodeApi.total_cost_usd > 0
      ? '$' + opencodeApi.total_cost_usd.toFixed(2)
      : '' + (inK + outK) + 'K Tokens';
    const keyCount = opencodeApi.by_key?.length || 0;
    opencodeApiEl.textContent = keyCount > 0
      ? costStr + ' · ' + keyCount + ' Keys'
      : costStr;
    opencodeApiEl.classList.remove('warning');
  } else if (opencodeApiEl) {
    opencodeApiRow.style.display = 'none';
  }

  // Codex — show remaining capacity percentages
  const codex = stats?.combined?.codex;
  const codexRow = document.getElementById('codex-row');
  const codexEl = document.getElementById('codex-summary');
  if (codex && codexEl) {
    codexRow.style.display = '';
    const fiveHour = Number(codex.five_hour_remaining_pct);
    const weekly = Number(codex.weekly_remaining_pct);
    const parts = [];
    if (Number.isFinite(fiveHour)) parts.push('5h ' + fiveHour + '% frei');
    if (Number.isFinite(weekly)) parts.push('Woche ' + weekly + '% frei');
    codexEl.textContent = parts.length > 0 ? parts.join(' · ') : 'aktiv';
    const minRemaining = Math.min(
      Number.isFinite(fiveHour) ? fiveHour : 100,
      Number.isFinite(weekly) ? weekly : 100
    );
    codexEl.classList.toggle('warning', minRemaining < 20);
  } else if (codexEl) {
    codexRow.style.display = 'none';
    codexEl.classList.remove('warning');
  }

  // OpenAI API — show month-to-date cost and usage
  const openaiApi = stats?.combined?.openai_api;
  const openaiApiRow = document.getElementById('openai-api-row');
  const openaiApiEl = document.getElementById('openai-api-summary');
  if (openaiApi && openaiApiEl) {
    openaiApiRow.style.display = '';
    const cost = Number(openaiApi.cost_usd);
    const input = Number(openaiApi.total_input_tokens || openaiApi.input_tokens);
    const output = Number(openaiApi.total_output_tokens || openaiApi.output_tokens);
    const requests = Number(openaiApi.requests);
    const costPart = Number.isFinite(cost) ? '$' + cost.toFixed(2) + ' MTD' : '$0.00 MTD';
    const tokensPart = (Number.isFinite(input) || Number.isFinite(output))
      ? formatNumber((Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)) + ' Tokens'
      : '';
    const reqPart = Number.isFinite(requests) ? requests + ' Requests' : '';
    openaiApiEl.textContent = [costPart, tokensPart, reqPart].filter(Boolean).join(' · ');
    openaiApiEl.classList.remove('warning');
  } else if (openaiApiEl) {
    openaiApiRow.style.display = 'none';
  }
}

function showError(message, isSuccess = false) {
  const errorContainer = document.getElementById('error-container');
  const bgColor = isSuccess ? '#efe' : '#fee';
  const borderColor = isSuccess ? '#4c4' : '#f44';
  const textColor = isSuccess ? '#3a3' : '#c33';

  // Build the message element via DOM APIs so that untrusted `message` text is
  // inserted as textContent (prevents XSS via injected HTML / script).
  errorContainer.replaceChildren();
  const messageDiv = document.createElement('div');
  messageDiv.className = isSuccess ? 'success' : 'error';
  messageDiv.style.background = bgColor;
  messageDiv.style.borderLeftColor = borderColor;
  messageDiv.style.color = textColor;
  messageDiv.textContent = message;
  errorContainer.appendChild(messageDiv);

  if (!isSuccess) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('stats-container').style.display = 'none';
  }
}

function formatNumber(num) {
  if (!Number.isFinite(Number(num))) return '0';
  num = Number(num);
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Fire-and-forget: orchestration lives in background.js because the popup
// closes as soon as the first hidden tab opens (which would kill any
// sequential await loop here). The popup just hands off, then polls
// chrome.storage.local for progress + final result.
async function syncAll() {
  const syncBtn = document.getElementById('sync-btn');
  syncBtn.disabled = true;
  syncBtn.textContent = '⏳ Sync läuft…';
  renderSyncStatus('Sync gestartet — Fortschritt erscheint hier.', 'info');

  chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC_ALL' });

  // Poll storage. The popup may close mid-sync (when a hidden tab opens);
  // when the user re-opens it, renderLastSyncAll() picks up where we left off.
  pollSyncAllProgress();
}

async function pollSyncAllProgress() {
  const syncBtn = document.getElementById('sync-btn');
  const originalText = '↻ Sync alle';
  for (let i = 0; i < 60; i++) {  // up to ~60s
    const { last_sync_all } = await chrome.storage.local.get('last_sync_all');
    if (last_sync_all) {
      renderLastSyncAll(last_sync_all);
      if (last_sync_all.status === 'done') {
        syncBtn.disabled = false;
        syncBtn.textContent = originalText;
        setTimeout(loadStats, 800);
        renderSyncInfo();
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  syncBtn.disabled = false;
  syncBtn.textContent = originalText;
}

// Format a relative timespan in German, picking the largest reasonable unit.
function formatRelativeDe(deltaMs) {
  const sec = Math.max(0, Math.round(deltaMs / 1000));
  if (sec < 60) return 'gerade eben';
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} Std`;
  const day = Math.round(hr / 24);
  return `vor ${day} Tag${day === 1 ? '' : 'en'}`;
}

// Format an absolute timestamp: time-only if today, date+time otherwise.
function formatAbsoluteDe(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

// Two-line readout: when the auto-sync last fired, and when its scraped
// values last actually changed. Helps the user notice silent staleness
// (sync keeps succeeding, but the numbers haven't moved in hours).
async function renderSyncInfo() {
  const el = document.getElementById('sync-info');
  if (!el) return;

  const {
    last_auto_sync,
    last_auto_sync_change_at
  } = await chrome.storage.local.get(['last_auto_sync', 'last_auto_sync_change_at']);

  if (!last_auto_sync) {
    el.style.display = 'none';
    return;
  }

  const now = Date.now();
  const syncAgo = formatRelativeDe(now - last_auto_sync);
  const syncAt = formatAbsoluteDe(last_auto_sync);

  el.replaceChildren();

  const row1 = document.createElement('div');
  row1.className = 'sync-info-row';
  const lbl1 = document.createElement('span');
  lbl1.className = 'sync-info-label';
  lbl1.textContent = 'Letzter Sync';
  const val1 = document.createElement('span');
  val1.className = 'sync-info-value';
  val1.textContent = `${syncAt} (${syncAgo})`;
  row1.append(lbl1, val1);
  el.appendChild(row1);

  if (last_auto_sync_change_at) {
    const sinceChange = now - last_auto_sync_change_at;
    const changedNow = sinceChange < 60_000;  // within last minute → "soeben"
    const row2 = document.createElement('div');
    row2.className = 'sync-info-row';
    const lbl2 = document.createElement('span');
    lbl2.className = 'sync-info-label';
    lbl2.textContent = changedNow ? 'Werte aktualisiert' : 'Werte unverändert seit';
    const val2 = document.createElement('span');
    val2.className = 'sync-info-value';
    // Mark stale (orange) if values haven't moved in over an hour.
    if (sinceChange > 60 * 60_000) val2.classList.add('stale');
    val2.textContent = changedNow
      ? 'soeben'
      : `${formatAbsoluteDe(last_auto_sync_change_at)} (${formatRelativeDe(sinceChange)})`;
    row2.append(lbl2, val2);
    el.appendChild(row2);
  }

  el.style.display = 'block';
}

function renderLastSyncAll(state) {
  if (!state) return;
  const parts = (state.steps || []).map((s) => {
    if (s.status === 'ok') return `✅ ${s.label}`;
    if (s.status === 'skipped') {
      let m = s.message || 'nichts zu syncen';
      if (s.url) m += ` · ${s.url}`;
      if (s.preview) m += ` · "${s.preview.substring(0, 400)}"`;
      return `⚠️ ${s.label}: ${m}`;
    }
    return `❌ ${s.label}: ${s.message || 'Fehler'}`;
  });
  if (state.status === 'running') parts.push('⏳ läuft…');
  if (parts.length === 0) return;
  const allOk = state.status === 'done' && (state.steps || []).every((s) => s.status === 'ok');
  const hasError = (state.steps || []).some((s) => s.status === 'error');
  const tone = state.status === 'done'
    ? (allOk ? 'success' : (hasError ? 'error' : 'warn'))
    : 'info';
  renderSyncStatus(parts.join(' · '), tone);
}

// Renders into the dedicated #sync-status container so it survives the
// loadStats() refresh (which clears #error-container).
function renderSyncStatus(message, tone) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const palette = {
    success: { bg: '#efe', border: '#4c4', color: '#3a3' },
    info:    { bg: '#eef',  border: '#88f', color: '#447' },
    warn:    { bg: '#ffd',  border: '#dc4', color: '#864' },
    error:   { bg: '#fee',  border: '#f44', color: '#c33' },
  };
  const c = palette[tone] || palette.info;
  el.replaceChildren();
  const div = document.createElement('div');
  div.style.background = c.bg;
  div.style.borderLeft = `4px solid ${c.border}`;
  div.style.color = c.color;
  div.style.padding = '10px 12px';
  div.style.borderRadius = '4px';
  div.style.fontSize = '11px';
  div.style.marginBottom = '12px';
  div.style.lineHeight = '1.4';
  div.textContent = message;
  el.appendChild(div);
}
