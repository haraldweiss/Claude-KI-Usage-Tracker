const CODEX_USAGE_URL = 'https://chatgpt.com/codex/settings/usage';
const CODEX_TAB_MATCH = 'https://chatgpt.com/codex/*';

function buildCodexTrackPayload(data, nowIso) {
  return {
    model: 'OpenAI Codex',
    input_tokens: 0,
    output_tokens: 0,
    conversation_id: 'codex-daily-' + nowIso.slice(0, 10),
    source: 'codex_sync',
    cost_usd: 0,
    response_metadata: Object.assign({}, data, { scraped_at: nowIso })
  };
}

async function readCodexVisibleText(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.body?.innerText || ''
  });
  return injected?.result || '';
}

async function waitForCodexUsageText(tabId, timeoutMs = 20000) {
  const started = Date.now();
  let latest = '';
  while (Date.now() - started < timeoutMs) {
    try {
      latest = await readCodexVisibleText(tabId);
      if (/5\s*(?:Stunden|hour)\s*(?:Nutzungsgrenze|usage limit)/i.test(latest) &&
          /Wöchentliches Nutzungslimit|Weekly usage limit/i.test(latest)) {
        return latest;
      }
    } catch (error) {
      // The ChatGPT SPA briefly replaces the document during its redirect.
    }
    await sleep(500);
  }
  return latest;
}

async function codexSync(externalTabId = null) {
  let createdTabId = null;
  try {
    let tabId;
    if (externalTabId !== null) {
      tabId = externalTabId;
    } else {
      const existing = await chrome.tabs.query({ url: CODEX_TAB_MATCH });
      if (existing.length > 0) {
        tabId = existing[0].id;
      } else {
        const tab = await chrome.tabs.create({ url: CODEX_USAGE_URL, active: true });
        tabId = tab.id;
        createdTabId = tab.id;
      }
    }

    await chrome.tabs.update(tabId, { url: CODEX_USAGE_URL, active: true });
    await waitForTabReady(tabId, 30000);
    const text = await waitForCodexUsageText(tabId);
    const tab = await chrome.tabs.get(tabId);
    const landedUrl = tab.url || '';

    if (!landedUrl.startsWith('https://chatgpt.com/codex/')) {
      await chrome.storage.local.set({
        last_codex_sync: Date.now(),
        last_codex_sync_status: 'login_required'
      });
      return { skipped: true, reason: 'login_required', url: landedUrl };
    }

    if (/\b(?:Anmelden|Sign in|Log in)\b/i.test(text) && !/Codex Analytics/i.test(text)) {
      await chrome.storage.local.set({
        last_codex_sync: Date.now(),
        last_codex_sync_status: 'login_required'
      });
      return { skipped: true, reason: 'login_required', url: landedUrl };
    }

    const parsed = parseCodexUsageText(text);
    if (!parsed.success) {
      await chrome.storage.local.set({
        last_codex_sync: Date.now(),
        last_codex_sync_status: parsed.reason
      });
      return { skipped: true, reason: parsed.reason, url: landedUrl };
    }

    const nowIso = new Date().toISOString();
    const payload = buildCodexTrackPayload(parsed.data, nowIso);
    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error('post_failed: backend returned ' + response.status);
    }

    const data = payload.response_metadata;
    await chrome.storage.local.set({
      last_codex_sync: Date.now(),
      last_codex_sync_status: 'ok',
      last_codex_sync_data: data
    });
    console.log(
      `Codex-sync ok: 5h=${data.five_hour_remaining_pct}% remaining, ` +
      `week=${data.weekly_remaining_pct}% remaining, credits=${data.credits_remaining ?? '?'}`
    );
    return { success: true, data };
  } catch (error) {
    const message = error?.message || String(error);
    const reason = message.startsWith('post_failed') ? 'post_failed' : 'layout_changed';
    await chrome.storage.local.set({
      last_codex_sync: Date.now(),
      last_codex_sync_status: reason
    });
    console.error('Codex-sync error:', error);
    return { success: false, reason, error: message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCodexTrackPayload };
}
