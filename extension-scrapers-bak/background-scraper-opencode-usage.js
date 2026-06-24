// background-scraper-opencode-usage.js
// Scrapes https://opencode.ai/workspace/<id>/usage — a per-API-key usage table
// with individual transaction rows (date, model, input tokens, output tokens,
// cost, session).
//
// Three options in one scraper:
//   A — per-key monthly totals (one POST per key, aggregated)
//   B — "Alle Keys" grand total (one POST for the sum across all keys)
//   C — individual transaction rows (one POST per row, deduped by session+model)
//
// Daily cadence (24h alarm). Daily snapshot dedup: all opencode_api_sync rows
// for the current day are deleted before inserting fresh ones.

async function opencodeApiUsageSync(externalTabId) {
  var createdTabId = null;

  try {
    var tabId;

    if (externalTabId !== null && externalTabId !== undefined) {
      tabId = externalTabId;
      var url = await getOpenCodeUsageUrl();
      await chrome.tabs.update(tabId, { url: url });
      await waitForTabReady(tabId, 30000);
    } else {
      var url2 = await getOpenCodeUsageUrl();
      var tab = await chrome.tabs.create({ url: url2, active: true });
      tabId = tab.id;
      createdTabId = tab.id;
      await waitForTabComplete(tab.id, 30000);
    }

    // Wait for the auth redirect chain to complete
    var landedUrl = await waitForUrlPrefix(tabId, 'https://opencode.ai/', 20000, 250);
    if (!landedUrl) {
      var reason = 'unknown';
      try {
        var t = await chrome.tabs.get(tabId);
        reason = t.url && t.url.indexOf('https://auth.opencode.ai/') === 0
          ? 'login_required'
          : 'unexpected_url: ' + (t.url || '(none)');
      } catch (e) {}
      console.log('OpenCode-API-usage-sync skipped:', reason);
      return { skipped: true, reason: reason };
    }
    await sleep(3000);

    // Step 1: scrape "Alle Keys" view (Options B + C)
    var allKeysData = await scrapeUsagePage(tabId);
    if (!allKeysData || !allKeysData.rows || allKeysData.rows.length === 0) {
      var diagInfo = allKeysData.diag ? JSON.stringify(allKeysData.diag) : 'no_diag';
      console.log('OpenCode-API-usage-sync: no rows found. Diag:', diagInfo);
      return { skipped: true, reason: 'no_rows', diag: allKeysData?.diag };
    }

    // Step 2: discover individual key names from the dropdown (Option A)
    var keyNames = await discoverKeyNames(tabId);

    // Step 3: for each individual key, scrape filtered data
    var perKeyData = [];
    for (var ki = 0; ki < keyNames.length; ki++) {
      var keyName = keyNames[ki];
      var rows = await switchToKeyAndScrape(tabId, keyName);
      if (rows && rows.length > 0) {
        perKeyData.push({ key_name: keyName, rows: rows });
      }
    }

    // Step 4: aggregate and POST to backend
    var apiBase = await getApiBase();
    var posted = { individual: 0, aggregates: 0, grand_total: 0 };

    // ---- Option B: Alle Keys grand total ----
    var grandTotal = aggregateRows(allKeysData.rows);
    try {
      await authFetch(apiBase + '/usage/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'OpenCode API (Alle Keys)',
          input_tokens: grandTotal.total_input,
          output_tokens: grandTotal.total_output,
          conversation_id: 'opencode-api-aggr-alle-keys-' + todayDateString(),
          source: 'opencode_api_sync',
          key_name: null,
          cost_usd: grandTotal.total_cost,
          response_metadata: {
            type: 'grand_total',
            total_rows: grandTotal.row_count,
            model_breakdown: grandTotal.model_breakdown,
            scraped_at: new Date().toISOString()
          }
        })
      });
      posted.grand_total = 1;
    } catch (err) {
      console.error('OpenCode-API-usage-sync grand-total POST failed:', err);
    }

    // ---- Option A: per-key aggregates ----
    if (perKeyData.length > 0) {
      for (var pi = 0; pi < perKeyData.length; pi++) {
        var entry = perKeyData[pi];
        var agg = aggregateRows(entry.rows);
        try {
          await authFetch(apiBase + '/usage/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'OpenCode API',
              input_tokens: agg.total_input,
              output_tokens: agg.total_output,
              conversation_id: 'opencode-api-aggr-' + sanitizeKeyName(entry.key_name) + '-' + todayDateString(),
              source: 'opencode_api_sync',
              key_name: entry.key_name,
              cost_usd: agg.total_cost,
              response_metadata: {
                type: 'per_key_aggregate',
                key_name: entry.key_name,
                total_rows: agg.row_count,
                model_breakdown: agg.model_breakdown,
                scraped_at: new Date().toISOString()
              }
            })
          });
          posted.aggregates += 1;
        } catch (err) {
          console.error('OpenCode-API-usage-sync aggregate failed for key ' + entry.key_name + ':', err);
        }
      }
    }

    // ---- Option C: individual rows ----
    for (var ri = 0; ri < allKeysData.rows.length; ri++) {
      var row = allKeysData.rows[ri];
      try {
        var convId = row.session_id
          ? 'opencode-row-' + sanitizeKeyName(row.session_id) + '-' + row.model + '-' + row.date_ts
          : 'opencode-row-' + row.model + '-' + row.date_ts + '-' + row.input_tokens + '-' + row.output_tokens;
        await authFetch(apiBase + '/usage/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: row.model,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            conversation_id: convId,
            source: 'opencode_api_sync',
            key_name: row.key_name || null,
            cost_usd: row.cost_usd,
            response_metadata: {
              type: 'individual_row',
              event_date: row.event_date,
              session_id: row.session_id || null,
              key_name: row.key_name || null,
              scraped_at: new Date().toISOString()
            }
          })
        });
        posted.individual += 1;
      } catch (err) {
        if (posted.individual === 0) {
          console.error('OpenCode-API-usage-sync first individual row POST failed:', err);
        }
      }
    }

    await chrome.storage.local.set({
      last_opencode_api_usage_sync: Date.now(),
      last_opencode_api_usage_sync_status: 'ok',
      last_opencode_api_usage_sync_data: {
        keys_discovered: keyNames.length,
        individual_rows: posted.individual,
        aggregates: posted.aggregates,
        grand_total: posted.grand_total,
        total_rows: allKeysData.rows.length
      }
    });

    console.log('OpenCode-API-usage-sync ok: ' + posted.individual + ' rows, ' +
      posted.aggregates + ' per-key aggregates, ' +
      posted.grand_total + ' grand total, ' +
      keyNames.length + ' keys discovered');

    return {
      success: true,
      posted: posted,
      keys_discovered: keyNames.length,
      total_rows: allKeysData.rows.length
    };
  } catch (error) {
    console.error('OpenCode-API-usage-sync error:', error);
    await chrome.storage.local.set({
      last_opencode_api_usage_sync: Date.now(),
      last_opencode_api_usage_sync_status: 'error: ' + (error.message || String(error))
    });
    return { success: false, error: error.message };
  } finally {
    if (createdTabId !== null) {
      try { await chrome.tabs.remove(createdTabId); } catch (e) {}
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOpenCodeUsageUrl() {
  try {
    var stored = await chrome.storage.local.get('opencode_usage_url');
    if (typeof stored.opencode_usage_url === 'string' && stored.opencode_usage_url.length > 0) {
      return stored.opencode_usage_url;
    }
  } catch (e) {}
  // Default: derive from the Go workspace URL
  var goUrl = await getOpenCodeGoUrl();
  return goUrl.replace(/\/go(?:\/.*)?$/, '/usage') + '';
}

function sanitizeKeyName(name) {
  return (name || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function aggregateRows(rows) {
  var total_input = 0;
  var total_output = 0;
  var total_cost = 0;
  var modelBreakdown = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    total_input += row.input_tokens;
    total_output += row.output_tokens;
    total_cost += row.cost_usd;
    if (!modelBreakdown[row.model]) {
      modelBreakdown[row.model] = { input: 0, output: 0, cost: 0, count: 0 };
    }
    modelBreakdown[row.model].input += row.input_tokens;
    modelBreakdown[row.model].output += row.output_tokens;
    modelBreakdown[row.model].cost += row.cost_usd;
    modelBreakdown[row.model].count += 1;
  }

  return {
    total_input: total_input,
    total_output: total_output,
    total_cost: total_cost,
    row_count: rows.length,
    model_breakdown: modelBreakdown
  };
}

// ---------------------------------------------------------------------------
// Page scraping — injected into the tab
// ---------------------------------------------------------------------------

function scrapeUsageTableInjected() {
  function normalizeOpenCodeDateInjected(dateStr) {
    if (!dateStr) return new Date().toISOString().slice(0, 10);
    try {
      var d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch (e) {}
    return new Date().toISOString().slice(0, 10);
  }

  var diag = { tables_seen: 0, rows_found: 0, method: 'none' };
  var rows = [];

  // ---------- Try DOM-based ----------
  // Try <table> elements first, then ARIA roles (div-based grids)
  var tables = Array.from(document.querySelectorAll('table'));
  var ariaTables = Array.from(document.querySelectorAll('[role="table"], [role="grid"]'));
  if (tables.length === 0 && ariaTables.length > 0) {
    tables = ariaTables;
  }
  diag.tables_seen = tables.length;

  for (var ti = 0; ti < tables.length; ti++) {
    var table = tables[ti];
    // Support both real <table> and ARIA grid (div-based tables)
    var isAria = table.getAttribute('role') === 'table' || table.getAttribute('role') === 'grid';
    var headerEls = table.querySelectorAll('thead th, thead td, [role="columnheader"]');
    var headers = Array.from(headerEls).map(function(h) { return h.textContent.trim().toLowerCase(); });
    if (headers.length === 0) continue;

    var hasMatch = headers.some(function(h) { return /datum|date|model|modell|input|output|kosten|cost|sitzung|session/i.test(h); });
    if (!hasMatch) {
      var firstRow = table.querySelector('tbody tr:first-child, tr:first-child');
      if (!firstRow) continue;
      var firstCells = Array.from(firstRow.querySelectorAll('td, th'));
      var firstTexts = firstCells.map(function(c) { return c.textContent.trim().toLowerCase(); });
      var firstMatch = firstTexts.some(function(h) { return /datum|date|model|modell|input|output|kosten|cost/i.test(h); });
      if (!firstMatch) continue;
      for (var fi = 0; fi < firstTexts.length; fi++) {
        if (headers[fi] === undefined) headers[fi] = firstTexts[fi] || '';
      }
    }

    var colMap = { date: -1, model: -1, input: -1, output: -1, cost: -1, session: -1 };
    var matchAny = function(text, needles) { return needles.some(function(n) { return text.indexOf(n) >= 0; }); };
    for (var hi = 0; hi < headers.length; hi++) {
      var h = headers[hi];
      if (colMap.date === -1 && matchAny(h, ['datum', 'date', 'zeit', 'time'])) colMap.date = hi;
      if (colMap.model === -1 && matchAny(h, ['modell', 'model'])) colMap.model = hi;
      if (colMap.input === -1 && (h === 'input' || h === 'in' || h.indexOf('input') >= 0)) colMap.input = hi;
      if (colMap.output === -1 && (h === 'output' || h === 'out' || h.indexOf('output') >= 0)) colMap.output = hi;
      if (colMap.cost === -1 && matchAny(h, ['kosten', 'cost', 'preis', 'price', 'usd', '$'])) colMap.cost = hi;
      if (colMap.session === -1 && matchAny(h, ['sitzung', 'session', 'conversation', 'id'])) colMap.session = hi;
    }

    if (colMap.model === -1 || (colMap.input === -1 && colMap.cost === -1)) continue;

    var tbody = table.querySelector('tbody');
    var tableRows = tbody
      ? Array.from(tbody.querySelectorAll('tr, [role="row"]'))
      : Array.from(table.querySelectorAll('tr, [role="row"]'));
    // Remove header row if mixed in
    if (!tbody) {
      // Use header detection — skip row if it contains header texts
      tableRows = tableRows.filter(function(r) {
        var txt = (r.textContent || '').trim().toLowerCase();
        return !/datum|date|modell|model|input|output|kosten|cost/i.test(txt);
      });
    }

    for (var ri = 0; ri < tableRows.length; ri++) {
      var tr = tableRows[ri];
      var cells = Array.from(tr.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
      if (cells.length < 2) continue;

      var rawDate = colMap.date >= 0 ? (cells[colMap.date]?.textContent || '').trim() : '';
      var model = colMap.model >= 0 ? (cells[colMap.model]?.textContent || '').trim() : '';
      var rawInput = colMap.input >= 0 ? (cells[colMap.input]?.textContent || '').trim() : '0';
      var rawOutput = colMap.output >= 0 ? (cells[colMap.output]?.textContent || '').trim() : '0';
      var rawCost = colMap.cost >= 0 ? (cells[colMap.cost]?.textContent || '').trim() : '$0';
      var session = colMap.session >= 0 ? (cells[colMap.session]?.textContent || '').trim() : '';

      if (!model) continue;

      var inputTokens = parseInt(rawInput.replace(/[^0-9]/g, '')) || 0;
      var outputTokens = parseInt(rawOutput.replace(/[^0-9]/g, '')) || 0;
      var costUsd = parseFloat(rawCost.replace(/[^0-9.]/g, '')) || 0;

      rows.push({
        event_date: rawDate,
        date_ts: normalizeOpenCodeDateInjected(rawDate),
        model: model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        session_id: session || null,
        key_name: null
      });
    }

    if (rows.length > 0) {
      diag.method = 'dom';
      diag.rows_found = rows.length;
      return { rows: rows, diag: diag };
    }
  }

  // ---------- Fallback: text-based row extraction ----------
  var text = document.body.innerText || '';

  var headerMatch = text.match(/(?:Datum|Date).*(?:Modell|Model).*(?:Input|In).*(?:Output|Out).*(?:Kosten|Cost).*(?:Sitzung|Session)/i);
  if (!headerMatch) {
    diag.method = 'text_no_header';
    return { rows: rows, diag: diag };
  }

  var dateRe = /([A-Z][a-z]{2}\s+\d{1,2},\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
  var dateMatch;
  var rowStarts = [];
  while ((dateMatch = dateRe.exec(text)) !== null) {
    rowStarts.push({ index: dateMatch.index, date: dateMatch[1].trim() });
  }

  for (var ri2 = 0; ri2 < rowStarts.length; ri2++) {
    var start = rowStarts[ri2];
    var end = ri2 + 1 < rowStarts.length ? rowStarts[ri2 + 1].index : text.length;
    var block = text.slice(start.index, end);

    var modelMatch = block.match(/[A-Z][a-z]{2}\s+\d{1,2},\s*\d{1,2}:\d{2}(?:\s*AM|PM)?\s+([A-Za-z0-9_.\-\/]+)/);
    var model2 = modelMatch ? modelMatch[1].trim() : '';

    var numbers = block.match(/(\d{3,})/g) || [];
    var costMatch = block.match(/\$?(\d+\.\d+)/);

    var inputTokens2 = numbers.length >= 1 ? parseInt(numbers[0], 10) : 0;
    var outputTokens2 = numbers.length >= 2 ? parseInt(numbers[1], 10) : 0;
    var costUsd2 = costMatch ? parseFloat(costMatch[1]) : 0;

    var sessionMatch = block.match(/[0-9a-fA-F-]{8,}/);
    var sessionId2 = sessionMatch ? sessionMatch[0] : null;

    if (model2) {
      rows.push({
        event_date: start.date,
        date_ts: normalizeOpenCodeDateInjected(start.date),
        model: model2,
        input_tokens: inputTokens2,
        output_tokens: outputTokens2,
        cost_usd: costUsd2,
        session_id: sessionId2 || null,
        key_name: null
      });
    }
  }

  diag.method = 'text';
  diag.rows_found = rows.length;
  return { rows: rows, diag: diag };
}



// ---------------------------------------------------------------------------
// Key discovery
// ---------------------------------------------------------------------------

async function discoverKeyNames(tabId) {
  try {
    var result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        var keys = [];

        // Try <select> elements
        var selects = document.querySelectorAll('select');
        for (var si = 0; si < selects.length; si++) {
          var sel = selects[si];
          var label = (sel.getAttribute('aria-label') || sel.name || sel.id || '').toLowerCase();
          if (label.indexOf('key') >= 0 || label.indexOf('schlüssel') >= 0 || label.indexOf('api') >= 0) {
            for (var oi = 0; oi < sel.options.length; oi++) {
              var text = sel.options[oi].textContent.trim();
              if (text && text !== 'Alle Keys' && text !== 'All Keys' && text !== '—') {
                keys.push(text);
              }
            }
            if (keys.length > 0) return keys;
          }
        }

        // Try ARIA combobox
        var combos = document.querySelectorAll('[role="combobox"], [role="listbox"]');
        for (var ci = 0; ci < combos.length; ci++) {
          var combo = combos[ci];
          var items = combo.querySelectorAll('[role="option"], option');
          for (var ii = 0; ii < items.length; ii++) {
            var text2 = items[ii].textContent.trim();
            if (text2 && text2 !== 'Alle Keys' && text2 !== 'All Keys' && text2 !== '—') {
              keys.push(text2);
            }
          }
          if (keys.length > 0) return keys;
        }

        // Fallback: pattern match from text
        var bodyText = document.body.innerText || '';
        var matches = bodyText.match(/[A-Za-z0-9_-]{4,40}/g) || [];
        var uniq = [];
        var seen = {};
        for (var mi = 0; mi < matches.length; mi++) {
          var m = matches[mi];
          if (seen[m]) continue;
          seen[m] = true;
          if (/^(?:Alle|All|Keys|Modelle|Models|Datum|Date|Modell|Model|Input|Output|Kosten|Cost|Sitzung|Session|Nutzungsverlauf|Zurück|June|July|Monthly|Weekly|Continuous|Fortlaufend|Wöchentlich|Monatlich|Reset|Resets|in|In)$/i.test(m)) continue;
          if (m.length >= 4 && m.length <= 40) uniq.push(m);
          if (uniq.length >= 20) break;
        }
        return uniq;
      }
    });

    var keys = (result && result[0] && result[0].result) || [];
    var unique = [];
    var seen2 = {};
    for (var ki = 0; ki < keys.length; ki++) {
      if (!seen2[keys[ki]]) {
        seen2[keys[ki]] = true;
        unique.push(keys[ki]);
      }
    }
    return unique;
  } catch (e) {
    console.warn('OpenCode-API-usage key discovery failed:', e.message);
    return [];
  }
}

async function switchToKeyAndScrape(tabId, keyName) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(name) {
        // Try <select> approach
        var selects = document.querySelectorAll('select');
        for (var si = 0; si < selects.length; si++) {
          var sel = selects[si];
          var label = (sel.getAttribute('aria-label') || sel.name || sel.id || '').toLowerCase();
          if (label.indexOf('key') >= 0 || label.indexOf('schlüssel') >= 0 || label.indexOf('api') >= 0) {
            for (var oi = 0; oi < sel.options.length; oi++) {
              if (sel.options[oi].textContent.trim() === name) {
                sel.selectedIndex = oi;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
          }
        }

        // Try ARIA combobox
        var items = document.querySelectorAll('[role="option"]');
        for (var ii = 0; ii < items.length; ii++) {
          if (items[ii].textContent.trim() === name) {
            items[ii].click();
            return true;
          }
        }

        return false;
      },
      args: [keyName]
    });

    await sleep(2000);

    var result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: scrapeUsageTableInjected
    });

    var data = (result && result[0] && result[0].result);
    if (data && Array.isArray(data.rows) && data.rows.length > 0) {
      for (var ri = 0; ri < data.rows.length; ri++) {
        data.rows[ri].key_name = keyName;
      }
      return data.rows;
    }
    return [];
  } catch (e) {
    console.warn('OpenCode-API-usage key switch failed for "' + keyName + '":', e.message);
    return [];
  }
}

async function scrapeUsagePage(tabId) {
  var result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: scrapeUsageTableInjected
  });
  return (result && result[0] && result[0].result) || { rows: [], diag: {} };
}
