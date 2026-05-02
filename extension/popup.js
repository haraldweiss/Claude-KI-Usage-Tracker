// Default endpoints — used on a fresh install and when the user clicks
// "Zurücksetzen". Overrides live in chrome.storage.local under the same keys.
const DEFAULT_API_BASE = 'http://localhost:3000/api';
const DEFAULT_DASHBOARD_URL = 'http://localhost:5173';

// Load stats when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  loadStats();

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
  const stored = await chrome.storage.local.get(['api_base', 'dashboard_url', 'api_token']);
  const apiBase = stored.api_base || DEFAULT_API_BASE;
  const dashboardUrl = stored.dashboard_url || DEFAULT_DASHBOARD_URL;

  document.getElementById('api-base-input').value = apiBase;
  document.getElementById('dashboard-url-input').value = dashboardUrl;
  document.getElementById('api-token-input').value = stored.api_token || '';

  const footerEl = document.getElementById('footer-api-base');
  if (footerEl) {
    try { footerEl.textContent = new URL(apiBase).host; } catch { footerEl.textContent = apiBase; }
  }
}

async function saveSettings() {
  const apiBase = document.getElementById('api-base-input').value.trim();
  const dashboardUrl = document.getElementById('dashboard-url-input').value.trim();
  const apiToken = document.getElementById('api-token-input').value.trim();
  const status = document.getElementById('settings-status');

  if (!apiBase || !dashboardUrl) {
    status.textContent = '⚠️ Backend- und Dashboard-URL müssen ausgefüllt sein';
    status.style.color = '#c33'; return;
  }
  await chrome.storage.local.set({
    api_base: apiBase.replace(/\/+$/, ''),
    dashboard_url: dashboardUrl.replace(/\/+$/, ''),
    api_token: apiToken
  });
  await chrome.storage.local.remove(['auth_user', 'auth_pass']);  // clean up old
  status.textContent = '✅ Gespeichert.';
  status.style.color = '#3a3';
  await initSettings();
}

async function resetSettings() {
  await chrome.storage.local.remove(['api_base', 'dashboard_url', 'api_token', 'auth_user', 'auth_pass']);
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
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0);
}

function displayStats(stats) {
  const claudeAi = stats?.combined?.claude_ai;
  const api = stats?.combined?.anthropic_api;
  const meta = claudeAi?.meta;

  const claudeAiTotalEur = claudeAi?.total_eur ?? 0;
  const apiUsd = api?.cost_usd ?? 0;
  const apiEur = api?.cost_eur_equivalent ?? 0;
  const grandTotal = claudeAiTotalEur + apiEur;

  document.getElementById('grand-total').textContent = formatEur(grandTotal);
  document.getElementById('claudeai-total').textContent = claudeAi
    ? `${formatEur(claudeAiTotalEur)}`
    : '—';
  document.getElementById('api-total').textContent =
    apiUsd > 0 ? `${formatUsd(apiUsd)} ≈ ${formatEur(apiEur)}` : formatEur(0);
  document.getElementById('weekly-pct').textContent =
    typeof meta?.weekly_all_models_pct === 'number' ? `${meta.weekly_all_models_pct}%` : '—';
  document.getElementById('session-pct').textContent =
    typeof meta?.session_pct === 'number' ? `${meta.session_pct}%` : '—';
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
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  syncBtn.disabled = false;
  syncBtn.textContent = originalText;
}

function renderLastSyncAll(state) {
  if (!state) return;
  const parts = (state.steps || []).map((s) => {
    if (s.status === 'ok') return `✅ ${s.label}`;
    if (s.status === 'skipped') return `⚠️ ${s.label}: ${s.message || 'nichts zu syncen'}`;
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
