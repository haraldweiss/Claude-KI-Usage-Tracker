// © 2026 Harald Weiss
// KI Usage Tracker — Pale Moon XUL Popup
// Uses XPCOM Components & XMLHttpRequest (no fetch() API)
//
// Storage: JSON file in profile directory (ProfD/ki-usage-tracker-settings.json).
// Reason: nsIPrefBranch.setStringPref does not flush to disk reliably in Pale
// Moon bootstrap extensions; reopening the popup after restart loses the token.

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// Settings defaults
const SETTINGS_DEFAULTS = {
  api_base: "https://ki-usage-tracker.wolfinisoftware.de/api",
  api_token: ""
};

var gSettings = null; // in-memory copy, synced to file on save

// ========== File-based storage in profile directory ==========

function settingsFilePath() {
  try {
    var profD = Cc["@mozilla.org/file/directory_service;1"]
                 .getService(Ci.nsIProperties)
                 .get("ProfD", Ci.nsIFile);
    var file = profD.clone();
    file.append("ki-usage-tracker-settings.json");
    return file;
  } catch (ex) {
    console.error("[KI Tracker] settingsFilePath error:", ex);
    return null;
  }
}

function loadSettings() {
  try {
    var file = settingsFilePath();
    if (!file || !file.exists()) {
      gSettings = {};
      return;
    }
    var stream = Cc["@mozilla.org/network/file-input-stream;1"]
                  .createInstance(Ci.nsIFileInputStream);
    stream.init(file, -1, 0, 0);
    var content = Cc["@mozilla.org/scriptableinputstream;1"]
                    .createInstance(Ci.nsIScriptableInputStream);
    content.init(stream);
    var raw = content.read(content.available());
    content.close();
    stream.close();
    gSettings = JSON.parse(raw) || {};
  } catch (ex) {
    console.error("[KI Tracker] loadSettings error:", ex);
    gSettings = {};
  }
}

function saveSettingsToFile() {
  try {
    var file = settingsFilePath();
    if (!file) return;
    var stream = Cc["@mozilla.org/network/file-output-stream;1"]
                  .createInstance(Ci.nsIFileOutputStream);
    // PR_WRONLY | PR_CREATE_FILE | PR_TRUNCATE = 0x02 | 0x08 | 0x20 = 0x2A
    stream.init(file, 0x2A, 0o644, 0);
    var data = JSON.stringify(gSettings || {}, null, 2);
    stream.write(data, data.length);
    stream.close();
  } catch (ex) {
    console.error("[KI Tracker] saveSettingsToFile error:", ex);
  }
}

function getSetting(key, def) {
  if (gSettings && key in gSettings) return gSettings[key];
  return def;
}

function setSetting(key, value) {
  if (!gSettings) gSettings = {};
  gSettings[key] = value;
}

// ========== Initialization ==========

function init() {
  loadSettings();

  // Load saved settings (with defaults fallback)
  var apiBase = getSetting("api_base", SETTINGS_DEFAULTS.api_base);
  var apiToken = getSetting("api_token", SETTINGS_DEFAULTS.api_token);
  document.getElementById("api-base-input").value = apiBase;
  document.getElementById("api-token-input").value = apiToken;

  refreshStats();
}

function saveSettings() {
  var apiBase = document.getElementById("api-base-input").value.trim();
  var apiToken = document.getElementById("api-token-input").value.trim();
  setSetting("api_base", apiBase);
  setSetting("api_token", apiToken);
  saveSettingsToFile();
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

  var rate = (cg.exchange_rate && cg.exchange_rate.usd_to_eur) || 0.92;

  // Individual costs
  var claudeAiEur = cg.claude_ai
    ? Number(cg.claude_ai.cost_eur || cg.claude_ai.total_eur || 0) + Number((cg.claude_ai.meta && cg.claude_ai.meta.spending_eur) || 0)
    : 0;
  var anthropicApiEur = Number(cg.anthropic_api && cg.anthropic_api.cost_eur_equivalent || 0);
  var opencodeGoEur = (cg.opencode_go && cg.opencode_go.plan_name === "OpenCode Go") ? 20 : 10;
  var opencodeApiEur = cg.opencode_api
    ? Number(cg.opencode_api.total_cost_usd || 0) * rate
    : 0;
  var zaiEur = 15;
  var codexEur = cg.codex
    ? Number(cg.codex.plan_cost_eur || 0)
    : 0;
  var openaiApiEur = cg.openai_api
    ? Number(cg.openai_api.cost_usd || 0) * rate
    : 0;
  var clineEur = cg.cline && cg.cline.plan_cost_eur
    ? Number(cg.cline.plan_cost_eur)
    : 10;

  var grandTotal = claudeAiEur + anthropicApiEur + opencodeGoEur + opencodeApiEur + zaiEur + codexEur + openaiApiEur + clineEur;
  document.getElementById("grand-total-label").value = "Gesamt: " + formatEur(grandTotal);

  // Per-source rows
  setRow("row-claude-ai", formatCost(claudeAiEur > 0 ? claudeAiEur : (cg.claude_ai && cg.claude_ai.meta && cg.claude_ai.meta.spending_eur)));
  setRow("row-anthropic-api", formatCost(anthropicApiEur));
  setRow("row-claude-code", cg.claude_code ? cg.claude_code.length + " Keys" : "—");
  setRow("row-opencode-go", cg.opencode_go ? (cg.opencode_go.plan_name || "aktiv") : "—");
  setRow("row-opencode-api", formatCost(opencodeApiEur));
  setRow("row-zai", cg.zai ? (cg.zai.plan_name || "aktiv") : "—");
  setRow("row-cline", cg.cline && cg.cline.plan_name ? cg.cline.plan_name + " " + formatEur(clineEur) : (clineEur > 0 ? formatEur(clineEur) + "/Monat" : "—"));
  setRow("row-codex", cg.codex ? (cg.codex.plan_name || "ChatGPT Plus") + " " + formatEur(codexEur) : "—");
  setRow("row-openai-api", cg.openai_api ? "$" + Number(cg.openai_api.cost_usd || 0).toFixed(2) : "—");

  // Usage details
  var detailElOCG = document.getElementById("detail-opencode-go");
  var detailElZai = document.getElementById("detail-zai");
  var detailElCodex = document.getElementById("detail-codex");

  // OpenCode Go usage %
  if (cg.opencode_go && (cg.opencode_go.continuous_pct != null || cg.opencode_go.weekly_pct != null || cg.opencode_go.monthly_pct != null)) {
    var parts = [];
    if (cg.opencode_go.continuous_pct != null) parts.push("Rollend: " + cg.opencode_go.continuous_pct + "%");
    if (cg.opencode_go.weekly_pct != null) parts.push("Wöchentlich: " + cg.opencode_go.weekly_pct + "%");
    if (cg.opencode_go.monthly_pct != null) parts.push("Monatlich: " + cg.opencode_go.monthly_pct + "%");
    detailElOCG.value = "OpenCode Go: " + parts.join(" | ");
  } else {
    detailElOCG.value = "";
  }

  // z.ai usage %
  if (cg.zai && (cg.zai.five_hour_pct != null || cg.zai.weekly_pct != null || cg.zai.monthly_pct != null)) {
    var parts = [];
    if (cg.zai.five_hour_pct != null) parts.push("5h: " + cg.zai.five_hour_pct + "%");
    if (cg.zai.weekly_pct != null) parts.push("Wöchentlich: " + cg.zai.weekly_pct + "%");
    if (cg.zai.monthly_pct != null) parts.push("Monatlich: " + cg.zai.monthly_pct + "%");
    detailElZai.value = "z.ai: " + parts.join(" | ");
  } else {
    detailElZai.value = "";
  }

  // ChatGPT Plus / Codex usage %
  if (cg.codex && (cg.codex.five_hour_remaining_pct != null || cg.codex.weekly_remaining_pct != null || cg.codex.monthly_remaining_pct != null)) {
    var parts = [];
    if (cg.codex.five_hour_remaining_pct != null) parts.push("5h: " + (100 - cg.codex.five_hour_remaining_pct) + "% verbraucht");
    if (cg.codex.weekly_remaining_pct != null) parts.push("Wöchentlich: " + (100 - cg.codex.weekly_remaining_pct) + "% verbraucht");
    if (cg.codex.monthly_remaining_pct != null) parts.push("Monatlich: " + (100 - cg.codex.monthly_remaining_pct) + "% verbraucht");
    detailElCodex.value = "ChatGPT Plus: " + parts.join(" | ");
  } else {
    detailElCodex.value = "";
  }

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
