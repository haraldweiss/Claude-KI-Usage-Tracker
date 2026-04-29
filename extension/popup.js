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
  const stored = await chrome.storage.local.get(['api_base', 'dashboard_url']);
  const apiBase = stored.api_base || DEFAULT_API_BASE;
  const dashboardUrl = stored.dashboard_url || DEFAULT_DASHBOARD_URL;

  document.getElementById('api-base-input').value = apiBase;
  document.getElementById('dashboard-url-input').value = dashboardUrl;

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
  const status = document.getElementById('settings-status');

  if (!apiBase || !dashboardUrl) {
    status.textContent = '⚠️ Beide Felder müssen ausgefüllt sein';
    status.style.color = '#c33';
    return;
  }

  await chrome.storage.local.set({
    api_base: apiBase.replace(/\/+$/, ''),
    dashboard_url: dashboardUrl.replace(/\/+$/, '')
  });
  status.textContent = '✅ Gespeichert. Background-Service nutzt die neue URL ab dem nächsten Sync.';
  status.style.color = '#3a3';
  await initSettings();
}

async function resetSettings() {
  await chrome.storage.local.remove(['api_base', 'dashboard_url']);
  await initSettings();
  const status = document.getElementById('settings-status');
  status.textContent = 'Auf localhost zurückgesetzt.';
  status.style.color = '#666';
}

async function loadStats() {
  const loadingEl = document.getElementById('loading');
  const statsContainer = document.getElementById('stats-container');
  const errorContainer = document.getElementById('error-container');

  try {
    // Get stats from background script
    chrome.runtime.sendMessage({ type: 'GET_TODAY_STATS' }, (stats) => {
      if (stats) {
        displayStats(stats);
        loadingEl.style.display = 'none';
        statsContainer.style.display = 'block';
        errorContainer.innerHTML = '';
      } else {
        throw new Error('Failed to load stats');
      }
    });

    // Set timeout in case background doesn't respond
    setTimeout(() => {
      if (loadingEl.style.display !== 'none') {
        showError('Could not connect to backend. Make sure port 3000 is running.');
      }
    }, 3000);
  } catch (error) {
    showError(error.message);
  }
}

function displayStats(stats) {
  document.getElementById('total-tokens').textContent = formatNumber(stats.total_tokens || 0);
  document.getElementById('input-tokens').textContent = formatNumber(stats.total_input_tokens || 0);
  document.getElementById('output-tokens').textContent = formatNumber(stats.total_output_tokens || 0);
  document.getElementById('total-cost').textContent = '$' + (stats.total_cost || 0).toFixed(4);
  document.getElementById('request-count').textContent = stats.request_count || 0;
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
