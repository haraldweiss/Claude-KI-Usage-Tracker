// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss

// z.ai (Zhipu) GLM Coding Plan — 5th cost source.
//
// Scrapes two pages of the logged-in z.ai console:
//   /manage-apikey/coding-plan/personal/my-plan  → plan name, monthly price (USD), auto-renew date
//   /manage-apikey/coding-plan/personal/usage     → 5h / weekly / monthly quota %, absolute reset times
//
// Both pages are React apps that render ~3-4s after load, so we poll the body
// text until the expected labels appear before scraping. Reset times here are
// ABSOLUTE timestamps ("Reset Time: 2026-06-21 08:58"), unlike OpenCode Go's
// relative strings — the backend stores them verbatim and the frontend renders
// them via formatAbsoluteResetHint.
//
// Best-effort (AGENTS.md §3.2): z.ai may change its layout or labels (DE/EN)
// without warning. When the expected labels are missing we skip cleanly rather
// than POST garbage, and a login bounce is reported as `login_required`.

const ZAI_MY_PLAN_URL = 'https://z.ai/manage-apikey/coding-plan/personal/my-plan';
const ZAI_USAGE_URL = 'https://z.ai/manage-apikey/coding-plan/personal/usage';
const ZAI_TAB_MATCH = 'https://z.ai/manage-apikey/coding-plan/*';

// Injected into the page. Reads plan name + price + auto-renew from the
// my-plan view. Returns nulls for anything it can't find rather than throwing.
function scrapeZaiPlan() {
  const text = document.body.innerText || '';

  // Plan name. The sidebar nav also contains a bare "GLM Coding Plan" label, so
  // we can't just grab the first match. Primary: the plan title that sits
  // directly above the "Valid"/"Invalid" status badge. Fallback: a tiered name
  // ("GLM Coding <tier>…Plan") — the required word between "Coding" and "Plan"
  // skips the bare nav label.
  let plan_name = null;
  const beforeStatus = text.match(/(GLM\s+Coding[^\n]*?Plan)\s*\n\s*(?:Valid|Invalid|Active|Expired|Gültig|Ungültig)/i);
  if (beforeStatus) {
    plan_name = beforeStatus[1].trim();
  } else {
    const tiered = text.match(/(GLM\s+Coding\s+\w[^\n]*?\bPlan)/i);
    if (tiered) plan_name = tiered[1].trim();
  }

  // Monthly price in USD: first "$16.2"-style token on the page.
  let price_usd = null;
  const priceMatch = text.match(/\$\s*([\d]+(?:\.\d+)?)/);
  if (priceMatch) {
    const p = parseFloat(priceMatch[1]);
    if (isFinite(p) && p > 0) price_usd = p;
  }

  // Auto-renew date: "Auto-renew on 2026.07.14"
  let auto_renew_date = null;
  const renewMatch = text.match(/Auto-renew\s+on\s+([\d.\-/]+)/i)
    || text.match(/(?:Verlängert|Erneuert)[^\n]*?([\d.\-/]{6,})/i);
  if (renewMatch) auto_renew_date = renewMatch[1].trim();

  return { plan_name, price_usd, auto_renew_date };
}

// Injected into the page. Reads the three quota cards from the usage view.
// Each card is "<label> … <N> % Used [ Reset Time: <ts> ]".
function scrapeZaiUsage() {
  const text = document.body.innerText || '';

  // Percentage that follows a quota label within a short window.
  const pctAfter = (labels) => {
    for (const label of labels) {
      const re = new RegExp(label + '[\\s\\S]{0,40}?(\\d+)\\s*%', 'i');
      const m = text.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (isFinite(n)) return { pct: n, end: (m.index ?? 0) + m[0].length };
      }
    }
    return { pct: null, end: -1 };
  };

  // Absolute reset timestamp that follows a label, e.g. "Reset Time: 2026-06-21 08:58".
  const resetAfter = (startIdx) => {
    if (startIdx < 0) return null;
    const tail = text.slice(startIdx, startIdx + 120);
    const m = tail.match(/Reset\s*Time\s*[:：]?\s*([\d]{4}-[\d]{2}-[\d]{2}[\sT][\d]{2}:[\d]{2})/i)
      || tail.match(/(?:Zurücksetzung|Reset)[^\n]*?([\d]{4}-[\d]{2}-[\d]{2}[\sT][\d]{2}:[\d]{2})/i);
    return m ? m[1].trim() : null;
  };

  const fiveHour = pctAfter(['5\\s*Hours?\\s*Quota', '5[- ]?Stunden']);
  const weekly = pctAfter(['Weekly\\s*Quota', 'Wöchentlich']);
  const monthly = pctAfter(['Total\\s*Monthly[^\\n]*Quota', 'Monatlich']);

  return {
    five_hour_pct: fiveHour.pct,
    weekly_pct: weekly.pct,
    weekly_reset: resetAfter(weekly.end),
    monthly_pct: monthly.pct,
    monthly_reset: resetAfter(monthly.end)
  };
}

// Poll a tab's body text until `predicate(text)` is true or the budget runs out.
// Returns the final text (possibly not matching) so callers can decide to skip.
async function waitForZaiContent(tabId, predicate, budgetMs = 12000, pollMs = 500) {
  const deadline = Date.now() + budgetMs;
  let lastText = '';
  while (Date.now() < deadline) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.body?.innerText || ''
      });
      lastText = res?.result || '';
      if (predicate(lastText)) return lastText;
    } catch {
      // executeScript can throw on a transient about:blank / auth host — retry.
    }
    await sleep(pollMs);
  }
  return lastText;
}

async function zaiSync() {
  let createdTabId = null;

  try {
    const existing = await chrome.tabs.query({ url: ZAI_TAB_MATCH });
    let tabId;
    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: ZAI_MY_PLAN_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
    }

    // --- Page 1: My Plan (price + plan name) ---
    await chrome.tabs.update(tabId, { url: ZAI_MY_PLAN_URL });
    await waitForTabReady(tabId, 30000);
    const planText = await waitForZaiContent(
      tabId,
      (t) => /GLM\s+Coding/i.test(t) && /\$\s*\d/.test(t)
    );

    // Login bounce / expiry: the console redirects to a login page that has
    // none of our labels. Skip cleanly instead of crashing or posting nulls.
    if (!/GLM\s+Coding/i.test(planText)) {
      const status = /sign\s*in|log\s*in|anmelden|login/i.test(planText)
        ? 'login_required'
        : 'no_plan_data';
      await chrome.storage.local.set({ last_zai_sync: Date.now(), last_zai_sync_status: status });
      console.log('z.ai-sync skipped:', status);
      return { skipped: true, reason: status };
    }

    const [planInj] = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeZaiPlan });
    const plan = planInj?.result || { plan_name: null, price_usd: null, auto_renew_date: null };

    // --- Page 2: Usage (quotas) ---
    await chrome.tabs.update(tabId, { url: ZAI_USAGE_URL });
    await waitForTabReady(tabId, 30000);
    const usageText = await waitForZaiContent(
      tabId,
      (t) => /Quota/i.test(t) || /Wöchentlich|Monatlich/i.test(t)
    );
    const [usageInj] = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeZaiUsage });
    const usage = usageInj?.result || {
      five_hour_pct: null, weekly_pct: null, weekly_reset: null, monthly_pct: null, monthly_reset: null
    };

    const data = {
      plan_name: plan.plan_name,
      price_usd: plan.price_usd,
      auto_renew_date: plan.auto_renew_date,
      five_hour_pct: usage.five_hour_pct,
      weekly_pct: usage.weekly_pct,
      weekly_reset: usage.weekly_reset,
      monthly_pct: usage.monthly_pct,
      monthly_reset: usage.monthly_reset,
      scraped_at: new Date().toISOString()
    };

    // Nothing usable scraped — don't POST an empty snapshot.
    if (
      data.five_hour_pct == null &&
      data.weekly_pct == null &&
      data.monthly_pct == null &&
      data.plan_name == null
    ) {
      await chrome.storage.local.set({ last_zai_sync: Date.now(), last_zai_sync_status: 'no_data' });
      console.log('z.ai-sync: no usage/plan figures found, skipping POST');
      return { skipped: true, reason: 'no_data' };
    }

    const apiBase = await getApiBase();
    const backendResponse = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'z.ai GLM Coding Plan (Sync)',
        input_tokens: 0,
        output_tokens: 0,
        conversation_id: `zai-sync-${Date.now()}`,
        source: 'zai_sync',
        response_metadata: data
      })
    });

    if (!backendResponse.ok) {
      throw new Error('Backend rejected zai-sync: ' + backendResponse.status);
    }

    await chrome.storage.local.set({
      last_zai_sync: Date.now(),
      last_zai_sync_data: data,
      last_zai_sync_status: 'ok'
    });

    console.log(
      `z.ai-sync ok: plan=${data.plan_name || 'unknown'} ` +
      `price=${data.price_usd != null ? '$' + data.price_usd : '?'} ` +
      `5h=${data.five_hour_pct}% W=${data.weekly_pct}% M=${data.monthly_pct}%`
    );
    return { success: true, data };
  } catch (error) {
    console.error('z.ai-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    trackTabCleanup(createdTabId);
  }
}
