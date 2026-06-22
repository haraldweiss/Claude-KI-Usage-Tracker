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
      const allClickable = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], span[tabindex]')).filter(visible);
      // Try literal "Month to date" / "Monat bis heute" first
      let btn = allClickable.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return /^(?:Month to date|This month|Monat bis heute|Dieser Monat|Aktueller Monat)$/i.test(t);
      });
      if (btn) { btn.click(); return 'selected'; }
      // Try date range picker button (contains current month name)
      btn = allClickable.find((el) => {
        const t = (el.innerText || el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '');
        return /date|datum|last 30|letzte 30|range|zeitraum|zeitraum/i.test(t);
      });
      if (!btn) {
        // Last resort: try any button with a date-like text (e.g. "Jun 1–22, 2026")
        btn = allClickable.find((el) => {
          const t = (el.innerText || el.textContent || '').trim();
          return /[A-Z][a-z]{2}\s+\d{1,2}[–\-]\d{1,2}/.test(t);
        });
      }
      if (btn) { btn.click(); return 'opened'; }
      return 'not_found';
    }
  });

  if (openResult?.result === 'selected') return true;
  if (openResult?.result !== 'opened') return false;
  await sleep(800);

  const [selectResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element) => element.getClientRects().length > 0;
      const allClickable = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]')).filter(visible);
      const preset = allClickable.find((el) => {
        const t = (el.innerText || el.textContent || '').trim();
        return /^(?:Month to date|This month|Monat bis heute|Dieser Monat|Aktueller Monat)$/i.test(t);
      });
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
    // OpenAI redirects unauthenticated requests to /login — detect both URL
    // pattern and page text for robust login detection across layout changes.
    if (landedUrl.includes('/login') || landedUrl.includes('/auth')) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: 'login_required' });
      return { skipped: true, reason: 'login_required', url: landedUrl };
    }
    if (/\b(?:Sign in|Log in|Anmelden|Sign up|Continue with|Email|Password)\b/i.test(text)
        && !/Total spend|Total cost|Current usage|Aktuelle Nutzung/i.test(text)) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: 'login_required' });
      return { skipped: true, reason: 'login_required', url: landedUrl };
    }
    if (/Usage Dashboard permission|Organization Owner|keine Berechtigung|permission required/i.test(text)) {
      await chrome.storage.local.set({ last_openai_api_sync: Date.now(), last_openai_api_sync_status: 'permission_required' });
      return { skipped: true, reason: 'permission_required', url: landedUrl };
    }

    const expectedPeriod = openAiApiExpectedPeriod();
    await clickOpenAiMonthToDate(tabId);
    await sleep(3000);
    text = await waitForOpenAiApiText(tabId);
    
    // Enhanced diagnostic: log full page structure for debugging
    const [diagnostic] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const bodyText = document.body?.innerText || '';
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => h.innerText).join(' | ');
        const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText).filter(Boolean).join(', ');
        const tables = Array.from(document.querySelectorAll('table, [role="table"]')).length;
        const costElements = Array.from(document.querySelectorAll('[class*="cost"], [class*="spend"], [class*="total"]'))
          .map(el => el.innerText).filter(Boolean).join(' | ');
        return {
          bodyLength: bodyText.length,
          headings,
          buttons,
          tables,
          costElements,
          url: window.location.href,
          bodyPreview: bodyText.slice(0, 1500).replace(/\n+/g, ' | ')
        };
      }
    });
    
    console.log('[openai-api-scraper] diagnostic:', JSON.stringify(diagnostic?.result, null, 2));
    
    const parsed = parseOpenAiApiUsageText(text, expectedPeriod);
    if (!parsed.success) {
      // Enhanced diagnostic: include full diagnostic info
      const preview = text.slice(0, 1024).replace(/\n+/g, ' | ');
      console.warn('[openai-api-scraper] parse failed:', parsed.reason, `expected=${expectedPeriod.start}..${expectedPeriod.end}`, `preview=${preview}`, `diagnostic=${JSON.stringify(diagnostic?.result)}`);
      await chrome.storage.local.set({ 
        last_openai_api_sync: Date.now(), 
        last_openai_api_sync_status: parsed.reason, 
        last_openai_api_sync_debug: preview,
        last_openai_api_sync_diagnostic: JSON.stringify(diagnostic?.result)
      });
      return { skipped: true, reason: parsed.reason, url: landedUrl, diagnostic: diagnostic?.result };
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
