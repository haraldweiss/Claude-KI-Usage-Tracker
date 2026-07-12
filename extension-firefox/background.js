// © 2026 Harald Weiss
// KI Usage Tracker — Viewer-only + cookie export (Firefox MV2 edition)
// Background scripts loaded via manifest: usage-parser-codex.js, browser-compat.js

var DEFAULT_API_BASE = 'https://ki-usage-tracker.wolfinisoftware.de/api';

async function getApiBase() {
  try {
    var stored = await chrome.storage.local.get('api_base');
    return (stored && stored.api_base) || DEFAULT_API_BASE;
  } catch (e) { return DEFAULT_API_BASE; }
}

function getAuthHeaders(token) {
  var headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}

// Read all cookies from known domains and return as Playwright-compatible JSON
async function getAllCookies() {
  var DOMAIN_VARIANTS = [
    'claude.ai', 'www.claude.ai',
    'platform.claude.com', 'www.platform.claude.com',
    'opencode.ai', 'www.opencode.ai',
    'z.ai', 'www.z.ai',
    'chatgpt.com', 'www.chatgpt.com',
    'platform.openai.com', 'www.platform.openai.com',
    'auth.claude.ai', 'api.claude.ai',
    'account.anthropic.com',
  ];
  var result = [];
  var seen = {};

  // Per-domain queries
  var URLS = [
    'https://claude.ai/',
    'https://platform.claude.com/',
    'https://opencode.ai/',
    'https://z.ai/',
    'https://chatgpt.com/',
    'https://platform.openai.com/',
  ];
  for (var ui = 0; ui < URLS.length; ui++) {
    try {
      var cookies = await chrome.cookies.getAll({ url: URLS[ui] });
      for (var ci = 0; ci < cookies.length; ci++) {
        var c = cookies[ci];
        var key = c.name + ':' + c.domain + ':' + c.path;
        if (seen[key]) continue;
        seen[key] = true;
        var EXPIRY_OFFSET = 24 * 60 * 60;
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
      console.log('[cookies] getAll({url:' + URLS[ui] + '}) -> ' + cookies.length + ' cookies');
    } catch (e) {
      console.log('[cookies] getAll({url:' + URLS[ui] + '}) ERROR: ' + e.message);
    }
  }

  // Also try with domain format
  for (var di = 0; di < DOMAIN_VARIANTS.length; di++) {
    try {
      var cookies = await chrome.cookies.getAll({ domain: DOMAIN_VARIANTS[di] });
      for (var ci = 0; ci < cookies.length; ci++) {
        var c = cookies[ci];
        var key = c.name + ':' + c.domain + ':' + c.path;
        if (seen[key]) continue;
        seen[key] = true;
        var EXPIRY_OFFSET = 24 * 60 * 60;
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
      console.log('[cookies] getAll({domain:' + DOMAIN_VARIANTS[di] + '}) ERROR: ' + e.message);
    }
  }
  console.log('[cookies] found ' + result.length + ' cookies across all domains');
  if (result.length > 0) console.log('[cookies] sample:',
    result.slice(0, 3).map(function(c) { return c.name + '@' + c.domain; }).join(', '));
  return result;
}

// Firefox-compatible executeScript wrapper (loaded from browser-compat.js)
// browserCompat.executeScript(tabId, fn) returns Promise<[{ result: value }]>

chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
  if (message.type === 'GET_MONTHLY_STATS') {
    fetchMonthlyStats()
      .then(function(s) { sendResponse(s); })
      .catch(function() { sendResponse(null); });
    return true; // keep channel open for async response
  }
  if (message.type === 'GET_COOKIES') {
    getAllCookies()
      .then(function(c) { sendResponse(c); })
      .catch(function(e) { sendResponse({ error: e.message }); });
    return true;
  }
  if (message.type === 'EXPORT_COOKIES_NOW') {
    exportCookiesToServer()
      .then(function() { sendResponse({ ok: true }); })
      .catch(function(e) { sendResponse({ ok: false, error: e.message }); });
    return true;
  }
  if (message.type === 'TRIGGER_SYNC_HARD_SOURCES') {
    syncHardSources()
      .then(function(r) { sendResponse(r); })
      .catch(function(e) { sendResponse({ error: e.message }); });
    return true;
  }
  if (message.type === 'DEBUG_COOKIES') {
    getAllCookies().then(function(c) {
      var domains = [];
      for (var i = 0; i < c.length; i++) {
        if (domains.indexOf(c[i].domain) === -1) domains.push(c[i].domain);
      }
      console.log('[cookies] DEBUG: ' + c.length + ' cookies');
      console.log('[cookies] by domain:', domains.join(', '));
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'GET_NEXT_AUTO_SYNC') {
    chrome.alarms.get('AUTO_HARD_SYNC', function(alarm) {
      sendResponse({
        exists: !!alarm,
        scheduled_at: alarm ? alarm.scheduledTime : null,
        period_in_minutes: alarm ? alarm.periodInMinutes : null,
      });
    });
    return true;
  }
  return false;
});

// Auto-export cookies to server-scraper on startup + every 6h
var AUTO_EXPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function exportCookiesToServer() {
  var stored = await chrome.storage.local.get(['api_token', 'server_scraper_url']);
  var uploadUrl = stored.server_scraper_url || 'https://ki-usage-tracker.wolfinisoftware.de/api/cookies/upload';

  try {
    var cookies = await getAllCookies();
    if (cookies.length === 0) {
      console.log('[cookies] export skipped: 0 cookies');
      return;
    }

    var headers = { 'Content-Type': 'application/json' };
    if (stored.api_token) headers['Authorization'] = 'Bearer ' + stored.api_token;

    var resp = await fetch(uploadUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ cookies: cookies, exported_at: new Date().toISOString() }),
    });

    if (resp.ok) {
      console.log('[cookies] exported ' + cookies.length + ' cookies to server \u2705');
    } else {
      console.warn('[cookies] server returned ' + resp.status);
    }
  } catch (err) {
    console.warn('[cookies] export failed:', err.message);
  }
}

// Auto-export on startup (deferred so bg page is fully initialized)
setTimeout(function() {
  getAllCookies().then(function(c) {
    console.log('[cookies] startup: ' + c.length + ' cookies');
    if (c.length > 0) {
      var domains = [];
      for (var i = 0; i < c.length; i++) {
        if (domains.indexOf(c[i].domain) === -1) domains.push(c[i].domain);
      }
      console.log('[cookies] domains:', domains.join(', '));
    } else {
      console.log('[cookies] startup: NO COOKIES FOUND \u2014 check permissions');
    }
  });
  exportCookiesToServer();
}, 2000);

// Periodic re-export
setInterval(exportCookiesToServer, AUTO_EXPORT_INTERVAL_MS);

// ---- Auto-Sync: Hard Sources via chrome.alarms ----
var _autoSyncInProgress = false;

// Create alarm only if it doesn't exist yet
chrome.alarms.get('AUTO_HARD_SYNC', function(alarm) {
  if (!alarm) {
    chrome.alarms.create('AUTO_HARD_SYNC', {
      delayInMinutes: 1,
      periodInMinutes: 15
    });
    console.log('[auto-sync] alarm created: every 15min');
  } else {
    console.log('[auto-sync] alarm already exists, next run at',
      new Date(alarm.scheduledTime).toLocaleString('de-DE'));
  }
});

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name !== 'AUTO_HARD_SYNC') return;
  if (_autoSyncInProgress) {
    console.log('[auto-sync] skipped \u2014 sync already in progress');
    return;
  }
  _autoSyncInProgress = true;
  console.log('[auto-sync] starting...');
  syncHardSources()
    .then(function(result) {
      var okCount = 0, failCount = 0;
      if (result && result.results) {
        for (var i = 0; i < result.results.length; i++) {
          if (result.results[i].ok) okCount++; else failCount++;
        }
      }
      console.log('[auto-sync] done: ' + okCount + ' ok, ' + failCount + ' failed');
      if (failCount > 0) {
        var errors = [];
        for (var i = 0; i < result.results.length; i++) {
          if (!result.results[i].ok) errors.push(result.results[i].source + ': ' + (result.results[i].error || '?'));
        }
        console.warn('[auto-sync] failures:', errors.join(' \u00b7 '));
      }
    })
    .catch(function(err) {
      console.error('[auto-sync] error:', err.message);
    })
    .finally(function() {
      _autoSyncInProgress = false;
    });
});

/**
 * Sync the sources that need httponly cookies (encrypted by macOS Keychain).
 * The extension navigates to each page, scrapes data, and POSTs to the backend.
 * Firefox MV2 uses browserCompat.executeScript() (chrome.tabs.executeScript under the hood).
 */
async function syncHardSources() {
  var stored = await chrome.storage.local.get(['api_token', 'api_base']);
  var baseUrl = (stored.api_base || 'https://ki-usage-tracker.wolfinisoftware.de/api').replace(/\/+$/, '');
  var headers = { 'Content-Type': 'application/json' };
  if (stored.api_token) headers['Authorization'] = 'Bearer ' + stored.api_token;

  var results = [];
  var startTs = Date.now();

  async function postSource(source, model, data) {
    try {
      var r = await fetch(baseUrl + '/usage/track', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model, input_tokens: 0, output_tokens: 0,
          conversation_id: 'ext-sync-' + source + '-' + startTs,
          source: source, response_metadata: data,
        }),
      });
      return r.ok;
    } catch (e) { return false; }
  }

  // Helper: execute a function in a tab (Firefox-compatible)
  async function execInTab(tabId, fn) {
    try {
      var result = await browserCompat.executeScript(tabId, fn);
      if (Array.isArray(result) && result.length > 0) {
        return result[0].result;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // 1. Anthropic Console (platform.claude.com/settings/keys)
  try {
    var tab = await chrome.tabs.create({
      url: 'https://platform.claude.com/settings/keys',
      active: true
    });
    await new Promise(function(r) { setTimeout(r, 10000); });
    var injResult = await execInTab(tab.id, function() {
      var text = document.body && document.body.innerText || '';
      var links = document.querySelectorAll('a[href*="/settings/workspaces/"]');
      var ws = [];
      for (var i = 0; i < links.length; i++) {
        var idMatch = links[i].href.match(/\/workspaces\/([^/]+)/);
        ws.push({ id: idMatch ? idMatch[1] : null, name: (links[i].textContent || '').trim() });
      }
      return { workspaces: ws, text_preview: text.substring(0, 500) };
    });
    if (injResult) {
      await postSource('anthropic_console_sync', 'Anthropic Console (Extension)', injResult);
      results.push({ source: 'console', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'console', ok: false, error: e.message }); }

  // 2. z.ai (my-plan + usage)
  try {
    var tab = await chrome.tabs.create({
      url: 'https://z.ai/manage-apikey/coding-plan/personal/my-plan',
      active: true
    });
    await new Promise(function(r) { setTimeout(r, 8000); });
    var planResult = await execInTab(tab.id, function() {
      var text = document.body && document.body.innerText || '';
      var planMatch = text.match(/(GLM\s+Coding[^\n]*?Plan)/i);
      return {
        plan_name: planMatch ? planMatch[1].trim() : null,
        price_usd: (text.match(/\$\s*([\d]+(?:\.[\d]+)?)/) || [])[1] || null,
        auto_renew_date: (text.match(/Auto-renew\s+on\s+([\d.\-\/]+)/i) || [])[1] || null,
      };
    });
    // Usage page
    await chrome.tabs.update(tab.id, { url: 'https://z.ai/manage-apikey/coding-plan/personal/usage' });
    await new Promise(function(r) { setTimeout(r, 8000); });
    var usageResult = await execInTab(tab.id, function() {
      var text = document.body && document.body.innerText || '';
      function pct(lbl) {
        var re = new RegExp(lbl + '[\\s\\S]{0,40}?(\\d+)\\s*%', 'i');
        var m = text.match(re);
        return m ? parseInt(m[1], 10) : null;
      }
      return {
        five_hour_pct: pct('5\\s*Hours?\\s*Quota'),
        weekly_pct: pct('Weekly\\s*Quota'),
        monthly_pct: pct('Total\\s*Monthly'),
      };
    });
    if (planResult || usageResult) {
      await postSource('zai_sync', 'z.ai (Extension)', {
        plan: planResult,
        usage: usageResult
      });
      results.push({ source: 'zai', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'zai', ok: false, error: e.message }); }

  // 3. Codex (ChatGPT usage limits)
  try {
    var tab = await chrome.tabs.create({
      url: 'https://chatgpt.com/codex/settings/usage',
      active: true
    });
    await new Promise(function(r) { setTimeout(r, 12000); });
    var text = '';
    for (var attempt = 0; attempt < 16; attempt++) {
      var injResult = await execInTab(tab.id, function() {
        return document.body && document.body.innerText || '';
      });
      if (injResult) text = injResult;
      if (/5\s*(?:Stunden|hour)\s*(?:Nutzungsgrenze|usage limit)/i.test(text) &&
          /W\u00f6chentliches Nutzungslimit|Weekly usage limit/i.test(text) &&
          /Monatliches Nutzungslimit|Monthly usage limit/i.test(text)) {
        break;
      }
      await new Promise(function(r) { setTimeout(r, 500); });
    }
    var parsed = parseCodexUsageText(text);
    if (parsed.success) {
      var payload = {};
      for (var k in parsed.data) {
        if (parsed.data.hasOwnProperty(k)) payload[k] = parsed.data[k];
      }
      payload.scraped_at = new Date().toISOString();
      await postSource('codex_sync', 'OpenAI Codex', payload);
      results.push({ source: 'codex', ok: true });
    } else {
      results.push({ source: 'codex', ok: false, error: parsed.reason, preview: text.substring(0, 300) });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'codex', ok: false, error: e.message }); }

  // 4. Claude Code
  try {
    var tab = await chrome.tabs.create({
      url: 'https://platform.claude.com/claude-code/usage',
      active: true
    });
    await new Promise(function(r) { setTimeout(r, 10000); });
    var injResult = await execInTab(tab.id, function() {
      var text = document.body && document.body.innerText || '';
      var trs = document.querySelectorAll('table tbody tr');
      var rows = [];
      for (var i = 0; i < trs.length; i++) {
        var tds = trs[i].querySelectorAll('td');
        var cells = [];
        for (var j = 0; j < tds.length; j++) cells.push((tds[j].textContent || '').trim());
        rows.push(cells);
      }
      return { rows_preview: rows.slice(0, 5), text_preview: text.substring(0, 1000) };
    });
    if (injResult) {
      await postSource('claude_code_sync', 'Claude Code (Extension)', injResult);
      results.push({ source: 'claude_code', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'claude_code', ok: false, error: e.message }); }

  // 5. OpenCode Go
  try {
    var tab = await chrome.tabs.create({
      url: 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go',
      active: true
    });
    await new Promise(function(r) { setTimeout(r, 10000); });
    var injResult = await execInTab(tab.id, function() {
      var text = document.body && document.body.innerText || '';
      var planMatch = text.match(/(?:Du hast|You have)\s+(.+?)\s+(?:abonniert|subscribed)/i);
      function extractPct(labels) {
        for (var i = 0; i < labels.length; i++) {
          var re = new RegExp(labels[i] + '[\\s\\S]{0,200}?(\\d+)\\s*%', 'i');
          var m = text.match(re);
          if (m) return parseInt(m[1], 10);
        }
        return null;
      }
      function extractReset(labels) {
        for (var i = 0; i < labels.length; i++) {
          var re = new RegExp(labels[i] + '[\\s\\S]{0,250}?(?:Resets?\\s+in|Zur\u00fccksetzung\\s+in)\\s+([^\\n]{1,60})', 'i');
          var m = text.match(re);
          if (m) return m[1].trim();
        }
        return null;
      }
      return {
        plan_name: planMatch ? planMatch[1].trim() : null,
        continuous_pct: extractPct(['Rolling Usage', 'Rolling(?![a-zA-Z])', 'Fortlaufend', 'Continuous']),
        continuous_reset_in: extractReset(['Rolling Usage', 'Rolling(?![a-zA-Z])', 'Fortlaufend', 'Continuous']),
        weekly_pct: extractPct(['Weekly Usage', 'Weekly(?![a-z])', 'W\u00f6chentlich']),
        weekly_reset_in: extractReset(['Weekly Usage', 'Weekly(?![a-z])', 'W\u00f6chentlich']),
        monthly_pct: extractPct(['Monthly Usage', 'Monthly(?![a-z])', 'Monatlich']),
        monthly_reset_in: extractReset(['Monthly Usage', 'Monthly(?![a-z])', 'Monatlich']),
      };
    });
    if (injResult) {
      await postSource('opencode_go_sync', 'OpenCode Go (Extension)', injResult);
      results.push({ source: 'opencode_go', ok: true });
    }
    await chrome.tabs.remove(tab.id);
  } catch (e) { results.push({ source: 'opencode_go', ok: false, error: e.message }); }

  // 6. Cline (app.cline.bot subscription — plan name + usage limits)
  try {
    var clineTab = await chrome.tabs.create({
      url: 'https://app.cline.bot/dashboard/subscription',
      active: true
    });
    await new Promise(function(r) { setTimeout(r, 10000); });
    var clineText = '';
    for (var attempt = 0; attempt < 20; attempt++) {
      try {
        var inj = await browser.tabs.executeScript(clineTab.id, { code: 'document.body?.innerText || ""' });
        clineText = (inj && inj[0]) || clineText;
      } catch(e) {}
      if (/5[- ]?Hour\s*Limit/i.test(clineText) &&
          /Weekly\s*Limit/i.test(clineText) &&
          /Monthly\s*Limit/i.test(clineText)) {
        break;
      }
      await new Promise(function(r) { setTimeout(r, 500); });
    }
    var clineResult = null;
    try {
      var scraped = await browser.tabs.executeScript(clineTab.id, { code: '(' + function() {
        var t = document.body?.innerText || '';
        var m = function(re) { var match = t.match(re); return match ? match[1].trim() : null; };
        var pct = function(lbl) {
          var re = new RegExp(lbl + '[\\s\\S]{0,100}?(\\d+)\\s*%', 'i');
          var match = t.match(re); return match ? parseInt(match[1], 10) : null;
        };
        var resetIn = function(lbl) {
          var re = new RegExp(lbl + '[\\s\\S]{0,150}?Resets?\\s+in\\s+([^\\n]{1,60})', 'i');
          var match = t.match(re); return match ? match[1].trim() : null;
        };
        return JSON.stringify({
          plan_name: m(/subscribed\s+to\s+(.+?)(?:\n|$)/i) || m(/Current\s+plan:\s*(.+?)(?:\n|$)/i),
          plan_tier: m(/Current\s+plan:\s*(.+?)(?:\n|$)/i),
          billing_end: m(/billing\s+period\s+ends\s+(.+?)(?:\n|$)/i),
          five_hour_pct: pct('5[- ]?Hour'),
          five_hour_reset_in: resetIn('5[- ]?Hour'),
          weekly_pct: pct('Weekly'),
          weekly_reset_in: resetIn('Weekly'),
          monthly_pct: pct('Monthly'),
          monthly_reset_in: resetIn('Monthly'),
        });
      } + ')()' });
      if (scraped && scraped[0]) clineResult = JSON.parse(scraped[0]);
    } catch(e) {}
    if (clineResult) {
      await postSource('cline_sync', 'Cline (Extension)', clineResult);
      results.push({ source: 'cline', ok: true });
    } else {
      results.push({ source: 'cline', ok: false, error: 'no_data', preview: clineText.substring(0, 300) });
    }
    await chrome.tabs.remove(clineTab.id);
  } catch (e) { results.push({ source: 'cline', ok: false, error: e.message }); }

  console.log('[sync-hard] results:', JSON.stringify(results));
  return { success: true, results: results };
}

async function fetchMonthlyStats() {
  var apiBase = await getApiBase();
  var stored = await chrome.storage.local.get('api_token');
  var headers = getAuthHeaders(stored.api_token);
  var r = await fetch(apiBase + '/monthly?source=extension', { headers: headers });
  return r.ok ? r.json() : null;
}
