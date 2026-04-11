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

// Sync usage from Claude's official settings page
async function syncFromClaude() {
  const syncBtn = document.getElementById('sync-btn');
  const originalText = syncBtn.textContent;

  try {
    syncBtn.textContent = '⏳ Syncing...';
    syncBtn.disabled = true;

    // Query the Claude.ai settings page
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });

    if (tabs.length === 0) {
      showError('❌ Please open claude.ai first and go to Settings > Usage');
      syncBtn.textContent = originalText;
      syncBtn.disabled = false;
      return;
    }

    // Try to send message with retry logic
    let success = false;
    let lastError = null;

    for (let i = 0; i < 3; i++) {
      try {
        const response = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SCRAPE_USAGE'
        });

        if (response && response.success) {
          // Send scraped data to backend
          const usageData = response.data;
          console.log('Sending to backend:', usageData);

          try {
            const backendResponse = await fetch('http://localhost:3000/api/usage/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'Claude (Official Sync)',
                input_tokens: Math.round((usageData.monthly_spent || 0) * 1000),
                output_tokens: usageData.weekly_used || 0,
                conversation_id: `sync-${Date.now()}`,
                source: 'claude_official_sync'
              })
            });

            if (backendResponse.ok) {
              success = true;
              showError('✅ Synced successfully! Data saved to tracker.', true);
              setTimeout(() => {
                loadStats();
              }, 1000);
              break;
            }
          } catch (backendErr) {
            console.error('Backend error:', backendErr);
            lastError = backendErr;
          }
        }
      } catch (err) {
        lastError = err;
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!success) {
      showError('❌ Make sure you\'re on https://claude.ai/settings/usage and reload the extension');
    }

    syncBtn.textContent = originalText;
    syncBtn.disabled = false;
  } catch (error) {
    console.error('Sync error:', error);
    showError('❌ Sync failed. Reload the extension and try again.');
    document.getElementById('sync-btn').textContent = originalText;
    document.getElementById('sync-btn').disabled = false;
  }
}
