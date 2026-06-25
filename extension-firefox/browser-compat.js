// © 2026 Harald Weiss
// Browser compatibility bridge: Firefox MV2 (tabs.executeScript) ↔ Chrome MV3 (scripting.executeScript)
// Injected via manifest.json `background.scripts` before background.js

window.browserCompat = {
  /**
   * Execute a self-contained function in a tab's page context.
   * Returns an array matching Chrome's scripting.executeScript result shape:
   *   [{ result: <return value> }]  on success
   *   throws on error (or returns [null] when caught)
   *
   * @param {number} tabId
   * @param {Function} fn — Must be self-contained (no external references / closures)
   * @returns {Promise<[{result: *}]>}
   */
  executeScript: function(tabId, fn) {
    var fnStr = '(' + fn.toString() + ')()';
    return new Promise(function(resolve, reject) {
      chrome.tabs.executeScript(tabId, { code: fnStr }, function(results) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // Wrap result to match Chrome InjectionResult shape:
          // Chrome: [{ result: <return value>, frameId: N }]
          // Firefox raw: [<return value>]
          if (Array.isArray(results) && results.length > 0) {
            resolve([{ result: results[0] }]);
          } else {
            resolve([{ result: null }]);
          }
        }
      });
    });
  }
};
