// © 2026 Harald Weiss
// KI Usage Tracker — Pale Moon XUL Popup
// Uses XPCOM Components & XMLHttpRequest (no fetch() API)

const Cc = Components.classes;
const Ci = Components.interfaces;

var gPrefBranch = null;

function init() {
  try {
    gPrefBranch = Cc["@mozilla.org/preferences-service;1"]
                    .getService(Ci.nsIPrefService)
                    .getBranch("extensions.kiusagetracker.");
  } catch (ex) {
    console.error("[KI Tracker] prefs init error:", ex);
  }

  // Load saved settings
  var apiBase = getPref("api_base", "https://ki-usage-tracker.wolfinisoftware.de/api");
  var apiToken = getPref("api_token", "");
  document.getElementById("api-base-input").value = apiBase;
  document.getElementById("api-token-input").value = apiToken;

  refreshStats();
}

function getPref(name, def) {
  try {
    if (gPrefBranch) {
      var type = gPrefBranch.getPrefType(name);
      if (type === Ci.nsIPrefBranch.PREF_STRING) return gPrefBranch.getStringPref(name);
      if (type === Ci.nsIPrefBranch.PREF_INT) return gPrefBranch.getIntPref(name);
    }
  } catch (ex) { /* pref not set */ }
  return def;
}

function setPref(name, value) {
  try {
    if (gPrefBranch) {
      gPrefBranch.setStringPref(name, String(value));
    }
  } catch (ex) {
    console.error("[KI Tracker] setPref error:", ex);
  }
}

function saveSettings() {
  var apiBase = document.getElementById("api-base-input").value.trim();
  var apiToken = document.getElementById("api-token-input").value.trim();
  setPref("api_base", apiBase);
  setPref("api_token", apiToken);
  document.getElementById("status-label").value = "✅ Gespeichert.";
  refreshStats();
}

function refreshStats() {
  var apiBase = document.getElementById("api-base-input").value.trim() ||
                "https://ki-usage-tracker.wolfinisoftware.de/api";
  var apiToken = document.getElementById("api-token-input").value.trim();
  var statusLabel = document.getElementById("status-label");

  statusLabel.value = "Lade Daten…";

  try {
    var url = apiBase.replace(/\/+$/, "") + "/usage/summary?period=month";
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false); // synchronous for simplicity
    if (apiToken) {
      xhr.setRequestHeader("Authorization", "Bearer " + apiToken);
    }
    xhr.send();

    if (xhr.status === 200) {
      var data = JSON.parse(xhr.responseText);
      displayStats(data);
      statusLabel.value = "✅ Aktualisiert: " + new Date().toLocaleString("de-DE");
    } else {
      statusLabel.value = "❌ Backend-Fehler: " + xhr.status;
    }
  } catch (ex) {
    statusLabel.value = "❌ " + ex.message;
  }
}

function displayStats(data) {
  var cg = data && data.combined;
  if (!cg) {
    document.getElementById("grand-total-label").value = "Keine Daten";
    return;
  }

  // Grand total
  var caTotal = Number(cg.claude_ai && (cg.claude_ai.cost_eur || cg.claude_ai.total_eur || 0));
  var anthropicApiEur = Number(cg.anthropic_api && cg.anthropic_api.cost_eur_equivalent || 0);
  var codexEur = Number(cg.codex && (cg.codex.total_eur || 0));
  var openaiApiEur = Number(cg.openai_api && cg.openai_api.cost_usd || 0) * 0.92;
  var opencodeGoEur = (cg.opencode_go && cg.opencode_go.plan_name === "OpenCode Go") ? 20 : 10;
  var zaiEur = 15;

  var grandTotal = caTotal + anthropicApiEur + codexEur + openaiApiEur + opencodeGoEur + zaiEur;
  document.getElementById("grand-total-label").value = "Gesamt: " + formatEur(grandTotal);

  // Per-source rows
  setRow("row-claude-ai", formatCost(cg.claude_ai && cg.claude_ai.meta && cg.claude_ai.meta.spending_eur));
  setRow("row-anthropic-api", formatCost(cg.anthropic_api && cg.anthropic_api.cost_eur_equivalent));
  setRow("row-opencode-go", cg.opencode_go ? (cg.opencode_go.plan_name || "aktiv") : "—");
  setRow("row-zai", cg.zai ? (cg.zai.plan_name || "aktiv") : "—");
  setRow("row-codex", formatCost(cg.codex && cg.codex.total_eur));
  setRow("row-openai-api", cg.openai_api ? "$" + Number(cg.openai_api.cost_usd || 0).toFixed(2) : "—");

  document.getElementById("last-update-label").value = new Date().toLocaleString("de-DE");
}

function setRow(id, value) {
  var el = document.getElementById(id);
  if (el) el.value = value || "—";
}

function formatCost(val) {
  if (val === null || val === undefined || !isFinite(Number(val))) return "—";
  var n = Number(val);
  if (n === 0) return "€0,00";
  return formatEur(n);
}

function formatEur(value) {
  if (value === null || value === undefined || !isFinite(value)) return "0,00 €";
  return value.toFixed(2).replace(".", ",") + " €";
}

/**
 * Export cookies via nsICookieManager and upload to the server-scraper.
 */
function exportCookiesAndUpload() {
  var statusLabel = document.getElementById("status-label");
  statusLabel.value = "⏳ Cookies exportieren…";

  try {
    // Gather cookies from the opener window (the browser)
    var opener = window.opener;
    if (!opener || !opener.KiUsageTracker) {
      statusLabel.value = "❌ Kein Zugriff auf Browser-Fenster";
      return;
    }

    var cookies = opener.KiUsageTracker.exportCookies();
    if (!cookies || cookies.length === 0) {
      statusLabel.value = "❌ Keine relevanten Cookies gefunden";
      return;
    }

    // Upload to server
    var apiBase = document.getElementById("api-base-input").value.trim() ||
                  "https://ki-usage-tracker.wolfinisoftware.de/api";
    var apiToken = document.getElementById("api-token-input").value.trim();
    var uploadUrl = apiBase.replace(/\/+$/, "") + "/cookies/upload";

    var xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl, false);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (apiToken) xhr.setRequestHeader("Authorization", "Bearer " + apiToken);
    xhr.send(JSON.stringify({
      cookies: cookies,
      exported_at: new Date().toISOString()
    }));

    if (xhr.status === 200) {
      statusLabel.value = "✅ " + cookies.length + " Cookies exportiert + hochgeladen";
    } else {
      statusLabel.value = "❌ Upload-Fehler: " + xhr.status;
    }
  } catch (ex) {
    statusLabel.value = "❌ " + ex.message;
  }
}
