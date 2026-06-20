async function opencodeGoSync(externalTabId = null) {
  let createdTabId = null;

  try {
    let tabId;

    if (externalTabId !== null) {
      tabId = externalTabId;
      // Shared tab from syncAll — navigate to the target URL since it's
      // currently on a different page from a previous scraper.
      const url = await getOpenCodeGoUrl();
      await chrome.tabs.update(tabId, { url });
      await waitForTabReady(tabId, 30000);
    } else {
      const existing = await chrome.tabs.query({ url: 'https://opencode.ai/workspace/wrk_01KSKQJKEA4AQ3KV75MPTVNR3R/go*' });
      if (existing.length > 0) {
        tabId = existing[0].id;
      } else {
        const url = await getOpenCodeGoUrl();
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        createdTabId = tab.id;
        await waitForTabComplete(tab.id, 30000);
      }
    }

    // opencode.ai always bounces through auth.opencode.ai/authorize on first
    // open, even when the user is logged in. Wait for the redirect chain to
    // land back on opencode.ai before scraping; otherwise executeScript hits
    // the auth host (not in manifest) and throws. If we never get back, it's
    // an actual login expiry — skip cleanly so the log isn't spammed.
    const landedUrl = await waitForUrlPrefix(tabId, 'https://opencode.ai/', 15000, 250);
    if (!landedUrl) {
      let reason = 'unknown';
      try {
        const t = await chrome.tabs.get(tabId);
        reason = t.url?.startsWith('https://auth.opencode.ai/')
          ? 'login_required'
          : `unexpected_url: ${t.url || '(none)'}`;
      } catch {}
      await chrome.storage.local.set({
        last_opencode_go_sync: Date.now(),
        last_opencode_go_sync_status: reason
      });
      console.log('OpenCode-go-sync skipped:', reason);
      return { skipped: true, reason };
    }
    await sleep(2000); // give React a moment to render the workspace view

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body.innerText || '';

        // Extract plan name: "Du hast OpenCode Go abonniert."
        let plan_name = null;
        const planMatch = text.match(/(?:Du hast|You have)\s+(.+?)\s+(?:abonniert|subscribed)/i);
        if (planMatch) {
          const candidate = planMatch[1].trim();
          if (candidate.length < 80) plan_name = candidate;
        }

        // Helper: extract percentage and reset text around a section label.
        // The opencode.ai layout has shifted: the reset phrase can appear BEFORE
        // or AFTER the percentage, and the wording drifts between releases
        // ("Setzt zurück in", "Zurücksetzung in", "Wird zurückgesetzt in",
        // "Resets in", …). Match all known variants and search both directions,
        // mirroring the claude.ai scraper above.
        const resetRe = /(?:Setzt\s+zur(?:ück)?(?:\s+in)?|Zurücksetzung(?:\s+in)?|Wird\s+zurückgesetzt(?:\s+in)?|Resets?(?:\s+in)?|Endet\s+in)\s+([^\n·•]{1,60})/i;
        const extractPctAndReset = (labels) => {
          for (const label of labels) {
            const pctRe = new RegExp(`${label}[\\s\\S]{0,200}?(\\d+)\\s*%`, 'i');
            const pctMatch = text.match(pctRe);
            if (!pctMatch) continue;
            const pct = parseInt(pctMatch[1], 10);
            const matchEnd = (pctMatch.index ?? 0) + pctMatch[0].length;

            // Current layout puts the reset phrase BETWEEN the section label
            // and the percentage — search inside the matched body first.
            let reset = pctMatch[0].match(resetRe)?.[1]?.trim() ?? null;

            // Legacy layout puts the reset AFTER the percentage — fall back
            // to scanning a window after the match.
            if (!reset) {
              const tail = text.slice(matchEnd, matchEnd + 200);
              reset = tail.match(resetRe)?.[1]?.trim() ?? null;
            }

            return { pct, reset };
          }
          return { pct: null, reset: null };
        };

        // Continuous / weekly / monthly usage. opencode.ai shortened the
        // section labels from "Fortlaufende Nutzung" → "Fortlaufend" etc.
        // The short forms appear directly above the percentage card, so we
        // prefer them; the negative lookahead `(?![a-zäöüß])` keeps
        // "Fortlaufend" from greedily matching "Fortlaufende" in older
        // layouts. The full labels stay as a safety fallback.
        const continuous = extractPctAndReset([
          'Fortlaufend(?![a-zäöüß])',
          'Continuous(?![a-z])',
          'Fortlaufende Nutzung',
          'Continuous usage'
        ]);
        const continuous_pct = continuous.pct;
        const continuous_reset_in = continuous.reset;

        const weekly = extractPctAndReset([
          'Wöchentlich(?![a-zäöüß])',
          'Weekly(?![a-z])',
          'Wöchentliche Nutzung',
          'Weekly usage'
        ]);
        const weekly_pct = weekly.pct;
        const weekly_reset_in = weekly.reset;

        const monthly = extractPctAndReset([
          'Monatlich(?![a-zäöüß])',
          'Monthly(?![a-z])',
          'Monatliche Nutzung',
          'Monthly usage'
        ]);
        const monthly_pct = monthly.pct;
        const monthly_reset_in = monthly.reset;

        return {
          plan_name,
          continuous_pct,
          continuous_reset_in,
          weekly_pct,
          weekly_reset_in,
          monthly_pct,
          monthly_reset_in,
          scraped_at: new Date().toISOString()
        };
      }
    });

    const data = injection?.result;
    if (!data) {
      throw new Error('OpenCode Go scrape returned no result');
    }
    if (data.continuous_pct == null && data.weekly_pct == null && data.monthly_pct == null) {
      console.log('OpenCode-go-sync: page returned no usage figures, skipping POST');
      return { skipped: true, reason: 'no_data' };
    }

    const apiBase = await getApiBase();
    const backendResponse = await authFetch(`${apiBase}/usage/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'OpenCode Go (Sync)',
        input_tokens: 0,
        output_tokens: 0,
        conversation_id: `opencode-go-sync-${Date.now()}`,
        source: 'opencode_go_sync',
        response_metadata: data
      })
    });

    if (!backendResponse.ok) {
      throw new Error('Backend rejected opencode-go-sync: ' + backendResponse.status);
    }

    await chrome.storage.local.set({
      last_opencode_go_sync: Date.now(),
      last_opencode_go_sync_data: data,
      last_opencode_go_sync_status: 'ok'
    });

    console.log(`OpenCode-go-sync ok: plan=${data?.plan_name || 'unknown'}`);
    return { success: true, data };
  } catch (error) {
    console.error('OpenCode-go-sync error:', error);
    return { success: false, error: error.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch {}
    }
  }
}
