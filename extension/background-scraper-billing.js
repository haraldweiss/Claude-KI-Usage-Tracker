// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Scrapes platform.claude.com/settings/billing for current balance and last top-up.

const BILLING_URL = 'https://platform.claude.com/settings/billing';

function scrapeBillingPage() {
  let balance_usd = null;
  let last_topup_usd = null;

  const allText = document.body.innerText || '';

  const balanceMatch = allText.match(/Credits[\s\S]{0,200}?\$\s*([\d,]+\.?\d*)/i) ||
                       allText.match(/\$\s*([\d,]+\.?\d*)[\s\S]{0,100}?Credits/i) ||
                       allText.match(/Balance[\s\S]{0,200}?\$\s*([\d,]+\.?\d*)/i);
  if (balanceMatch) {
    balance_usd = parseFloat(balanceMatch[1].replace(/,/g, ''));
  }

  const rows = [...document.querySelectorAll('tr, [role="row"]')];
  for (const row of rows) {
    const text = (row.textContent || '').toLowerCase();
    if (text.includes('add credits') || text.includes('payment') || text.includes('aufgeladen')) {
      const amountMatch = (row.textContent || '').match(/\$\s*([\d,]+\.?\d*)/);
      if (amountMatch) {
        last_topup_usd = parseFloat(amountMatch[1].replace(/,/g, ''));
        break;
      }
    }
  }

  return { balance_usd, last_topup_usd };
}

async function billingSync(externalTabId = null) {
  let createdTabId = null;

  try {
    let tabId;
    if (externalTabId !== null) {
      tabId = externalTabId;
    } else {
      const tab = await chrome.tabs.create({ url: BILLING_URL, active: true });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabReady(tabId, 30000);
    }

    await chrome.tabs.update(tabId, { url: BILLING_URL });
    await waitForTabReady(tabId, 30000);
    await sleep(3000);

    let data = { balance_usd: null, last_topup_usd: null };
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          func: scrapeBillingPage
        });
        const result = injection?.result;
        if (result && result.balance_usd !== null) {
          data = result;
          break;
        }
      } catch {}
      await sleep(500);
    }

    if (data.balance_usd === null) {
      console.warn('[billing-scraper] could not find balance on billing page');
      return { success: false, error: 'balance not found' };
    }

    const apiBase = await getApiBase();
    const response = await authFetch(`${apiBase}/usage/billing-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        balance_usd: data.balance_usd,
        last_topup_usd: data.last_topup_usd
      })
    });

    const result = await response.json();
    console.log(`[billing-scraper] balance=$${data.balance_usd} topup=$${data.last_topup_usd ?? '?'}`, result.alerts);

    if (result.alerts?.low_balance) {
      const pct = data.last_topup_usd
        ? Math.round((data.balance_usd / data.last_topup_usd) * 100)
        : '?';
      chrome.notifications.create('low_balance_alert', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '⚠️ Claude API Credits fast leer',
        message: `Nur noch $${data.balance_usd.toFixed(2)} (${pct}% des letzten Auflade-Betrags)`
      });
    }

    if (result.alerts?.rate_alert) {
      chrome.notifications.create('rate_alert', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '⚠️ Ungewöhnlich hoher API-Verbrauch',
        message: `Heute $${result.alerts.today_cost_usd?.toFixed(2) ?? '?'} — ungewöhnlich hoch`
      });
    }

    await chrome.storage.local.set({ last_billing_sync: Date.now() });
    return { success: true, alerts: result.alerts, balance_usd: data.balance_usd };
  } catch (err) {
    console.error('[billing-scraper] error:', err);
    return { success: false, error: err.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'low_balance_alert' || notificationId === 'rate_alert') {
    chrome.tabs.create({ url: 'https://wolfinisoftware.de/claudetracker/' });
  }
});
