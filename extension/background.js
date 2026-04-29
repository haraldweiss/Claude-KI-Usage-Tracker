const API_BASE = 'http://localhost:3000/api';
const QUEUE_STORAGE_KEY = 'usage_queue';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRACK_USAGE') {
    trackUsage(message.data)
      .then((response) => sendResponse({ success: true, data: response }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  }

  if (message.type === 'GET_TODAY_STATS') {
    getTodayStats()
      .then((stats) => sendResponse(stats))
      .catch(() => sendResponse(null));
    return true;
  }
});

// Track usage by sending to backend. Forwards every field the content script
// captures, including the raw prompt/response that drive Haiku categorization.
async function trackUsage(data) {
  try {
    const payload = {
      model: data.model,
      input_tokens: data.input_tokens,
      output_tokens: data.output_tokens,
      conversation_id: data.conversation_id,
      source: data.source || 'claude_ai',
      task_description: data.task_description,
      success_status: data.success_status,
      response_metadata: data.response_metadata,
      raw_prompt: data.raw_prompt,
      raw_response: data.raw_response
    };

    // Strip undefined keys so the backend validators don't reject them.
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const response = await fetch(`${API_BASE}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Failed to track usage');
    }

    const result = await response.json();

    // Update badge with token count
    updateBadge();

    return result;
  } catch (error) {
    console.error('Error tracking usage:', error);
    // Queue for retry
    await queueUsageData(data);
    throw error;
  }
}

// Get today's usage stats
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

// Update badge with token count
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

// Queue usage data for retry
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

// Retry queued usage data
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
        // Re-queue if fails
        await queueUsageData(data);
      }
    }
  } catch (error) {
    console.error('Error retrying queued data:', error);
  }
}

// Retry queued data every 5 minutes
setInterval(() => {
  retryQueuedData();
}, 5 * 60 * 1000);

// Refresh badge every 3 minutes
setInterval(() => {
  updateBadge();
}, 3 * 60 * 1000);

// Initial badge update
updateBadge();
