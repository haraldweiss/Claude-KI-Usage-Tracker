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

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { withTimeout };
}
