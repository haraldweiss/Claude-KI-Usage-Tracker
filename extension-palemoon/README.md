# KI Usage Tracker — Pale Moon Edition

## Add-on Struktur (XUL Bootstrap Extension)

| Datei | Zweck |
|---|---|
| `install.rdf` | Install-Manifest (RDF/XML) |
| `bootstrap.js` | Entry Points: startup / shutdown / install / uninstall |
| `chrome.manifest` | Chrome-Registrierung für chrome://kiusagetracker/ URLs |
| `content/popup.xul` | Popup-Fenster (XUL) |
| `content/popup.js` | Popup-Logik (XPCOM + XMLHttpRequest) |
| `defaults/preferences/prefs.js` | Standard-Preferences |

## APIs im Vergleich (belegt aus Dokumentation)

| Funktion | Chrome MV3 | Pale Moon (XUL/XPCOM) |
|---|---|---|
| Cookies lesen | `chrome.cookies.getAll()` | `nsICookieManager.enumerator` |
| Tab erstellen | `chrome.tabs.create({url})` | `gBrowser.addTab(url)` |
| Tab-Inhalt scrapen | `chrome.scripting.executeScript` | `messageManager.loadFrameScript` |
| Storage | `chrome.storage.local` | `nsIPrefBranch` / Datei |
| HTTP Requests | `fetch()` | `XMLHttpRequest` |
| Backend-Kommunikation | `fetch()` → JSON | `XMLHttpRequest` → JSON |

## Installation

**⚠️ `about:debugging` → "Temporäre Add-ons laden" funktioniert NICHT für XUL-Extensions.**
Pale Moon behandelt über `about:debugging` geladene Add-ons als WebExtensions und zeigt:
`Your browser configuration is not compatible with Service Workers`.

### Korrekte Installationsmethode:

1. **XPI packen:**
   ```bash
   cd extension-palemoon
   zip -r ../ki-usage-tracker-palemoon.xpi *
   ```
2. **In Pale Moon installieren:**
   - `about:addons` öffnen
   - Zahnrad-Icon → "Add-on aus Datei installieren…"
   - `ki-usage-tracker-palemoon.xpi` auswählen
   - Installation bestätigen
   - Pale Moon neu starten (einmalig nötig für bootstrap Aktivierung)

Nach dem Neustart erscheint der "KI Tracker"-Button in der Toolbar.

## Bekannte Einschränkungen

- Kein `async/await` im Bootstrap-Kontext (kein Service Worker) — alles callback-basiert
- `nsICookieManager` hat kein `httpOnly`-Flag in der Interface-Definition (ältere API)
- Cookie-Export nur im Chrome-Kontext möglich (via Toolbarbutton → Popup)
- Synchrones `XMLHttpRequest` blockiert die UI — für Produktion asynchron umschreiben
- Pale Moon hat kein `chrome.runtime.sendMessage` — Popup kommuniziert via `window.opener`

## Quellen

- [developer.palemoon.org/addons/](https://developer.palemoon.org/addons/) — Add-on Typen
- [Install Manifests (RDF/XML)](https://udn.realityripple.com/docs/Archive/Add-ons/Install_Manifests) — install.rdf Format
- [Bootstrapped Extensions](https://udn.realityripple.com/docs/Archive/Add-ons/Bootstrapped_extensions) — bootstrap.js Entry Points
- [Extension Packaging (XPI/ZIP)](https://udn.realityripple.com/docs/Archive/Add-ons/Extension_Packaging) — XPI Format
- [nsICookieManager](https://udn.realityripple.com/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsICookieManager) — Cookie-API
- [Chrome Registration](https://udn.realityripple.com/docs/Mozilla/Chrome_Registration) — chrome.manifest
