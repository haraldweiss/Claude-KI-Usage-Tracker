// © 2026 Harald Weiss
// KI Usage Tracker — Pale Moon Bootstrap Extension
// Entry points: startup / shutdown / install / uninstall
// Reason constants: APP_STARTUP, APP_SHUTDOWN, ADDON_INSTALL, ADDON_UNINSTALL, ADDON_UPGRADE, ADDON_DOWNGRADE
//
// Important: startup() is called by the addon manager during Pale Moon's
// boot sequence, BEFORE any browser window exists. The code handles this
// by registering a "domwindowopened" observer and retrying for each
// window when it becomes available.

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

const DEFAULT_API_BASE = "https://ki-usage-tracker.wolfinisoftware.de/api";

// --- Per-window button tracking ---
const gWindowButtons = new Map();
let gWindowObserverRegistered = false;

// ========== Observer: new browser windows ==========

const gWindowObserver = {
  observe: function(subject, topic, data) {
    if (topic !== "domwindowopened") return;
    var win = subject.QueryInterface(Ci.nsIDOMWindow);
    win.addEventListener("load", function onLoad() {
      win.removeEventListener("load", onLoad, false);
      addButtonToWindow(win);
    }, false);
  }
};

// ========== Add button + KiUsageTracker to one window ==========

function addButtonToWindow(win) {
  try {
    if (gWindowButtons.has(win)) return; // already done

    var doc = win.document;

    // Create toolbar button
    var btn = doc.createElement("toolbarbutton");
    btn.setAttribute("id", "ki-usage-tracker-button");
    btn.setAttribute("label", "KI Tracker");
    btn.setAttribute("tooltiptext", "KI Usage Tracker — Kosten anzeigen");
    btn.setAttribute("oncommand", "KiUsageTracker.openPopup();");
    btn.setAttribute("class", "toolbarbutton-1");

    // Insert into nav-bar, fallback to first toolbar
    var navbar = doc.getElementById("nav-bar");
    if (navbar) {
      navbar.appendChild(btn);
    } else {
      var toolbox = doc.getElementById("navigator-toolbox");
      if (toolbox) {
        if (toolbox.toolbars && toolbox.toolbars.length > 0) {
          toolbox.toolbars[0].appendChild(btn);
        } else {
          toolbox.appendChild(btn);
        }
      }
    }

    gWindowButtons.set(win, btn);

    // --- Expose KiUsageTracker on this window ---
    // popup.js accesses it via popupWindow.opener.KiUsageTracker
    win.KiUsageTracker = {
      openPopup: function() {
        Services.ww.openWindow(
          win, // parent → sets window.opener on popup
          "chrome://kiusagetracker/content/popup.xul",
          "_blank",
          "chrome,centerscreen,dialog=no,resizable=yes,width=420,height=650",
          null
        );
      },

      exportCookies: function() {
        try {
          var cookies = [];
          var cookieManager = Cc["@mozilla.org/cookiemanager;1"]
                               .getService(Ci.nsICookieManager);
          var enumerator = cookieManager.enumerator;
          while (enumerator.hasMoreElements()) {
            var cookie = enumerator.getNext().QueryInterface(Ci.nsICookie);
            var domain = cookie.host;
            if (/claude\.ai|platform\.claude\.com|opencode\.ai|z\.ai|chatgpt\.com|platform\.openai\.com/i.test(domain)) {
              cookies.push({
                name: cookie.name,
                value: cookie.value,
                domain: domain,
                path: cookie.path,
                secure: cookie.isSecure,
                httpOnly: 0
              });
            }
          }
          return cookies;
        } catch (ex) {
          console.error("[KI Usage Tracker] cookie export error:", ex);
          return [];
        }
      },

      fetchStats: function(apiBase, apiToken) {
        var url = (apiBase || DEFAULT_API_BASE) + "/usage/summary?period=month";
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, false);
        if (apiToken) xhr.setRequestHeader("Authorization", "Bearer " + apiToken);
        try {
          xhr.send();
          if (xhr.status === 200) return JSON.parse(xhr.responseText);
        } catch (e) {
          console.error("[KI Usage Tracker] fetchStats error:", e);
        }
        return null;
      }
    };
  } catch (ex) {
    console.error("[KI Usage Tracker] addButtonToWindow error:", ex);
  }
}

// ========== Remove button from one window ==========

function removeButtonFromWindow(win) {
  try {
    var btn = gWindowButtons.get(win);
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    gWindowButtons.delete(win);
    delete win.KiUsageTracker;
  } catch (ex) {
    console.error("[KI Usage Tracker] removeButtonFromWindow error:", ex);
  }
}

// ========== Bootstrap entry points ==========

function startup(data, reason) {
  console.log("[KI Usage Tracker] startup, reason=" + reason);

  // 1. Process already-open browser windows
  var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
            .getService(Ci.nsIWindowMediator);
  var enumerator = wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    var win = enumerator.getNext();
    addButtonToWindow(win);
  }

  // 2. Listen for future windows (Pale Moon may not have any at this point)
  if (!gWindowObserverRegistered) {
    Services.obs.addObserver(gWindowObserver, "domwindowopened", false);
    gWindowObserverRegistered = true;
  }
}

function shutdown(data, reason) {
  console.log("[KI Usage Tracker] shutdown, reason=" + reason);

  // Remove observer
  if (gWindowObserverRegistered) {
    try {
      Services.obs.removeObserver(gWindowObserver, "domwindowopened");
    } catch (ex) {}
    gWindowObserverRegistered = false;
  }

  // Remove buttons from all windows
  for (var [win] of gWindowButtons) {
    removeButtonFromWindow(win);
  }
  gWindowButtons.clear();
}

function install(data, reason) {
  console.log("[KI Usage Tracker] install, reason=" + reason);
}

function uninstall(data, reason) {
  console.log("[KI Usage Tracker] uninstall, reason=" + reason);
}
