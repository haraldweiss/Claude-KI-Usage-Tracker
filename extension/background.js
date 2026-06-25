// © 2026 Harald Weiss
// KI Usage Tracker — Viewer-only + cookie export.

importScripts('usage-parser-codex.js');

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
  if (message.type === 'TRIGGER_SYNC_HARD_SOURCES') {
    syncHardSources()
      .then((r) => sendResponse(r))
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
  if (message.type === 'GET_NEXT_AUTO_SYNC') {
    chrome.alarms.get('AUTO_HARD_SYNC', (alarm) => {
      sendResponse({
        exists: !!alarm,
        scheduled_at: alarm?.scheduledTime ?? null,
        period_in_minutes: alarm?.periodInMinutes ?? null,
      });
    });
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

// ---- Auto-Sync: Hard Sources via chrome.alarms ----
let _autoSyncInProgress = false;

// Create alarm only if it doesn't exist yet (avoids reset on SW restart)
chrome.alarms.get('AUTO_HARD_SYNC', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('AUTO_HARD_SYNC', {
      delayInMinutes: 1,    // first sync 1 min after SW start
      periodInMinutes: 15   // every 15 minutes thereafter
    });
    console.log('[auto-sync] alarm created: every 120min');
  } else {
    console.log('[auto-sync] alarm already exists, next run at',
      new Date(alarm.scheduledTime).toLocaleString('de-DE'));
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'AUTO_HARD_SYNC') return;
  if (_autoSyncInProgress) {
    console.log('[auto-sync] skipped — sync already in progress');
    return;
  }
  _autoSyncInProgress = true;
  console.log('[auto-sync] starting...');
  syncHardSources()
    .then((result) => {
      const ok = result?.results?.filter(r => r.ok).length ?? 0;
      const fail = result?.results?.filter(r => !r.ok).length ?? 0;
      console.log(`[auto-sync] done: ${ok} ok, ${fail} failed`);
      if (fail > 0) {
        const errors = result.results.filter(r => !r.ok).map(r => r.source + ': ' + (r.error || '?'));
        console.warn('[auto-sync] failures:', errors.join(' · '));
      }
    })
    .catch((err) => {
      console.error('[auto-sync] error:', err.message);
    })
    .finally(() => {
      _autoSyncInProgress = false;
    });
});

/**
 * Sync the sources that need httponly cookies (encrypted by macOS Keychain).
 * The extension navigates to each page, scrapes data, and POSTs to the backend.
 */
async function syncHardSources() {
  const { api_token, api_base } = await chrome.storage.local.get(['api_token', 'api_base']);
  const baseUrl = (api_base || 'https://claudetracker.wolfinisoftware.de/api').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (api_token) headers['Authorization'] = 'Bearer ' + api_token;

  const results = [];
  const startTs = Date.now();

  async function postSource(source, model, data) {
    try {
      const r = await fetch(baseUrl + '/usage/track', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model, input_tokens: 0, output_tokens: 0,
          conversation_id: 'ext-sync-' + source + '-' + startTs,
          source, response_metadata: data,
        }),
      });
      return r.ok;
    } catch { return false; }
  }

  // 1. Anthropic Console (platform.claude.com/settings/keys)
  try {
    const tab = await chrome.tabs.create({
      url: 'https://platform.claude.com/settings/keys',
      active: true
    });
    await new Promise(r => setTimeout(r, 10000)); // wait for page
    // Try to read keys table
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = document.body?.innerText || '';
        // Find workspace names from sidebar links
        const ws = [...document.querySelectorAll('a[href*="/settings/workspaces/"]')]
          .map(a => ({ id: a.href.match(/\/workspaces\/([^/]+)/)?.[1], name: a.textContent?.trim() }));
        return { workspaces: ws, text_preview: text.substring(0, 500) };
      }
    }).catch(() => null);
    if (inj?.result) {
      await postSource('anthropic_console_sync', 'Anthropic Console (Extension)', inj.result);
      results.push({ source: 'console', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'console', ok: false, error: e.message }); }

  // 2. z.ai (my-plan + usage)
  try {
    const tab = await chrome.tabs.create({
      url: 'https://z.ai/manage-apikey/coding-plan/personal/my-plan',
      active: true
    });
    await new Promise(r => setTimeout(r, 8000));
    const [plan] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = document.body?.innerText || '';
        return {
          plan_name: text.match(/(GLM\s+Coding[^\n]*?Plan)/i)?.[1]?.trim(),
          price_usd: text.match(/\$\s*([\d]+(?:\\.\d+)?)/)?.[1],
          auto_renew_date: text.match(/Auto-renew\s+on\s+([\d.\-/]+)/i)?.[1],
        };
      }
    }).catch(() => null);
    // Usage page
    await chrome.tabs.update(tab.id, { url: 'https://z.ai/manage-apikey/coding-plan/personal/usage' });
    await new Promise(r => setTimeout(r, 8000));
    const [usage] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = document.body?.innerText || '';
        const pct = (lbl) => {
          const m = text.match(new RegExp(lbl + '[\\s\\S]{0,40}?(\\d+)\\s*%', 'i'));
          return m ? parseInt(m[1]) : null;
        };
        return {
          five_hour_pct: pct('5\\s*Hours?\\s*Quota'),
          weekly_pct: pct('Weekly\\s*Quota'),
          monthly_pct: pct('Total\\s*Monthly'),
        };
      }
    }).catch(() => null);
    if (plan?.result || usage?.result) {
      await postSource('zai_sync', 'z.ai (Extension)', { plan: plan?.result, usage: usage?.result });
      results.push({ source: 'zai', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'zai', ok: false, error: e.message }); }

  // 3. Codex (ChatGPT usage limits)
  try {
    const tab = await chrome.tabs.create({
      url: 'https://chatgpt.com/codex/settings/usage',
      active: true
    });
    await new Promise(r => setTimeout(r, 12000));
    let text = '';
    for (let attempt = 0; attempt < 16; attempt++) {
      const [inj] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body?.innerText || ''
      }).catch(() => []);
      text = inj?.result || text;
      if (/5\s*(?:Stunden|hour)\s*(?:Nutzungsgrenze|usage limit)/i.test(text) &&
          /Wöchentliches Nutzungslimit|Weekly usage limit/i.test(text) &&
          /Monatliches Nutzungslimit|Monthly usage limit/i.test(text)) {
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    const parsed = parseCodexUsageText(text);
    if (parsed.success) {
      await postSource('codex_sync', 'OpenAI Codex', Object.assign({}, parsed.data, {
        scraped_at: new Date().toISOString()
      }));
      results.push({ source: 'codex', ok: true });
    } else {
      results.push({ source: 'codex', ok: false, error: parsed.reason, preview: text.substring(0, 300) });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'codex', ok: false, error: e.message }); }

  // 4. Claude Code
  try {
    const tab = await chrome.tabs.create({
      url: 'https://platform.claude.com/claude-code/usage',
      active: true
    });
    await new Promise(r => setTimeout(r, 10000));
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = document.body?.innerText || '';
        const rows = [...document.querySelectorAll('table tbody tr')].map(tr => {
          const cells = [...tr.querySelectorAll('td')].map(td => td.textContent?.trim());
          return cells;
        });
        return { rows_preview: rows.slice(0, 5), text_preview: text.substring(0, 1000) };
      }
    }).catch(() => null);
    if (inj?.result) {
      await postSource('claude_code_sync', 'Claude Code (Extension)', inj.result);
      results.push({ source: 'claude_code', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'claude_code', ok: false, error: e.message }); }

  // 5. OpenCode Go
  try {
    const tab = await chrome.tabs.create({
      url: 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go',
      active: true
    });
    await new Promise(r => setTimeout(r, 10000));
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const text = document.body?.innerText || '';
        const planMatch = text.match(/(?:Du hast|You have)\s+(.+?)\s+(?:abonniert|subscribed)/i);
        function extractPct(labels) {
          for (const label of labels) {
            const re = new RegExp(label + '[\\s\\S]{0,200}?(\\d+)\\s*%', 'i');
            const m = text.match(re);
            if (m) return parseInt(m[1], 10);
          }
          return null;
        }
        function extractReset(labels) {
          for (const label of labels) {
            const re = new RegExp(label + '[\\s\\S]{0,250}?(?:Resets?\\s+in|Zur\u00fccksetzung\\s+in)\\s+([^\\n]{1,60})', 'i');
            const m = text.match(re);
            if (m) return m[1].trim();
          }
          return null;
        }
        return {
          plan_name: planMatch?.[1]?.trim(),
          continuous_pct: extractPct(['Rolling Usage', 'Rolling(?![a-zA-Z])', 'Fortlaufend', 'Continuous']),
          continuous_reset_in: extractReset(['Rolling Usage', 'Rolling(?![a-zA-Z])', 'Fortlaufend', 'Continuous']),
          weekly_pct: extractPct(['Weekly Usage', 'Weekly(?![a-z])', 'W\u00f6chentlich']),
          weekly_reset_in: extractReset(['Weekly Usage', 'Weekly(?![a-z])', 'W\u00f6chentlich']),
          monthly_pct: extractPct(['Monthly Usage', 'Monthly(?![a-z])', 'Monatlich']),
          monthly_reset_in: extractReset(['Monthly Usage', 'Monthly(?![a-z])', 'Monatlich']),
        };
      }
    }).catch(() => null);
    if (inj?.result) {
      await postSource('opencode_go_sync', 'OpenCode Go (Extension)', inj.result);
      results.push({ source: 'opencode_go', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'opencode_go', ok: false, error: e.message }); }

  console.log('[sync-hard] results:', JSON.stringify(results));
  return { success: true, results };
}

async function fetchMonthlyStats() {
  const apiBase = await getApiBase();
  const { api_token } = await chrome.storage.local.get('api_token');
  const r = await fetch(`${apiBase}/monthly?source=extension`, { headers: getAuthHeaders(api_token) });
  return r.ok ? r.json() : null;
}
