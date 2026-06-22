const OPENAI_API_USAGE_URL = 'https://platform.openai.com/usage';
const OPENAI_API_TAB_MATCH = 'https://platform.openai.com/*';

function openAiApiExpectedPeriod(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return { start: `${year}-${month}-01`, end: `${year}-${month}-${day}` };
}

function buildOpenAiApiTrackPayload(data, nowIso) {
  return {
    model: 'OpenAI API',
    input_tokens: data.input_tokens,
    output_tokens: data.output_tokens,
    conversation_id: 'openai-api-mtd-' + data.organization_name.replace(/[^a-z0-9_-]/gi, '_') + '-' + data.period_end,
    source: 'openai_api_sync',
    workspace: data.organization_name,
    cost_usd: data.cost_usd,
    response_metadata: Object.assign({}, data, { scraped_at: nowIso })
  };
}

async function readOpenAiApiPage(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const bodyText = document.body?.innerText || '';
      const controls = Array.from(document.querySelectorAll('button,[role="button"]'));
      const orgControl = controls.find((element) => {
        const hint = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`;
        return /organi[sz]ation/i.test(hint) && (element.innerText || '').trim();
      });
      const organization = orgControl ? (orgControl.innerText || '').trim() : '';
      return organization && !/(?:Organization|Organisation)\s+/i.test(bodyText)
        ? `${bodyText}\nOrganization ${organization}`
        : bodyText;
    }
  });
  return injected?.result || '';
}

async function clickOpenAiMonthToDate(tabId) {
  const [openResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element) => element.getClientRects().length > 0;
      const controls = Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);
      const preset = controls.find((element) => /^(?:Month to date|This month|Monat bis heute|Dieser Monat)$/i.test((element.innerText || '').trim()));
      if (preset) {
        preset.click();
        return 'selected';
      }
      const dateControl = controls.find((element) => {
        const text = `${element.innerText || ''} ${element.getAttribute('aria-label') || ''}`;
        return /date|datum|last 30|letzte 30|\b[A-Z][a-z]{2}\s+\d{1,2}\b/i.test(text);
      });
      if (dateControl) {
        dateControl.click();
        return 'opened';
      }
      return 'not_found';
    }
  });

  if (openResult?.result === 'selected') return true;
  if (openResult?.result !== 'opened') return false;
  await sleep(500);

  const [selectResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element) => element.getClientRects().length > 0;
      const controls = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"]')).filter(visible);
      const preset = controls.find((element) => /^(?:Month to date|This month|Monat bis heute|Dieser Monat)$/i.test((element.innerText || '').trim()));
      if (!preset) return false;
      preset.click();
      return true;
    }
  });
  return selectResult?.result === true;
}

async function waitForOpenAiApiText(tabId, timeoutMs = 20000) {
  const started = Date.now();
  let latest = '';
  while (Date.now() - started < timeoutMs) {
    try {
      latest = await readOpenAiApiPage(tabId);
      if (/Total spend|Total cost|Gesamtausgaben|Gesamtkosten/i.test(latest)) return latest;
      if (/permission|Berechtigung|Organization Owner|Organisationsinhaber/i.test(latest)) return latest;
    } catch (error) {
      // React may swap the document while the organization context loads.
    }
    await sleep(500);
  }
  return latest;
}

async function openaiApiSync(externalTabId = null) {
  let createdTabId = null;
  try {
    let tabId;
    if (externalTabId !== null) {
      tabId = externalTabId;
    } else {
      const existing = await chrome.tabs.query({ url: OPENAI_API_TAB_MATCH });
      if (existing.length > 0) {
        tabId = existing[0].id;
      } else {
        const tab = await chrome.tabs.create({ url: OPENAI_API_USAGE_URL, active: true });
        tabId = tab.id;
        createdTabId = tab.id;
      }
    }

    await chrome.tabs.update(tabId, { url: OPENAI_API_USAGE_URL, active: true });
    await waitForTabReady(tabId, 30000);
    let text = await waitForOpenAiApiText(tabId);
    const tab = await chrome.tabs.get(tabId);
    const landedUrl = tab.url || '';

    if (!landedUrl.startsWith('https://platform.openai.com/')) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: 'login_required' });
      return { skipped: true, reason: 'login_required', url: landedUrl };
    }
    if (/\b(?:Sign in|Log in|Anmelden)\b/i.test(text) && !/Total spend|Total cost/i.test(text)) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: 'login_required' });
      return { skipped: true, reason: 'login_required', url: landedUrl };
    }
    if (/Usage Dashboard permission|Organization Owner|keine Berechtigung|permission required/i.test(text)) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: 'permission_required' });
      return { skipped: true, reason: 'permission_required', url: landedUrl };
    }

    const expectedPeriod = openAiApiExpectedPeriod();
    await clickOpenAiMonthToDate(tabId);
    await sleep(1000);
    text = await waitForOpenAiApiText(tabId);
    const parsed = parseOpenAiApiUsageText(text, expectedPeriod);
    if (!parsed.success) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: parsed.reason });
      return { skipped: true, reason: parsed.reason, url: landedUrl };
    }

    const payload = buildOpenAiApiTrackPayload(parsed.data, new Date().toISOString());
    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('post_failed: backend returned ' + response.status);

    const data = payload.response_metadata;
    await chrome.storage.local.set({
      last_openai_api_sync: Date.now(),
      last_openai_api_sync_status: 'ok',
      last_openai_api_sync_data: data
    });
    console.log(`OpenAI-API-sync ok: org=${data.organization_name} MTD=$${data.cost_usd}`);
    return { success: true, data };
  } catch (error) {
    const message = error?.message || String(error);
    const reason = message.startsWith('post_failed') ? 'post_failed' : 'layout_changed';
    await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: reason });
    console.error('OpenAI-API-sync error:', error);
    return { success: false, reason, error: message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildOpenAiApiTrackPayload, openAiApiExpectedPeriod };
}
