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
  
  // First try: get ALL cookies without domain filter (needs host_permission for all)
  try {
    const allCookies = await chrome.cookies.getAll({});
    console.log('[cookies] ALL cookies (no filter): ' + allCookies.length);
    if (allCookies.length > 0) {
      const byDomain = {};
      for (const c of allCookies) {
        if (!byDomain[c.domain]) byDomain[c.domain] = [];
        byDomain[c.domain].push(c.name);
      }
      for (const [d, names] of Object.entries(byDomain)) {
        console.log('[cookies]   ' + d + ': ' + names.join(', '));
      }
    }
  } catch (e) {
    console.log('[cookies] getAll({}) ERROR: ' + e.message);
  }
  
  // Second try: per-domain queries — try with URL format first, then domain
  const URLS = [
    'https://claude.ai/',
    'https://platform.claude.com/',
    'https://opencode.ai/',
    'https://z.ai/',
    'https://chatgpt.com/',
    'https://platform.openai.com/',
  ];
  for (const url of URLS) {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      for (const c of cookies) {
        const key = c.name + ':' + c.domain + ':' + c.path;
        if (seen.has(key)) continue;
        seen.add(key);
        // Use +24h expiry so server-scraper cookies are still valid
        // (some auth tokens have extremely short lifetimes, e.g. 1min)
        const EXPIRY_OFFSET = 24 * 60 * 60;
        result.push({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          expires: Math.round(Date.now() / 1000) + EXPIRY_OFFSET,
          httpOnly: c.httpOnly || false,
          secure: c.secure || false,
          sameSite: ({
            'no_restriction': 'None',
            'lax': 'Lax',
            'strict': 'Strict',
            'unspecified': 'Lax',
          })[c.sameSite] || 'Lax',
        });
      }
      console.log('[cookies] getAll({url:' + url + '}) -> ' + cookies.length + ' cookies');
    } catch (e) {
      console.log('[cookies] getAll({url:' + url + '}) ERROR: ' + e.message);
    }
  }
  
  // Also try with domain format (old approach)
  for (const domain of DOMAIN_VARIANTS) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const key = c.name + ':' + c.domain + ':' + c.path;
        if (seen.has(key)) continue;
        seen.add(key);
        // Use +24h expiry so server-scraper cookies are still valid
        // (some auth tokens have extremely short lifetimes, e.g. 1min)
        const EXPIRY_OFFSET = 24 * 60 * 60;
        result.push({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          expires: Math.round(Date.now() / 1000) + EXPIRY_OFFSET,
          httpOnly: c.httpOnly || false,
          secure: c.secure || false,
          sameSite: ({
            'no_restriction': 'None',
            'lax': 'Lax',
            'strict': 'Strict',
            'unspecified': 'Lax',
          })[c.sameSite] || 'Lax',
        });
      }
    } catch (e) {
      console.log('[cookies] getAll({domain:' + domain + '}) ERROR: ' + e.message);
    }
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
  if (message.type === 'EXPORT_COOKIES_NOW') {
    exportCookiesToServer()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
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

// Auto-export cookies to server-scraper on startup + every 6h
const AUTO_EXPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function exportCookiesToServer() {
  const { api_token, server_scraper_url } = await chrome.storage.local.get([
    'api_token', 'server_scraper_url'
  ]);
  const uploadUrl = server_scraper_url || 'https://claudetracker.wolfinisoftware.de/api/cookies/upload';

  try {
    const cookies = await getAllCookies();
    if (cookies.length === 0) {
      console.log('[cookies] export skipped: 0 cookies');
      return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (api_token) headers['Authorization'] = `Bearer ${api_token}`;

    const resp = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cookies, exported_at: new Date().toISOString() }),
    });

    if (resp.ok) {
      console.log(`[cookies] exported ${cookies.length} cookies to server ✅`);
    } else {
      console.warn(`[cookies] server returned ${resp.status}`);
    }
  } catch (err) {
    console.warn('[cookies] export failed:', err.message);
  }
}

// Auto-export on startup (deferred so SW is fully initialized)
setTimeout(() => {
  getAllCookies().then((c) => {
    console.log('[cookies] startup: ' + c.length + ' cookies');
    if (c.length > 0) console.log('[cookies] domains:', [...new Set(c.map(x => x.domain))].join(', '));
    else console.log('[cookies] startup: NO COOKIES FOUND — check permissions');
  });
  exportCookiesToServer();
}, 2000);

// Periodic re-export
setInterval(exportCookiesToServer, AUTO_EXPORT_INTERVAL_MS);

async function fetchMonthlyStats() {
  const apiBase = await getApiBase();
  const { api_token } = await chrome.storage.local.get('api_token');
  const r = await fetch(`${apiBase}/monthly?source=extension`, { headers: getAuthHeaders(api_token) });
  return r.ok ? r.json() : null;
}
