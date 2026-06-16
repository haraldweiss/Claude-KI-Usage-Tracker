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

// ---------------------------------------------------------------------------
// Central tab lifecycle — all scrapers register created tabs here instead of
// closing them in their own finally block. syncAll() cleans up once at the
// end, avoiding "No tab with id" races between consecutive scrapers.
const _createdTabIds = [];

function trackTabCleanup(tabId) {
  if (tabId !== null) _createdTabIds.push(tabId);
}

async function cleanupAllTabs() {
  const ids = _createdTabIds.splice(0);
  for (const id of ids) {
    try { await chrome.tabs.remove(id); } catch {}
  }
}
