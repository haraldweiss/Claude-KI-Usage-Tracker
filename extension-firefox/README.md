# KI Usage Tracker — Firefox Edition

## Unterschiede zur Chrome-Version

| Feature | Chrome MV3 | Firefox MV2 |
|---|---|---|
| Manifest | `manifest_version: 3` | `manifest_version: 2` |
| Background | `service_worker: background.js` | `scripts: ["usage-parser-codex.js", "browser-compat.js", "background.js"]` |
| Button/Popup | `action` | `browser_action` |
| Tab-scraping | `chrome.scripting.executeScript` | `chrome.tabs.executeScript` (via `browser-compat.js`) |
| Ext-ID | nicht nötig | `browser_specific_settings.gecko.id` erforderlich |
| Signing | optional | **Pflicht** (Mozilla AMO) |
| Persistenz | Service Worker kann terminieren | Background Page bleibt persistent |

## Was geändert wurde

1. **`manifest.json`**: MV2 mit `browser_specific_settings.gecko` + `background.scripts`
2. **`browser-compat.js`** (neu): Bridge zwischen `chrome.scripting.executeScript` und `chrome.tabs.executeScript`
3. **`background.js`**: 
   - `importScripts` entfernt (Scripts via manifest geladen)
   - `chrome.scripting.executeScript` → `browserCompat.executeScript` (mit `function()` statt Arrow-Funktionen)
   - Alle Promises und Callbacks für Firefox-Kompatibilität angepasst

## Installation (temporär, für Entwicklung)

1. Firefox öffnen, `about:debugging#/runtime/this-firefox`
2. "Temporäre Add-ons laden" → `extension-firefox/manifest.json` auswählen
3. Extension erscheint in der Symbolleiste

## Für dauerhafte Installation (AMO)

1. Extension als ZIP packen
2. Auf [addons.mozilla.org](https://addons.mozilla.org/developers/) hochladen
   - Mozilla signiert das Add-on automatisch nach Prüfung
3. Signierte `.xpi`-Datei installieren

## Bekannte Einschränkungen

- Firefox MV2 Background Pages sind persistent → kein Terminierungs-Problem wie bei Chrome Service Worker
- `clipboardWrite` für den "Befehl kopieren"-Button im Handoff-Banner
- Die `host_permissions` werden als normale Permissions deklariert (MV2 hat kein separates `host_permissions`)
