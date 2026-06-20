function autoSyncSignature(d) {
  return AUTO_SYNC_SIGNATURE_FIELDS.map((f) => `${f}=${d?.[f] ?? ''}`).join('|');
}

// Poll a tab's body text until common usage-page markers appear, or budget
// runs out. Handles multi-step redirect chains (auth → target host) because
// executeScript errors are caught silently. Budget covers whole chain +
// React hydration on the target page.
async function waitForUsageContent(tabId, budgetMs = 60000, pollMs = 600) {
  const deadline = Date.now() + budgetMs;
  let lastText = '';
  while (Date.now() < deadline) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.body?.innerText || ''
      });
      lastText = res?.result || '';
      // Primary: usage markers (%, €, reset keywords)
      if (/\d+\s*%/.test(lastText) || /€/.test(lastText) ||
          /(?:Sitzung|session|Limit|limit|Reset|Zurücksetzung)/i.test(lastText)) {
        return lastText;
      }
      // Fallback: if "Lädt"/"Loading" has disappeared AND text is long
      // enough (>500 chars = sidebar + some main content), assume React has
      // rendered the billing/limits page.
      if (lastText.length > 500 && !/Lädt|Loading|Lade/i.test(lastText)) {
        return lastText;
      }
    } catch {
      // executeScript can throw on about:blank or auth host — retry
    }
    await sleep(pollMs);
  }
  return lastText;
}
async function autoSync(externalTabId = null) {
  let createdTabId = null;

  // Helper: navigate tab to a URL, wait for it to render, scrape, return data.
  async function tryUrl(tab, url) {
    try { await chrome.tabs.update(tab, { url }); } catch {}
    await waitForTabReady(tab, 30000);
    const text = await waitForUsageContent(tab, 30000);
    const info = await chrome.tabs.get(tab);
    return { text, url: info?.url || url };
  }

  try {
    // Try multiple URLs in order until one returns useful text (not just "Lädt").
    const urlsToTry = [
      USAGE_PAGE_URL,
      'https://platform.claude.com/settings/billing',
      'https://platform.claude.com/claude-code',
    ];
    // Add workspace-specific URLs from the console scraper's cache
    let wsSpecific = [];
    try {
      const cached = await chrome.storage.local.get('workspace_ids_cache');
      if (Array.isArray(cached.workspace_ids_cache)) {
        wsSpecific = cached.workspace_ids_cache
          .filter((w) => w?.id)
          .map((w) => `https://platform.claude.com/settings/workspaces/${w.id}/limits`);
      }
    } catch {}
    const allUrls = [...urlsToTry, ...wsSpecific];

    // If a shared tab was provided from syncAll, use it directly
    // without creating or reusing our own tab.
    let tabId = externalTabId;
    if (tabId === null) {
      // Find an existing claude.ai tab to reuse (avoids opening a new tab).
      for (const url of allUrls) {
        const existing = await chrome.tabs.query({ url });
        if (existing.length > 0) { tabId = existing[0].id; break; }
      }
    }

    let pageUrl = '';
    let lastText = '';
    const isReusedTab = tabId !== null;

    if (isReusedTab) {
      const t = await chrome.tabs.get(tabId);
      const onCorrectPage = t.url && t.url.includes('claude.ai/settings/usage') &&
        !t.url.includes('#');
      if (onCorrectPage) {
        // Already on the real settings/usage page — just poll
        lastText = await waitForUsageContent(tabId, 30000);
      } else {
        // Navigate directly to the usage URL (no hash trick — SPA hash navigation
        // triggers a client-side redirect that puts the tab in a transient state
        // where executeScript fails with "Cannot access contents").
        try { await chrome.tabs.update(tabId, { url: USAGE_PAGE_URL }); } catch {}
        await waitForTabReady(tabId, 30000);
        lastText = await waitForUsageContent(tabId, 30000);
      }
      const info = await chrome.tabs.get(tabId);
      pageUrl = info?.url || '';
    } else {
      // Open as active so Cloudflare's bot-detection doesn't trigger on a
      // hidden/inactive tab. The tab closes automatically in finally{}.
      const tab = await chrome.tabs.create({ url: allUrls[0], active: true });
      tabId = tab.id;
      createdTabId = tab.id;
      for (const url of allUrls) {
        try { await chrome.tabs.update(tabId, { url }); } catch {}
        await waitForTabReady(tabId, 30000);
        lastText = await waitForUsageContent(tabId, 30000);
        const info = await chrome.tabs.get(tabId);
        pageUrl = info?.url || url;
        if (!/Lädt|Loading|Lade/i.test(lastText) || /\d+\s*%/.test(lastText) || /€/.test(lastText)) {
          break;
        }
      }
    }

    // Verify we're on an accessible URL before injecting. If claude.ai redirected
    // to an auth domain (e.g. account.anthropic.com) that's not in host_permissions,
    // executeScript would throw the unhelpful "Cannot access contents" Chrome error.
    const tabInfo = await chrome.tabs.get(tabId);
    const tabUrl = tabInfo?.url || '';
    const isAccessible = tabUrl.startsWith('https://claude.ai/') ||
      tabUrl.startsWith('https://platform.claude.com/') ||
      tabUrl.startsWith('https://api.claude.ai/') ||
      tabUrl.startsWith('https://account.anthropic.com/');
    if (!isAccessible) {
      console.warn('[autoSync] Tab auf nicht-erlaubter Domain:', tabUrl);
      throw new Error(
        tabUrl
          ? `claude.ai hat auf eine unbekannte Domain weitergeleitet: ${new URL(tabUrl).hostname} — bitte in claude.ai einloggen`
          : 'claude.ai-Tab wurde nicht geladen — bitte einloggen'
      );
    }

    // Inject the scrape function directly via scripting API instead of relying
    // on the content script's message listener. This works even if the tab was
    // open before the extension was reloaded (where the content script would
    // be stale or absent and chrome.tabs.sendMessage fails with
    // "Receiving end does not exist").
    let injection;
    try {
      [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = document.body.innerText || '';

        const numAfter = (regex) => {
          const m = text.match(regex);
          if (!m) return null;
          const cleaned = m[1].replace(/\s/g, '').replace(',', '.');
          const n = parseFloat(cleaned);
          return isFinite(n) ? n : null;
        };

        // Plan name: appears near top of page, just after "Plan-Nutzungslimits"
        // (or "Plan usage limits" in English). The plan label is the next
        // non-empty line.
        let plan_name = null;
        const planLabelMatch = text.match(/Plan-Nutzungslimits\s*\n+\s*([^\n]+)/i)
          || text.match(/Plan usage limits\s*\n+\s*([^\n]+)/i);
        if (planLabelMatch) {
          const candidate = planLabelMatch[1].trim();
          if (candidate.length < 80) plan_name = candidate;
        }

        // Extract percentage and optional reset text around a section label.
        // The current layout puts the reset BETWEEN the label and the
        // percentage, older layouts put it AFTER or BEFORE. Search inside the
        // match body first, then after, then before. Accept "Zurücksetzung"
        // (with or without "in", e.g. "Zurücksetzung in 5 Min." or
        // "Zurücksetzung Do., 00:00") alongside "Reset" / "Reset in".
        const extractPctAndReset = (labels) => {
          for (const label of labels) {
            const pctRe = new RegExp(`${label}[\\s\\S]{0,200}?(\\d+)\\s*%`, 'i');
            const pctMatch = text.match(pctRe);
            if (!pctMatch) continue;
            const pct = parseInt(pctMatch[1], 10);
            const matchEnd = (pctMatch.index ?? 0) + pctMatch[0].length;

            const resetRe = /(?:Reset(?:\s+in)?|Zurücksetzung(?:\s+in)?)\s+([^\n·•]{1,60})/i;
            // Current layout: reset BETWEEN label and percentage
            let reset = pctMatch[0].match(resetRe)?.[1]?.trim() ?? null;

            // Legacy: reset AFTER the percentage
            if (!reset) {
              const tail = text.slice(matchEnd, matchEnd + 80);
              reset = tail.match(resetRe)?.[1]?.trim() ?? null;
            }

            // Legacy: reset BEFORE the label
            if (!reset) {
              const head = text.slice(Math.max(0, (pctMatch.index ?? 0) - 120), pctMatch.index ?? 0);
              reset = head.match(resetRe)?.[1]?.trim() ?? null;
            }

            return { pct, reset };
          }
          return { pct: null, reset: null };
        };

        const session = extractPctAndReset([
          'Aktuelle Sitzung',
          'Current session'
        ]);
        const session_pct = session.pct;
        const session_reset_in = session.reset;

        // Extract the absolute session limit (e.g. "5" from "5-Stunden-Limit" or
        // "5" from "5-hour limit"). The new layout only shows "Aktuelle Sitzung"
        // without the limit value — will be null unless Anthropic brings it back.
        // On platform.claude.com the label might be "Session limit".
        const session_limit_hours = (() => {
          const m = text.match(/(\d+)\s*-?(?:Stunden[- ]Limit|hour[- ]limit|Session[- ]limit)/i);
          return m ? parseInt(m[1], 10) : null;
        })();

        const allModels = extractPctAndReset([
          'Wöchentlich\\s*·\\s*alle Modelle',
          'Wöchentliche\\s*Limits',
          'Weekly\\s*·\\s*all models',
          'Weekly\\s*limits',
          'Alle Modelle',
          'All models'
        ]);
        const weekly_all_models_pct = allModels.pct;
        const weekly_all_models_reset_in = allModels.reset;

        const sonnet = extractPctAndReset([
          'Nur Sonnet',
          'Sonnet only'
        ]);
        const weekly_sonnet_pct = sonnet.pct;
        const weekly_sonnet_reset_in = sonnet.reset;

        // Additional usage block — three numbers we want:
        //   "31,35 € ausgegeben"  → spent_eur
        //   "63% verbraucht"       → spent_pct (of monthly limit)
        //   "50 €" Monatslimit     → monthly_limit_eur
        //   "20,50 €" Aktuelles Guthaben → balance_eur
        const spent_eur = numAfter(/([\d.,]+)\s*€\s*ausgegeben/i)
          ?? numAfter(/([\d.,]+)\s*€\s*spent/i);
        const spent_pct_match =
          text.match(/(\d+)\s*%\s*verbraucht/i) ||
          text.match(/(\d+)\s*%\s*used/i);
        const spent_pct = spent_pct_match ? parseInt(spent_pct_match[1], 10) : null;

        // Labels for "Monatliches Ausgabenlimit" and "Aktuelles Guthaben"
        // appear AFTER their values on the page. A naive regex grabs the
        // first "<n> €" anywhere on the page, which is the spent figure.
        // Walk lines instead and read the value from the line just above
        // each label.
        const lines = text.split('\n').map((s) => s.trim());
        const valueAboveLabel = (labels) => {
          for (let i = 1; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            for (const label of labels) {
              const labelLower = label.toLowerCase();
              // Match exact or as a prefix — Anthropic appends suffixes like
              // " · Automatisches Neuladen aus" to some labels.
              if (lower === labelLower || lower.startsWith(labelLower)) {
                for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
                  const m = lines[j].match(/([\d.,]+)\s*€/);
                  if (m) {
                    const n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
                    return isFinite(n) ? n : null;
                  }
                }
              }
            }
          }
          return null;
        };

        const monthly_limit_eur = valueAboveLabel([
          'Monatliches Ausgabenlimit',
          'Monthly spending limit',
          'Monthly spend limit'
        ]);
        const balance_eur = valueAboveLabel([
          'Aktuelles Guthaben',
          'Current balance'
        ]);

        // Reset date for the additional usage cycle ("Zurücksetzung am May 1")
        const resetMatch =
          text.match(/Zurücksetzung am\s+([^\n]{1,40})/i) ||
          text.match(/Resets on\s+([^\n]{1,40})/i);
        const reset_date = resetMatch ? resetMatch[1].trim() : null;

        return {
          plan_name,
          session_pct,
          session_reset_in,
          session_limit_hours,
          weekly_all_models_pct,
          weekly_all_models_reset_in,
          weekly_sonnet_pct,
          weekly_sonnet_reset_in,
          spent_eur,
          spent_pct,
          monthly_limit_eur,
          balance_eur,
          reset_date,
          scraped_at: new Date().toISOString(),
          // Diagnostic: include a page text excerpt so we can debug
          // scraping failures without asking the user to open DevTools.
          _page_preview: text.slice(0, 1500)
        };
      }
      });
    } catch (scriptErr) {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      const currentUrl = t?.url || 'unbekannt';
      console.warn('[autoSync] executeScript fehlgeschlagen, Tab-URL:', currentUrl);
      throw new Error(
        `claude.ai nicht zugänglich — bitte in claude.ai einloggen (Tab landet auf: ${currentUrl})`
      );
    }

    const data = injection?.result;
    if (!data) {
      throw new Error('Scrape returned no result');
    }
    if (data.spent_eur == null && data.weekly_all_models_pct == null) {
      return { skipped: true, reason: 'no_data', url: pageUrl, preview: data._page_preview };
    }

    const apiBase = await getApiBase();
    const backendResponse = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'Claude (Official Sync)',
        // Encode the headline numbers in the existing columns so the rest
        // of the dashboard keeps working without schema churn.
        // - cost goes through the pricing pipeline, so we'd lose precision;
        //   we send 0 here and rely on response_metadata for the truth.
        // - input_tokens and output_tokens carry the legacy fields the
        //   original scraper used (kept for backward compat: spent_eur*1000
        //   and weekly% respectively).
        input_tokens: Math.round((data.spent_eur || 0) * 1000),
        output_tokens: data.weekly_all_models_pct ?? 0,
        conversation_id: `auto-sync-${Date.now()}`,
        source: 'claude_official_sync',
        // Everything else lives here as JSON. Backend stores it verbatim.
        response_metadata: data
      })
    });

    if (!backendResponse.ok) {
      throw new Error('Backend rejected sync: ' + backendResponse.status);
    }

    // Track value-change history alongside the sync timestamp. The popup
    // surfaces "Werte unverändert seit X" so the user can spot the case
    // where the sync itself keeps succeeding but the scraped figures have
    // plateaued (e.g. claude.ai's settings page is cached and the numbers
    // haven't refreshed in hours).
    const sig = autoSyncSignature(data);
    const prev = await chrome.storage.local.get([
      'last_auto_sync_signature',
      'last_auto_sync_change_at'
    ]);
    const now = Date.now();
    const changed = prev.last_auto_sync_signature !== sig;
    await chrome.storage.local.set({
      last_auto_sync: now,
      last_auto_sync_signature: sig,
      last_auto_sync_change_at: changed ? now : (prev.last_auto_sync_change_at || now),
      last_auto_sync_data: data
    });
    updateBadge();
    console.log('Auto-sync ok');
    return { success: true, data };
  } catch (error) {
    console.error('Auto-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Plan B: console.anthropic.com scraping
//
// We can't use the Anthropic Admin Usage/Cost API (no admin key available),
// so we scrape the rendered keys table the same way we scrape claude.ai's
// usage page. Per-key cumulative cost is exactly what the Console shows in
// the "Cost" column of /settings/keys.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workspace discovery — inject observer into platform.claude.com tab, wait
// for React to render sidebar nav links, read from window.__wsLinks.
// ---------------------------------------------------------------------------
