// © 2026 Harald Weiss
// KI Usage Tracker — Viewer-only + cookie export.

const DEFAULT_API_BASE = 'https://claudetracker.wolfinisoftware.de/api';

async function getApiBase() {
  try {
    const stored = await chrome.storage.local.get('api_base');
    return stored?.api_base || DEFAULT_API_BASE;
  } catch { return DEFAULT_API_BASE; }
}

function getAuthHeaders(token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// Read all cookies from known domains and return as Playwright-compatible JSON
async function getAllCookies() {
  const DOMAIN_VARIANTS = [
    'claude.ai', 'www.claude.ai',
    'platform.claude.com', 'www.platform.claude.com',
    'opencode.ai', 'www.opencode.ai',
    'z.ai', 'www.z.ai',
    'chatgpt.com', 'www.chatgpt.com',
    'platform.openai.com', 'www.platform.openai.com',
    'auth.claude.ai', 'api.claude.ai',
    'account.anthropic.com',
  ];
  const result = [];
  const seen = new Set();
  for (const domain of DOMAIN_VARIANTS) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const key = c.name + ':' + c.domain + ':' + c.path;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          expires: c.expirationDate || Math.round(Date.now() / 1000) + 86400,
          httpOnly: c.httpOnly || false,
          secure: c.secure || false,
          sameSite: c.sameSite || 'Lax',
        });
      }
    } catch { /* skip */ }
  }
  console.log('[cookies] found ' + result.length + ' cookies across all domains');
  if (result.length > 0) console.log('[cookies] sample:', result.slice(0, 3).map(c => c.name + '@' + c.domain).join(', '));
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_MONTHLY_STATS') {
    fetchMonthlyStats()
      .then((s) => sendResponse(s))
      .catch(() => sendResponse(null));
    return true;
  }
  if (message.type === 'GET_COOKIES') {
    getAllCookies()
      .then((c) => sendResponse(c))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'DEBUG_COOKIES') {
    getAllCookies().then((c) => {
      console.log('[cookies] DEBUG: ' + c.length + ' cookies');
      console.log('[cookies] by domain:', [...new Set(c.map(x => x.domain))].join(', '));
    });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

// Auto-debug on startup (deferred so SW is fully initialized)
setTimeout(() => {
  getAllCookies().then((c) => {
    console.log('[cookies] startup: ' + c.length + ' cookies');
    if (c.length > 0) console.log('[cookies] domains:', [...new Set(c.map(x => x.domain))].join(', '));
    else console.log('[cookies] startup: NO COOKIES FOUND — check permissions');
  });
}, 2000);

async function fetchMonthlyStats() {
  const apiBase = await getApiBase();
  const { api_token } = await chrome.storage.local.get('api_token');
  const r = await fetch(`${apiBase}/monthly?source=extension`, { headers: getAuthHeaders(api_token) });
  return r.ok ? r.json() : null;
}
