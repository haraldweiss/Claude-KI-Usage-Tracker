// Default endpoints — used on a fresh install and when the user clicks
// "Zurücksetzen". Overrides live in chrome.storage.local under the same keys.
const DEFAULT_API_BASE = 'http://localhost:3000/api';
const DEFAULT_DASHBOARD_URL = 'http://localhost:5173';

// Load stats when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  loadStats();

  // Sync from Claude button
  document.getElementById('sync-btn').addEventListener('click', () => {
    syncFromClaude();
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
});

async function initSettings() {
  const stored = await chrome.storage.local.get([
    'api_base',
    'dashboard_url',
    'auth_user',
    'auth_pass'
  ]);
  const apiBase = stored.api_base || DEFAULT_API_BASE;
  const dashboardUrl = stored.dashboard_url || DEFAULT_DASHBOARD_URL;

  document.getElementById('api-base-input').value = apiBase;
  document.getElementById('dashboard-url-input').value = dashboardUrl;
  document.getElementById('auth-user-input').value = stored.auth_user || '';
  document.getElementById('auth-pass-input').value = stored.auth_pass || '';

  // Footer shows the host portion so the user can see at a glance
  // whether the popup is talking to localhost or a remote VPS.
  const footerEl = document.getElementById('footer-api-base');
  if (footerEl) {
    try {
      footerEl.textContent = new URL(apiBase).host;
    } catch {
      footerEl.textContent = apiBase;
    }
  }
}

async function saveSettings() {
  const apiBase = document.getElementById('api-base-input').value.trim();
  const dashboardUrl = document.getElementById('dashboard-url-input').value.trim();
  const authUser = document.getElementById('auth-user-input').value.trim();
  const authPass = document.getElementById('auth-pass-input').value;
  const status = document.getElementById('settings-status');

  if (!apiBase || !dashboardUrl) {
    status.textContent = '⚠️ Backend- und Dashboard-URL müssen ausgefüllt sein';
    status.style.color = '#c33';
    return;
  }

  // Auth is optional: leave both empty for unauthenticated local dev. If only
  // one is filled, that's almost certainly a mistake — flag it.
  if ((authUser && !authPass) || (!authUser && authPass)) {
    status.textContent = '⚠️ User und Passwort müssen beide gesetzt oder beide leer sein';
    status.style.color = '#c33';
    return;
  }

  await chrome.storage.local.set({
    api_base: apiBase.replace(/\/+$/, ''),
    dashboard_url: dashboardUrl.replace(/\/+$/, ''),
    auth_user: authUser,
    auth_pass: authPass
  });
  status.textContent = '✅ Gespeichert. Background-Service nutzt die neue Konfiguration ab dem nächsten Sync.';
  status.style.color = '#3a3';
  await initSettings();
}

async function resetSettings() {
  await chrome.storage.local.remove([
    'api_base',
    'dashboard_url',
    'auth_user',
    'auth_pass'
  ]);
  await initSettings();
  const status = document.getElementById('settings-status');
  status.textContent = 'Auf localhost zurückgesetzt, Auth gelöscht.';
  status.style.color = '#666';
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

// Sync usage from Claude's official settings page.
// Delegates to the background's auto-sync, which finds an open settings/usage
// tab or opens a hidden one, scrapes, posts, and closes.
async function syncFromClaude() {
  const syncBtn = document.getElementById('sync-btn');
  const originalText = syncBtn.textContent;

  syncBtn.textContent = '⏳ Syncing...';
  syncBtn.disabled = true;

  chrome.runtime.sendMessage({ type: 'TRIGGER_AUTO_SYNC' }, (response) => {
    syncBtn.textContent = originalText;
    syncBtn.disabled = false;

    if (chrome.runtime.lastError) {
      showError('❌ Sync failed: ' + chrome.runtime.lastError.message);
      return;
    }

    const result = response?.result;
    if (response?.success && result?.success) {
      showError('✅ Synced from Claude.', true);
      setTimeout(loadStats, 800);
    } else if (result?.skipped) {
      showError('⚠️ Page had no usage figures to scrape. Try again in a moment.');
    } else {
      showError('❌ Sync failed: ' + (result?.error || response?.error || 'unknown error'));
    }
  });
}
