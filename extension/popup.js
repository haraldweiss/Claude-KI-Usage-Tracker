// Load stats when popup opens
document.addEventListener('DOMContentLoaded', () => {
  loadStats();

  // Sync from Claude button
  document.getElementById('sync-btn').addEventListener('click', () => {
    syncFromClaude();
  });

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadStats();
  });

  // Dashboard button
  document.getElementById('open-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:5173' });
  });
});

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
