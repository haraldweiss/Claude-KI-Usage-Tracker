function autoSyncSignature(d) {
  return AUTO_SYNC_SIGNATURE_FIELDS.map((f) => `${f}=${d?.[f] ?? ''}`).join('|');
}

async function autoSync() {
  let createdTabId = null;

  try {
    // Reuse an existing tab if the user already has one open
    const existing = await chrome.tabs.query({ url: 'https://claude.ai/settings/usage*' });
    let tabId;

    if (existing.length > 0) {
      tabId = existing[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: USAGE_PAGE_URL, active: false });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabComplete(tab.id, 30000);
      // Give React a moment to render the usage figures
      await sleep(4000);
    }

    // Inject the scrape function directly via scripting API instead of relying
    // on the content script's message listener. This works even if the tab was
    // open before the extension was reloaded (where the content script would
    // be stale or absent and chrome.tabs.sendMessage fails with
    // "Receiving end does not exist").
    const [injection] = await chrome.scripting.executeScript({
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
        const session_limit_hours = (() => {
          const m = text.match(/(\d+)\s*-?(?:Stunden[- ]Limit|hour[- ]limit)/i);
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
          scraped_at: new Date().toISOString()
        };
      }
    });

    const data = injection?.result;
    if (!data) {
      throw new Error('Scrape returned no result');
    }
    if (data.spent_eur == null && data.weekly_all_models_pct == null) {
      return { skipped: true, reason: 'no_data' };
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
