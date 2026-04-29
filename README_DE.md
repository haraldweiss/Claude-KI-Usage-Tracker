# Claude Usage Tracker

Webanwendung + Browser-Extension, die die **echten Kosten** für Claude über drei Anthropic-Quellen hinweg trackt — claude.ai-Subscription, Anthropic-Console-API-Keys und Claude Code — und sie als eine Zahl auf einem einheitlichen Dashboard anzeigt.

**Status**: ✅ Phase 5 — Multi-Source Cost Tracker (live auf VPS, Plan-B-Architektur)

---

## 🎯 Was es macht

Das Dashboard sagt dir mit einer Zahl, was Claude diesen Monat tatsächlich kostet. Es zieht die Daten aus drei sonst voneinander getrennten Quellen:

1. **claude.ai/settings/usage** — die Subscription-Seite (Plan, Zusatznutzung, Wochenlimits)
2. **console.anthropic.com/settings/keys** — Workspace-API-Keys + kumulative Kosten
3. **platform.claude.com/claude-code** — Claude-Code-Keys mit Kosten + Lines-of-Code

Die Browser-Extension scraped diese Seiten in einem festen Rhythmus, postet die Zahlen ans lokale Backend, und das Backend macht sie über eine typed API für das React-Dashboard verfügbar.

### Warum Scraping, nicht die Anthropic-API?

Die offizielle Usage/Cost-API erfordert einen Admin-Key (Organization-Level-Credential). Dieses Tool ist für Nutzer gebaut, die *keinen* haben, aber die gleichen Seiten wie ein Mensch öffnen können. Die Extension nutzt deine bereits eingeloggte Browser-Session und holt die Zahlen, die Anthropic dir sowieso anzeigt — keine zusätzlichen Credentials, keine zusätzliche Abrechnungsstelle.

> **Trade-off:** Scraping ist fragil. Wenn Anthropic eine der Seiten umbaut, bricht diese Quelle bis die Selektoren angepasst sind. Die Extension scheitert kontrolliert: wenn ein Scraper keine Daten findet, loggt er das und überspringt — die anderen Quellen funktionieren weiter.

---

## ✨ Features

### Cost-Tracking
- **Drei Sync-Quellen**: claude.ai (alle 10 Min), Anthropic Console (alle 24h), Claude Code (alle 24h, 5 Min versetzt). Konfigurierbar; manuelle Trigger über das Popup oder die Service-Worker-Konsole.
- **Plan-Subscription-Preise** in einer editierbaren Settings-Tabelle (Pro 18 €, Max 5x 99 €, Max 20x 199 €, Team 30 €). Daily-Refresh-Hook bereit für eine zukünftige Anthropic-Pricing-Page-Quelle; aktuell werden Werte einmalig geseedet und bleiben unverändert, solange der User nicht editiert.
- **USD → EUR Umrechnung** über [Frankfurter](https://api.frankfurter.app) (ECB-basiert, kostenlos, kein API-Key). Täglich aktualisiert; fällt auf den letzten gespeicherten Kurs zurück, falls die API kurz nicht erreichbar ist.
- **Self-maintaining Model-Pricing**: Snapshot deckt Claude 4.x (Opus 4.7, Sonnet 4.6, Haiku 4.5), 3.7-Linie und Legacy-Modelle ab. Daily LiteLLM-Sync hält die Preise aktuell.
- **History Retention**: claude.ai-Snapshots werden one-per-day behalten, sodass monatliche Diffs und All-Time-Totals erhalten bleiben, obwohl die Page nur den aktuellen Monat zeigt.

### Dashboard
- **Übersicht**: Hero-Zahl in EUR, drei Status-Cards (Plan, Wochenlimits mit farbig wechselnden Progress-Bars, Budget), Forecast-Card mit linearer Extrapolation des Tagesschnitts auf Monatsende, Monats-Trend (ab 2 Monaten), Sync-Status-Footer.
- **Modelle**: Per-Key-Detail-Tabelle (Key/Member, Source-Badge, Workspace, Kosten, Lines, letzter Sync) — funktioniert ohne per-message-Daten, weil die Quelle der kumulative Cost-pro-Key-Sync ist.
- **Gesamtkosten**: gleiche Per-Key-Tabelle, plus klare "diesen Monat vs. seit Tracking-Start"-Aufteilung mit aufklappbarer Monats-Aufschlüsselung (Plan-Abo + Zusatznutzung + Total pro Monat).
- **Recommendations**: Live-Insights aus den echten Sync-Daten (Plan-Right-Sizing basiert auf Wochenlimit-%, Forecast-Warnung beim Monatslimit, Cost-Source-Verhältnis, Claude-Code-Key-Effizienz-Vergleich) plus interaktiver Modell-Suggester für Ad-hoc-Anfragen.
- **Settings**: editierbare Plan-Subscription-Preise + editierbares Modell-Token-Pricing.

### Architektur
- **Backend**: Node.js + Express + TypeScript (strict mode), SQLite, additive Migrationen.
- **Frontend**: React + TypeScript + Vite, Tailwind CSS. Same-Origin-XHRs in Production; Dev-Server nutzt Vite-Proxy.
- **Extension**: Chrome MV3, konfigurierbare Backend-URL + Basic-Auth-Credentials im Popup, sodass derselbe Extension-Build gegen lokales Dev (`localhost:3000`) und das deployed VPS funktioniert.
- **VPS-Deployment**: Apache Reverse-Proxy + systemd-Unit + Let's-Encrypt-TLS + HTTP Basic Auth + automatisiertes Health-Monitoring mit E-Mail-Alerts.

---

## 📋 Voraussetzungen

- **Node.js**: 20 LTS oder neuer (auf dem VPS läuft 22.x).
- **Chrome / Chromium / Brave**: für die Browser-Extension.
- **SQLite**: Kommt mit der `sqlite3`-npm-Dependency, kein System-Install nötig.

---

## 🚀 Quick Start (lokales Dev)

### 1. Repository klonen
```bash
git clone git@github.com:haraldweiss/Claude-KI-Usage-Tracker.git
cd Claude-KI-Usage-Tracker
```

### 2. Dependencies installieren
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Anwendung starten
```bash
# Terminal 1 — Backend auf Port 3000
cd backend && npm run dev

# Terminal 2 — Frontend auf Port 5173
cd frontend && npm run dev
```

Oder die Convenience-Scripts, die beides auf einmal handhaben:
```bash
./start.sh      # Öffnet beide in neuen Terminal-Fenstern (macOS) / fällt auf Background-Modus zurück
./status.sh     # Zeigt was läuft und aus welchem Verzeichnis
./stop.sh       # Stoppt beide, plus stale nodemon/vite-Prozesse
```

Die Scripts erkennen automatisch, wenn sie aus einem Worktree gestartet werden, und zeigen das Backend auf die SQLite-Datei des Haupt-Repos, sodass Test- und Dev-Runs dieselben Daten teilen.

### 4. Extension installieren
1. `chrome://extensions` öffnen.
2. Developer-Mode aktivieren (oben rechts).
3. "Entpackte Erweiterung laden" klicken.
4. Den `extension/`-Ordner auswählen.
5. Auf das Tracker-Icon in der Toolbar klicken → "⚙️ Verbindung" ausklappen → Backend-API-URL = `http://localhost:3000/api` (Default) lassen, Auth-Felder leer für lokales Dev → "Speichern".

### 5. Ersten Sync triggern
Logge dich in claude.ai, console.anthropic.com und platform.claude.com in normalen Browser-Tabs ein (damit die Extension deine Session wiederverwenden kann). Dann im Extension-Popup den Sync-Button klicken — oder in der Service-Worker-Konsole:
```javascript
autoSync().then(console.log)         // claude.ai
consoleSync().then(console.log)      // console.anthropic.com
claudeCodeSync().then(console.log)   // platform.claude.com/claude-code
```
Das Dashboard auf `http://localhost:5173` ist innerhalb weniger Sekunden befüllt.

---

## 🌐 VPS-Deployment

Der Tracker lässt sich auch als Subpath einer existierenden Apache-Vhost deployen — sinnvoll, wenn auf einer Domain bereits andere Sachen gehostet sind und keine separate Subdomain her soll.

**Live unter:** `https://wolfinisoftware.de/claudetracker/` (Basic-Auth-geschützt; das ist die Maintainer-Instanz).

### Wie es funktioniert

| Layer | Was wo lebt |
|---|---|
| Apache vhost | `/etc/httpd/conf.d/claudetracker.conf` — `Alias /claudetracker → /var/www/.../frontend/dist` plus `ProxyPass /claudetracker/api/ → http://127.0.0.1:3001/api/`. SPA-Fallback-Rewrite für client-seitiges Routing. |
| Backend | systemd-Unit `claudetracker-backend.service`, lauscht auf `127.0.0.1:3001`, env-konfiguriert via `Environment=DATABASE_PATH=...` und `Environment=CORS_ALLOWED_ORIGINS=...`. |
| Frontend | statisches Bundle unter `/var/www/wolfinisoftware/claudetracker/frontend/dist/` (Vite-Build, Base-Path `/claudetracker/`). |
| Auth | HTTP Basic via `.htpasswd-claudetracker`. Das Extension-Popup hat passende User/Passwort-Felder, die als `Authorization: Basic …` bei jedem Fetch mitgeschickt werden. |
| TLS | Let's-Encrypt-Cert vom umgebenden vhost (kein separates Cert für den Subpath). |

Der Frontend-Production-Build liest `frontend/.env.production` (`VITE_API_URL=/claudetracker`), sodass alle Fetches eine same-origin-relative URL nutzen — kein separater API-Hostname, kein CORS-Tanz, der Browser merkt sich die Basic-Auth-Credentials über Requests hinweg.

### Frischen Build deployen

```bash
# Aus dem Projektverzeichnis
cd backend && npm run build
cd ../frontend && npm run build

# Nur die Runtime-Artefakte syncen
rsync -az --delete --exclude=node_modules --exclude=database.sqlite \
  backend/dist backend/package.json backend/package-lock.json \
  user@vps:/var/www/.../claudetracker/backend/
rsync -az --delete frontend/dist/ \
  user@vps:/var/www/.../claudetracker/frontend/dist/

ssh user@vps 'systemctl restart claudetracker-backend'
```

### Monitoring (live auf der Maintainer-VPS)

- `/usr/local/bin/claudetracker-healthcheck.sh` — Cron alle 5 Min, schickt Mail nach 3 aufeinanderfolgenden `/health`-Fails, resettet die Streak bei Recovery.
- `/usr/local/bin/claudetracker-notify.sh` — wraps `sendmail`, Rate-Limit 1 Mail/h pro Alert-Key, loggt immer ins Journal.
- `claudetracker-onfailure.service` — systemd-`OnFailure=`-Hook, der greift, wenn das Backend sein Restart-Budget (5 Starts in 10 Min) erschöpft.
- Mail-Relay: Postfix → Ionos-SMTP → Empfänger-Postfach. Getestet und live.

Siehe [docs/superpowers/specs/2026-04-29-console-api-tracking-design.md](./docs/superpowers/specs/2026-04-29-console-api-tracking-design.md) für die architektonische Begründung und [docs/superpowers/specs/2026-04-29-multi-user-auth-design.md](./docs/superpowers/specs/2026-04-29-multi-user-auth-design.md) für den geplanten Multi-User-Ersatz von HTTP Basic Auth.

---

## 🔌 API-Endpoints

### Usage-Tracking
- `POST /api/usage/track` — Tracking-Record loggen (von Extension-Syncs benutzt).
- `GET /api/usage/summary?period=day|week|month` — kombinierte Headline-Zahlen + Per-Source-Breakdown + EUR-Equivalent der API-USD-Zahl + verwendeter Wechselkurs.
- `GET /api/usage/models` — Per-Modell-Token-Breakdown. Filtert die drei synthetischen Sync-Quellen (`claude_official_sync`, `anthropic_console_sync`, `claude_code_sync`) raus, weil diese keine Per-Message-Tokens tragen.
- `GET /api/usage/history?limit=500&offset=0` — letzte Usage-Records.
- `GET /api/usage/console/keys` — letzter Snapshot pro Key aus `console.anthropic.com` und `platform.claude.com/claude-code`. Eine Response, Source-getaggt.
- `GET /api/usage/spending-total` — All-Time-Totals pro Monat, plus Grand-Total in EUR mit dem letzten gespeicherten Wechselkurs.

### Pricing-Management
- `GET /api/pricing` — Modell-Token-Pricing.
- `PUT /api/pricing/:model` — Manueller Override; setzt `source='manual'`.
- `POST /api/pricing/:model/confirm` — Bestätigt eine auto-detectete `pending_confirmation`-Zeile.
- `GET /api/pricing/plans` — claude.ai-Plan-Subscription-Preise.
- `PUT /api/pricing/plans/:name` — Override des monatlichen EUR eines Plans.
- `POST /api/pricing/plans/refresh` — Manueller Trigger für den (aktuell no-op) Upstream-Scrape.

### Modell-Empfehlungen
- `POST /api/recommend` — Modell-Empfehlung für eine Free-Text-Task-Description.
- `GET /api/recommend/analysis/models?period=…` — historische Modell-Statistiken.
- `GET /api/recommend/analysis/opportunities?period=…` — Legacy-Cost-Optimization-Endpoint. Liefert leere Resultate, wenn keine Per-Message-Daten verfügbar sind (der Standard-Fall mit dem aktuellen Scraping-Setup).

### System
- `GET /health` — Backend-Liveness-Check (kein Auth nötig, vom VPS-Health-Check-Cron benutzt).

---

## 🔐 Authentifizierung

### Lokales Dev
Standardmäßig keine. Backend lauscht auf `localhost:3000`, Frontend auf `localhost:5173`, Extension spricht mit `http://localhost:3000/api`. Die Basic-Auth-Felder im Popup leer lassen.

### VPS (Production)
HTTP Basic Auth auf Apache-Layer, angewandt auf den ganzen `/claudetracker/`-Subtree (Frontend + API). Das Extension-Popup hat passende User/Passwort-Felder unter "⚙️ Verbindung", die als `Authorization: Basic <base64>` bei jedem Fetch mitgeschickt werden. Der Browser cached die Credentials nach dem ersten Prompt.

### Zukunft: Multi-User (geplant, nicht implementiert)
Ersetzt Basic Auth durch JWT-Login, eine Admin-Rolle für Invites und per-User-Datentrennung. Specced in [docs/superpowers/specs/2026-04-29-multi-user-auth-design.md](./docs/superpowers/specs/2026-04-29-multi-user-auth-design.md). In einer separaten Session zu implementieren.

---

## 🌍 Konfiguration

### Backend (`backend/.env`)
```env
PORT=3000                                       # 3001 auf dem VPS
DATABASE_PATH=./database.sqlite                 # absoluter Pfad auf dem VPS
NODE_ENV=development                            # production auf dem VPS
CORS_ALLOWED_ORIGINS=https://wolfinisoftware.de # Komma-separierte Extras
```

### Frontend
- `frontend/.env` (dev): `VITE_API_URL=http://localhost:3000`
- `frontend/.env.production` (Prod-Build): `VITE_API_URL=/claudetracker`, sodass das Bundle Same-Origin-Requests stellt.

### Extension
Alle Verbindungs-Settings leben in `chrome.storage.local` und werden über das "⚙️ Verbindung"-Panel im Popup konfiguriert. Keine Environment-Variablen zur Build-Zeit zu setzen. "Zurücksetzen" entfernt sowohl URLs als auch hinterlegte Basic-Auth-Credentials.

---

## 🐛 Troubleshooting

| Problem | Lösung |
|---|---|
| Port 3000 schon belegt | `./stop.sh` (killt sowohl port-bound- als auch stale nodemon/vite-Prozesse), dann `./start.sh`. |
| Mehrere nodemon-Zombies | `./status.sh` zeigt sie; `./stop.sh` räumt auf. |
| "Keine Daten" im Dashboard | Sync manuell triggern aus dem Extension-Popup oder der Service-Worker-Konsole. `chrome://extensions` → Service Worker prüfen auf Errors. |
| `sqlite3` GLIBC-Error auf VPS | Die pre-built Binary braucht glibc ≥ 2.38; auf Rocky 9 einmalig `npm rebuild sqlite3 --build-from-source`. |
| 401 bei jedem API-Call | Extension-Popup → "⚙️ Verbindung" → passende Basic-Auth-Credentials eingeben und speichern. Die Extension teilt keine Cookies mit dem Browser; Credentials müssen im Popup gesetzt werden. |
| Frontend zeigt Port 3000 in Error-Message | Stale Build — `npm run build` neu ausführen und Cmd+Shift+R im Browser drücken, um den Bundle-Cache zu busten. |
| Modelle-Tab zeigt überall 0,00 | Erwartet. Die drei Scrape-Quellen tragen keine Per-Message-Tokens; die Per-Key-Tabelle darunter zeigt die echten Zahlen. |
| All-Time-Spending zeigt nur den aktuellen Monat | Die History-Retention-Änderung behält einen Snapshot pro UTC-Tag, sodass ältere Monate erst auftauchen, wenn sie tatsächlich Daten haben. |

---

## 🧪 Tests

```bash
# Backend (Jest + ts-jest)
cd backend && npm test

# Frontend (Vitest)
cd frontend && npm test
```

Backend-Dev-Runtime nutzt `tsx` (kein Compile-Schritt im Dev). Production: `npm run build && npm start` baut nach `dist/` und serviert den kompilierten Output.

---

## 🤝 Mitmachen

Das ist ein persönliches Projekt, aber die Patterns sind wiederverwendbar. Wenn du forkst:

1. Branch erstellen: `git checkout -b feature/dein-feature`.
2. Tests: `cd backend && npm test && cd ../frontend && npm test`.
3. Type-Check: `cd backend && npm run type-check`.
4. Committen; pushen.

Die Architecture-Decision-Records in `docs/superpowers/specs/` dokumentieren, warum das Projekt von der Per-Message-Haiku-Categorization (Plan A, abandoned) auf Multi-Source-Page-Scraping (Plan B, aktuell) gepivotet ist. Sie vor nicht-trivialen Änderungen zu lesen, spart dem nächsten Menschen viel Verwirrung.

---

## 📝 Lizenz

MIT — siehe [LICENSE](./LICENSE).

---

**Zuletzt aktualisiert**: April 2026 (Phase 5 — Multi-Source Cost Tracker, VPS-Deployment, USD/EUR-Conversion, Live-Insights)
**Maintained by**: Harald Weiss
**Repository**: [GitHub](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)
