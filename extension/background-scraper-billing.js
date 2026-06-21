// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Scrapes platform.claude.com/settings/billing for current balance and last top-up.

const BILLING_URL = 'https://platform.claude.com/settings/billing';

function scrapeBillingPage() {
  // Parse German ("0,15") and English ("0.15") number formats
  function parseMoney(str) {
    return parseFloat(str.replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  }

  const allText = document.body.innerText || '';

  // Balance — DE: "0,15 $\nVerbleibendes Guthaben" | nav: "Credits\n0,15 USD"
  let balance_usd = null;
  const balancePatterns = [
    /([\d]+[,.]\d+)\s*\$[\s\S]{0,150}?Verbleibendes Guthaben/i,
    /Verbleibendes Guthaben[\s\S]{0,150}?([\d]+[,.]\d+)\s*(?:\$|USD)/i,
    /remaining credit[\s\S]{0,150}?([\d]+[,.]\d+)\s*(?:\$|USD)/i,
    /Credits[\s\n\r]+([\d]+[,.]\d+)\s+USD/i,
  ];
  for (const p of balancePatterns) {
    const m = allText.match(p);
    if (m) { balance_usd = parseMoney(m[1]); break; }
  }

  // Last top-up — DE: "Guthabenzuweisung" | EN: "Credit grant" / "Add credits"
  let last_topup_usd = null;
  const lines = allText.split('\n');
  for (const line of lines) {
    if (/Guthabenzuweisung|Credit grant|Add credits/i.test(line)) {
      const m = line.match(/([\d]+[,.]\d+)\s*(?:\$|USD)/);
      if (m) { last_topup_usd = parseMoney(m[1]); break; }
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
