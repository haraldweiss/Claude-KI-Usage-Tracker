// © 2026 Harald Weiss
// KI Usage Tracker — Pale Moon Bootstrap Extension
// Entry points: startup / shutdown / install / uninstall
// Reason constants: APP_STARTUP, APP_SHUTDOWN, ADDON_INSTALL, ADDON_UNINSTALL, ADDON_UPGRADE, ADDON_DOWNGRADE

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

const DEFAULT_API_BASE = "https://ki-usage-tracker.wolfinisoftware.de/api";

// --- Toolbar button ---
let gButton = null;

function startup(data, reason) {
  console.log("[KI Usage Tracker] startup, reason=" + reason);

  // Add a toolbar button to the browser UI
  let windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator);
  let browserWindow = windowMediator.getMostRecentWindow("navigator:browser");
  if (!browserWindow) return;

  let document = browserWindow.document;
  let toolbox = document.getElementById("navigator-toolbox");
  if (!toolbox) return;

  // Create toolbar button
  gButton = document.createElement("toolbarbutton");
  gButton.setAttribute("id", "ki-usage-tracker-button");
  gButton.setAttribute("label", "KI Tracker");
  gButton.setAttribute("tooltiptext", "KI Usage Tracker — Kosten anzeigen");
  gButton.setAttribute("oncommand", "KiUsageTracker.openPopup();");
  gButton.setAttribute("class", "toolbarbutton-1");

  // Insert into the toolbar
  let navbar = document.getElementById("nav-bar");
  if (navbar) {
    navbar.appendChild(gButton);
  }
}

function shutdown(data, reason) {
  console.log("[KI Usage Tracker] shutdown, reason=" + reason);
  if (gButton && gButton.parentNode) {
    gButton.parentNode.removeChild(gButton);
    gButton = null;
  }
}

function install(data, reason) {
  console.log("[KI Usage Tracker] install, reason=" + reason);
}

function uninstall(data, reason) {
  console.log("[KI Usage Tracker] uninstall, reason=" + reason);
}

// --- Core functions exposed to browser window ---

browserWindow.KiUsageTracker = {
  openPopup: function() {
    // Open a XUL window with the KI Usage Tracker dashboard
    let win = Services.ww.openWindow(
      null,
      "chrome://kiusagetracker/content/popup.xul",
      "_blank",
      "chrome,centerscreen,dialog=no,resizable=yes,width=420,height=650",
      null
    );
  },

  /**
   * Export cookies from the browser to send to the server-scraper.
   * Uses nsICookieManager for cookie enumeration.
   */
  exportCookies: function() {
    try {
      var cookies = [];
      var cookieManager = Cc["@mozilla.org/cookiemanager;1"]
                           .getService(Ci.nsICookieManager);
      var enumerator = cookieManager.enumerator;

      while (enumerator.hasMoreElements()) {
        var cookie = enumerator.getNext().QueryInterface(Ci.nsICookie);
        var domain = cookie.host;
        // Filter only relevant domains
        if (/claude\.ai|platform\.claude\.com|opencode\.ai|z\.ai|chatgpt\.com|platform\.openai\.com/i.test(domain)) {
          cookies.push({
            name: cookie.name,
            value: cookie.value,
            domain: domain,
            path: cookie.path,
            secure: cookie.isSecure,
            httpOnly: 0 // nsICookie does not expose httponly directly in older APIs
          });
        }
      }

      return cookies;
    } catch (ex) {
      console.error("[KI Usage Tracker] cookie export error:", ex);
      return [];
    }
  },

  /**
   * Fetch monthly stats from the backend API.
   */
  fetchStats: function(apiBase, apiToken) {
    var url = (apiBase || DEFAULT_API_BASE) + "/usage/summary?period=month";
    var headers = {};
    if (apiToken) headers["Authorization"] = "Bearer " + apiToken;

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, false); // synchronous for simplicity
    if (apiToken) xhr.setRequestHeader("Authorization", "Bearer " + apiToken);
    xhr.send();
    if (xhr.status === 200) {
      return JSON.parse(xhr.responseText);
    }
    return null;
  }
};
