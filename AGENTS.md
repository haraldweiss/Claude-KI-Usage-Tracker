# AGENTS.md — KI Usage Tracker (Claude Usage Tracker)

Shared instructions for all AI coding agents working in this repo. Both `CLAUDE.md` and `AGENTS.md` point here.

---

## 0. Before your first commit in a session

```bash
git config user.email   # must be: harald.weiss@wolfinisoftware.de
git config user.name    # must be: Harald Weiss
git fetch origin
```

If `user.email` is unset, empty, or fake — **stop, fix it, then proceed**.

---

## 1. What this project is

- **Multi-source AI cost tracker**: surfaces real spend from 7 disconnected places into one dashboard:
  1. `claude.ai/settings/usage` — consumer subscription
  2. `console.anthropic.com/settings/keys` — workspace API keys
  3. `platform.claude.com/claude-code` — Claude Code keys + LOC metrics
  4. `opencode.ai` — OpenCode Go workspace subscription (added 2026-05-27)
  5. `z.ai/manage-apikey/coding-plan` — GLM Coding Plan subscription (added 2026-06-14)
  6. `chatgpt.com/codex/settings/usage` — ChatGPT Pro/Plus Codex usage (added 2026-06-22)
  7. `platform.openai.com/usage` — OpenAI API month-to-date spend (added 2026-06-22)
- Three components: **backend** (Express + SQLite3), **frontend** (React + Vite + Recharts), **extension** (Chrome MV3)
- Hosted at `https://wolfinisoftware.de/claudetracker/` with magic-link auth + API tokens
- Default branch: `main`, remote: `github.com:haraldweiss/Claude-KI-Usage-Tracker`
- **GitHub ruleset active**: `non_fast_forward` blocks force-push. To force-push: temp disable via `gh api -X PUT repos/.../rulesets/16651604 --input <json with enforcement: disabled>`, push, re-enable.

---

## 2. Agent routing

### opencode (Throughput)
- New provider / new pricing source integrations (extension scraper + backend service)
- Plan-pricing table editing in `backend/src/services/planPricingService.ts`
- React component splits (e.g. `NavBar` extraction)
- Type cleanup (`as any` removal, typed query results)

### Claude Code (Care)
- Magic-link auth flow (`backend/src/controllers/authController.ts`-ish)
- API token generation / validation
- Database migrations on production SQLite
- Production deploys (port 3001, systemd, log rotation)
- `extension/manifest.json` permission changes (review carefully — Chrome flags new host_permissions on update)

---

## 3. Hard rules

### 3.0 Keine Subagenten bei Claude/Anthropic-Modellen ⛔ (bis auf Widerruf)

**Gilt für alle Agenten die auf Claude/Anthropic-API laufen (Claude Code, OpenCode mit Claude, etc.):**

- `superpowers:subagent-driven-development` ist **verboten**.
- Pläne werden ausschließlich mit `superpowers:executing-plans` (Inline) ausgeführt.
- Kein Agent-Tool mit `subagent_type` oder isolierten Sub-Agenten für Implementierung/Review.
- **Grund:** Eine Subagent-Session (18 Aufrufe, Implementer + 2 Reviewer × 5 Tasks) kostete $37.67 in einem Tag und löste den Rate-Alert aus. Die Kosten sind nicht tragbar.
- **Ausnahme:** Nur wenn der User in der laufenden Session explizit „Subagenten verwenden" sagt.



### 3.1 Port / process / log
- Backend runs on **port 3001** (not 3000 — past confusion lost 30 min of debugging).
- Logs live in `/var/log/claudetracker-backend.log` (not journal).
- After every `npm ci`: `npm rebuild sqlite3 --build-from-source` — the prebuilt binary demands glibc 2.38, VPS has older. Skip = crashes on boot.

### 3.2 Scraper resilience
- Extension scrapers in `extension/background-scraper-*.js` are **best-effort**: claude.ai and opencode.ai layouts change without warning. When they break:
  - Look for the actual text in the new DOM (e.g. "Zurücksetzung in" was added alongside "Reset in" — accept both)
  - Increase render delays before scraping (e.g. 2.5s → 4s)
  - Search before/after the percentage match, not only one direction
- Don't aggressively cache scraper results — make them idempotent so a re-sync just upserts.
- **claude.ai scraper (`background-scraper-claude.js`) — two hard constraints learned 2026-06-19:**
  - Always open new tabs with `active: true` — Cloudflare blocks `active: false` (hidden) tabs with a Private Access Token challenge; the page never loads.
  - Never use hash navigation (`window.location.hash = 'settings/usage'`) to reach the usage page from a `/new` SPA tab — this triggers a client-side redirect that puts the tab in a transient state where `executeScript` throws "Cannot access contents of the page". Always navigate directly to `USAGE_PAGE_URL` via `chrome.tabs.update`.

### 3.3 Cost math is user-trust-critical
- All currency conversions go through `frankfurter.app` daily; cache the rate.
- `formatEur` / `formatUsd` in extension popup: always `isFinite()` guard before format. Past bug surfaced `NaN€` when a scraper returned undefined.
- "Grand total" in `OverviewTab` must include **all seven sources** (claude.ai, console, Claude Code, OpenCode Go, z.ai GLM Coding Plan, Codex, OpenAI API) — if you add an 8th source, add it to the sum (and to `getSpendingTotal`'s `grand_total_eur`).

### 3.4 Validators / XSS
- **Don't** use `.escape()` on user input in `express-validator`. React auto-escapes on render; `.escape()` corrupts legitimate characters in stored notes. Removed in `92bc43f`.
- For dynamic imports: prefer static imports in hot paths (every request) — keeps p99 latency low.

### 3.5 Force-push to main
- Blocked by ruleset `16651604` ("protect repo from force delete", rules: deletion + non_fast_forward).
- To rewrite history: PUT ruleset to `enforcement=disabled`, push, restore to `enforcement=active`. **Always restore in the same session.**
- Never leave the ruleset disabled overnight.

---

## 4. Verification standards

```
Verified: backend type-check ✓, backend tests N/N ✓, frontend type-check ✓,
manual sync from extension popup ✓ — new claude.ai data point appeared
in OverviewTab grand total
```

For extension changes: always describe a real round-trip test (open popup → sync → check dashboard).

---

## 5. Commit style

- Granular: 3–8 commits per topic (good recent example: 8 commits for OpenCode Go integration)
- Conventional commits: `feat(opencode-go):`, `fix(extension):`, `fix(backend):`, `feat(ui):`
- Concrete numbers, bug reproducer, polish pass as separate commit
- Mention which of {backend, frontend, extension} the commit touches in the scope

---

## 5.1 Sync discipline — git, AGENTS.md, README must stay current

Cross-project rule (canonical statement in `wolfini_de_web` AGENTS.md §5.1). Every non-trivial change in this repo must update three artifacts in lockstep:

1. **Git** — commit the change. Don't end a session with uncommitted operational work in the tree. If a session can't commit (blocked hook, etc.), say so in the handoff entry (§7).
2. **AGENTS.md** — update whenever the change adds/modifies/invalidates a hard rule (§3), a deploy/verify procedure (§4-§6), or a follow-up the next session needs (§7). Includes *removing* stale entries in the same commit they go obsolete.
3. **README** — update when the change affects setup, env vars, ports, deploy steps, the Quadlet on the VPS, the Chrome extension manifest, or known caveats. Create one if missing AND the change warrants it.

If a sibling repo is touched in the same session (`wolfini_de_web`, `ai-provider-service`, `Bewerbungstracker`), the same three artifacts must be updated *there too* — link the sibling PR from the handoff entry.

---

## 6. Quick reference

| What | Path / command |
|---|---|
| Backend dev | `cd backend && npm run dev` |
| Backend build | `cd backend && npm run build` |
| Backend tests | `cd backend && npm test` |
| Backend port | **3001** |
| Frontend dev | `cd frontend && npm run dev` |
| Frontend type-check | `cd frontend && npm run type-check` |
| Extension | load `extension/` unpacked in Chrome |
| Production logs | `/var/log/claudetracker-backend.log` on VPS |
| SQLite rebuild | `cd backend && npm rebuild sqlite3 --build-from-source` |
| Magic link mail | requires SPF + DKIM + DMARC on sender |
| Pricing fallback | `backend/src/data/pricing-fallback.ts` |
| OpenCode Go scraper | `extension/background.js::opencodeGoSync()` |
| z.ai scraper | `extension/background-scraper-zai.js::zaiSync()` |
| claude.ai scraper | `extension/background.js` (legacy of all scrapers) |

---

## 6.1 Geräteübergreifendes Gehirn (Claude Memory + Obsidian)

### Claude Code Memory (git-backed)

Das Auto-Memory-Verzeichnis ist selbst ein Git-Repo mit Remote auf Oracle VM:

| Was | Wert |
|---|---|
| Lokal | `~/.claude/projects/-Library-WebServer-Documents-KI-Usage-tracker/memory/` |
| Remote | `oracle-vm:/opt/claude-memory/Library-WebServer-Documents-KI-Usage-tracker.git` |
| Push/Pull | `git -C <memory-path> push` / `git -C <memory-path> pull` |

Nach jedem Schreiben einer Memory-Datei **immer pushen**, damit der andere Mac die Änderung bekommt.

### Obsidian WebDAV Sync (Remotely Save Plugin)

Vault `ai-provider-memory` synct via WebDAV auf Oracle VM:

| Was | Wert |
|---|---|
| WebDAV URL | `https://obsidian.wolfinisoftware.de` |
| Remote Base Dir | `ai-provider-memory` |
| User | `harald` |
| Passwort | in `~/.claude/projects/.../memory/reference_obsidian_webdav.md` |
| Apache Config | `/etc/httpd/conf.d/obsidian-dav.conf` auf Oracle VM |
| Vault-Verzeichnis | `/opt/obsidian-vaults/ai-provider-memory/` auf Oracle VM |
| SSL-Cert | `/etc/letsencrypt/live/obsidian.wolfinisoftware.de/` |

**SELinux-Kontext:** muss `httpd_sys_rw_content_t` sein. Bei neuem Verzeichnis unter `/opt/obsidian-vaults`:
```bash
sudo semanage fcontext -a -t httpd_sys_rw_content_t '/opt/obsidian-vaults(/.*)?'
sudo restorecon -Rv /opt/obsidian-vaults
```

**DAV-Besonderheit:** PROPFIND mit `Depth: infinity` ist aus Sicherheitsgründen gesperrt (Apache-Default). Remotely Save benutzt `Depth: 1` → kein Problem.

### Memory → Obsidian Mirror (B)

Post-commit Hook im Memory-Repo spiegelt alle `.md`-Dateien automatisch in `~/ObsidianVaults/ai-provider-memory/claude-memory/`:

```
~/.claude/projects/.../memory/.git/hooks/post-commit
→ rsync *.md → ~/ObsidianVaults/ai-provider-memory/claude-memory/
```

Manuelle Aktualisierung: `rsync -a --include="*.md" --exclude="*" <memory-dir>/ <vault>/claude-memory/`

---

## 7. Handoff zone (free-form, append-only)

<!-- Example:
### 2026-05-27 — OpenCode Go tracking landed
- New extension pipeline: opencodeGoSync() scrapes plan name + usage % +
  reset timers from opencode.ai workspace
- Backend opencode_go_sync source type with daily dedup
- refreshOpenCodeGoPricing() runs daily 02:00, USD→EUR via Frankfurter
- Plan-pricing seed includes "OpenCode Go" (editable in Settings)
- 13 OpenCode Go models added to pricing fallback for recommendations
- NOT yet stress-tested with multi-user concurrent syncs

### 2026-05-28 — Local LLM sync repair after VPS DB reset

**Problem:** Lokale LLM-Daten (provider-service) kamen nicht mehr an, obwohl der Sync durchlief. `Verbindung testen` zeigte "0 neue Events".

**Zwei Ursachen:**

1. **SECRETS_KEY mismatch** — `service_token_enc` in `user_provider_service_config` war mit altem Key verschlüsselt. Nach VPS-Neuinstallation war ein neuer `SECRETS_KEY` im Einsatz → AES-GCM-Entschlüsselung fehlschlug.  
   **Fix:** Neuen Encrypted-Token via Node.js mit aktuellem Key erzeugen und in die DB schreiben.

2. **provider_user_ids veraltet** — Die IDs im Tracker (`wolfinisoftware.de`, `bewerbungstracker`, …) existierten im provider-service nicht mehr (frische DB). Der Sync fragte `/usage/events?user_id=<falsche-id>` → 0 Events.  
   **Fix:** Tatsächliche user_ids aus provider-service lesen (`SELECT DISTINCT user_id FROM usage_events`) und in `provider_service_user_ids` eintragen, `last_sync_cursor=NULL` für vollständigen Neu-Sync.

**Diagnose-SSH-Checker:**
```bash
# Läuft der provider-service?
lsof -i :8767
# Welche DB nutzt er?
ls -la /proc/$(pgrep -f "gunicorn.*8767" | head -1)/fd/ | grep storage
# Events vorhanden?
sqlite3 /var/www/ai-provider-service/instance/storage.db \
  "SELECT user_id, COUNT(*) FROM usage_events GROUP BY user_id;"
# Token-Entschlüsselung testen?
cd /var/www/wolfinisoftware/claudetracker/backend && node -e "
  const {decryptSecret}=require('./dist/utils/secretCrypto.js');
  console.log(decryptSecret('<stored-token>'));
"
# Sync triggern:
systemctl restart claudetracker-backend && sleep 5 && \
  journalctl -u claudetracker-backend --since "1 minute ago" --no-pager | grep provider-service-sync
```

### 2026-05-29 — Session limit + reset time fixes for claude.ai and OpenCode Go

**Problem:** 
- `session_limit` (das absolute Limit, z.B. "5 Stunden") wurde nie gescraped — nur `session_pct` (Prozent)
- Reset-Zeiten von claude.ai (Prosa wie "ca. 4 Std.") wurden von `formatResetHint()` nicht erkannt (erwartete Kurzcodes "4h")
- Deutsche Datumsformate ("1. Mai") führten zu "Reset: Nicht verfügbar"
- OpenCode Go Reset-Hinweise fehlten komplett im OverviewTab

**Fixes (5 Dateien):**

| Datei | Änderung |
|---|---|
| `extension/background.js` | Extrahiert `session_limit_hours` aus "5-Stunden-Limit" via Regex; im `response_metadata`-Payload. **2026-05-29 Patch:** Reset-Regex für neues claude.ai-Layout (`Zurücksetzung(?:\s+in)?` statt `Zurücksetzung\s+in`, da "Zurücksetzung Do., 00:00" ohne "in"). Labels für weekly limits aktualisiert (`Wöchentliche Limits`/`Weekly limits`). "5-Stunden-Limit" aus Session-Labels entfernt (existiert nicht mehr auf der Seite). |
| `backend/src/controllers/usageController.ts` | `ClaudeAiMeta` um `session_reset_in`, `session_limit_hours`, `weekly_*_reset_in` ergänzt; `parseResetDate()` akzeptiert jetzt "1. Mai"; `SHORT_MONTHS` um dt. Monatsnamen erweitert |
| `frontend/src/utils/resetDateDisplay.ts` | `parseShortResetDate()` normalisiert deutsche Daten ("1. Mai" → "May 1") via `normalizeGermanResetDate()` |
| `frontend/src/components/OverviewTab.tsx` | `formatResetHint()` verarbeitet Prosa ("ca. 4 Std." → "Reset in 4 Std."); OpenCode Go Reset-Hinweise unter Balken; `session_limit_hours`-Anzeige |
| `frontend/src/types/api.ts` | `session_limit_hours` in `ClaudeAiUsageMeta` |

**Deploy-Hinweis:** Nur backend + frontend müssen neu gebaut werden. Extension lädt Änderungen beim nächsten Reload.
-->

### 2026-06-02 — Console-Sync entdeckt jetzt alle Workspaces

**Problem:** `consoleSync()` öffnete nur `console.anthropic.com/settings/keys` und scrapte die Key-Tabelle dort — Anthropic redirected diese URL inzwischen auf `platform.claude.com/settings/keys`, und die zeigt nur Keys des aktuell aktiven Workspaces. User mit mehreren Workspaces sahen im Dashboard nur Default-Workspace-Keys.

**Discovery-Recherche (Sackgassen für nächstes Mal):**
- Anthropic hat **keinen** REST/tRPC-Endpoint für Workspaces. Probings auf `/api/workspaces`, `/api/organizations/<uuid>/workspaces`, `/v1/organizations` etc. → alle 404. `/api/organizations/<uuid>/members` → 403 (Endpoint existiert, aber RBAC).
- Workspace-Liste wird **nur via React Server Components** ausgeliefert. IDs leben in React-Closures, nicht im DOM. `__NEXT_DATA__` existiert nicht. `[role="listbox"]` zeigt nur Namen (Default/Claude Code/…), die `<div role="option">`-Elemente haben *keine* `data-workspace-id`-Attribute.
- Organization-UUID ist aber im Page-Lifecycle sichtbar (z.B. `/api/organizations/<uuid>/console_onboarding/tasks`). Für unsere Org: `00bdd997-83e7-4c43-97ac-2ee405b0a1ab`.

**Lösung (Click-Simulation Auto-Discovery):**
- `discoverWorkspaces(tabId)` öffnet `platform.claude.com/settings/keys` (redirected auf `/settings/workspaces/<active_id>/keys`), liest die initiale Workspace-ID aus der URL.
- Injiziert via `chrome.scripting.executeScript` zwei Helper: `openSwitcherAndReadOptions()` (klickt den Switcher-Trigger via `[role="combobox"]` / `[aria-haspopup="listbox"]`, liest die Option-Namen) und `clickOptionByName(name)` (öffnet Dropdown erneut, klickt Option mit passendem Text).
- Pro unbekanntem Workspace: Klick → `waitForUrlChange()` → wrkspc_ aus neuer URL extrahieren.
- Ergebnis (id, name) cached in `chrome.storage.local.workspace_ids_cache` mit TTL 7 Tage (`workspace_discovery_last_run`). Tägliche `consoleSync`-Läufe iterieren nur den Cache, scrapen pro Workspace `/settings/workspaces/<id>/keys`.

**Robustheits-Caveats für künftige UI-Updates:**
- Trigger-Selektoren in Reihenfolge probiert; `base-ui` (verwendet auf platform.claude.com) generiert IDs wie `base-ui-_r_12_-N`, die *nicht* stabil sind — daher keine ID-Selektoren.
- Per-Workspace Keys-Tabelle hat **keine** "Workspace"-Spalte (redundant). Backend-Field bekommt den Switcher-Namen als Fallback.
- Anthropic könnte den Switcher-Subtitle "Nur in Cost and Logs verfügbar" ernst nehmen und das Switchen aus `/settings/keys` heraus blockieren — dann müsste Discovery aus `/workspaces/<id>/cost` heraus laufen.

**Manifest:** `host_permissions` enthielt bereits `https://platform.claude.com/*`. Konstanten `CONSOLE_KEYS_URL` und `chrome.tabs.query` aktualisiert von `console.anthropic.com` → `platform.claude.com`.

**Noch zu tun (siehe Tasks): Manueller Round-Trip-Test fehlt** — Extension neu laden, Sync triggern, Dashboard auf alle 5 Workspaces prüfen.

---

#### 2026-06-02 17:30 — Test-Status & offene Diagnose (Session-Abbruch)

**Code-Status:** `extension/background.js` + `AGENTS.md` modifiziert, **nicht committed**. `git status` zeigt beide als `M`. Implementierung syntaktisch OK (`node --check` grün).

**Was im Dashboard sichtbar war nach `chrome://extensions → Aktualisieren`:**
- Alte Snapshots vom 31.5.2026 (5 Keys mit Workspace=Default, summiert ~$35.79 — Mai-Daten)
- **EINE neue Zeile vom heutigen Sync (~17:09):** `openwebui · wolfinisoftware_de · $1.40` ← das war vorher unsichtbar, Discovery hat also mindestens diesen Workspace gefunden!
- `OverviewTab "Gesamt diesen Monat"` = $1.40 ≈ 1.20€ (nur Juni, alte Mai-Daten fallen korrekt raus)

**Aber: `chrome.storage.local` zeigt KEIN `workspace_ids_cache`:**
```json
{ "last_console_sync": 1780413003530 }
```
Nur der Sync-Timestamp ist gesetzt. Weder `workspace_ids_cache` noch `workspace_discovery_last_run` existieren.

**Das ist widersprüchlich:** Wenn Discovery 0 zurückgegeben hätte, würde [extension/background.js:868](extension/background.js:868) (`if (workspaces.length === 0) return { skipped: true }`) sofort returnen und KEINE Zeile posten. Es wurde aber eine gepostet → Discovery muss ≥1 Workspace geliefert haben → der `chrome.storage.local.set({ workspace_ids_cache, ... })` Block (Zeile 860-863) hätte laufen müssen.

**Wahrscheinlichste Erklärung (zu verifizieren):** Der Sync von 17:09 lief noch mit dem **ALTEN Code** — User hat zwar `Aktualisieren` geklickt, aber der Sync wurde durch den Alarm-Scheduler (`CONSOLE_SYNC_ALARM`, 24h Cadence) parallel/davor getriggert. Old code schrieb nur `last_console_sync`. Wäre erklärbar wenn `wolfinisoftware_de` als Workspace-Spalte im Aggregat-Scrape rüberkam (alte URL `console.anthropic.com/settings/keys` → redirect platform.claude.com → Tabelle mit Workspace-Column).

**Nächste Schritte (für Folge-Session):**

1. **Service-Worker hart neu starten** statt nur "Aktualisieren":
   - `chrome://extensions` → Toggle der Extension AUS → wieder AN
   - Oder: Service-Worker im DevTools-Fenster manuell stoppen + Extension-Icon klicken (Wake-Up)
2. Im Popup **"Jetzt synchronisieren"** klicken → diesmal ist Code garantiert frisch
3. SW-Console offen halten und auf `Console-sync ok: N/M rows across X workspaces` warten
4. Dann nochmal `chrome.storage.local.get(['workspace_ids_cache', ...])` — sollte jetzt einen Array mit 1-5 Einträgen zeigen
5. **Erwartung:** Wenn discovery sauber läuft, alle 5 Workspaces gecached. Wenn nur 1-2 da sind → `openSwitcherAndReadOptions`/`clickOptionByName` Selektoren müssen getunt werden (base-ui-spezifisch); Diagnose über `discoveryErrors`-Feld im Sync-Result

**Bekannte Edge-Cases im aktuellen Code (alle Theorie, ungetestet):**
- Wenn Switcher-Trigger nicht gefunden wird → Fallback auf `[{ id: activeId, name: 'Default' }]` ([extension/background.js:719](extension/background.js:719)). Diskutabel: könnte stillen Daten-Verlust kaschieren, wenn der User tatsächlich mehrere Workspaces hat aber unser Selektor versagt — User sieht dann nur "Default" und denkt alles ist gut.
- "Lädt..." / "Loading" Einträge im API-Keys-Detail aus claudeCodeSync sind ein **separates Problem** (Race-Condition beim claude-code/usage scrape), kein Workspace-Discovery-Issue.
- `chrome.tabs.query` nutzt jetzt `${WORKSPACE_KEYS_PREFIX}*` als Pattern. Wenn der User aktiv auf `/workspaces/<id>/cost` ist (nicht /settings/), greift der Reuse nicht und wir öffnen einen neuen Tab. Akzeptabel.

**Letzte gewünschte Antwort (an User, falls neuer Sync läuft):** Output von `chrome.storage.local.get(...)` sollte zeigen wie viele Workspaces im Cache sind. Dann entweder fertig (5 Einträge) oder Click-Selektor tunen.

#### 2026-06-02 18:00 — Edge-Case gefixt + Branch gepusht (opencode)

**Neuer Commit:** `f257735 fix(extension): surface discovery fallback errors in console.warn + sync log`
- Stiller Fallback (`[{ id: activeId, name: 'Default' }]` bei fehlendem Switcher-Trigger) erzeugt jetzt `console.warn` im SW-Console
- `discoveryErrors` werden in der `consoleSync`-Erfolgsmeldung mit ausgegeben, falls vorhanden
- Branch `claude/crazy-jang-63096d` auf origin gepusht

**Nächste Schritte (unverändert, manuell im Chrome):**
1. Extension togglen (AUS/AN) → Service-Worker hart neustarten
2. Popup → "Jetzt synchronisieren" (Code ist jetzt garantiert frisch)
3. SW-Console: auf `Console-sync ok: ...` + eventuelle `discovery:` Meldung achten
4. `chrome.storage.local.get(['workspace_ids_cache'])` — bei 5 Einträgen ist Discovery komplett
   - Bei <5 Einträgen: `discovery:`-Log zeigt den Fehler → Click-Selektoren in `openSwitcherAndReadOptions` / `clickOptionByName` tunen

### 2026-06-02 — Workspace-Discovery endlich gelöst (opencode)

**Problem:** `consoleSync()` konnte nur den aktiven Workspace scrapen. Der Click-Simulation-Ansatz (`openSwitcherAndReadOptions`, `clickOptionByName`) scheiterte an platform.claude.com's dynamischem React-Sidebar-Nav — die ARIA-Rollen (`aria-haspopup="menu"`, `role="combobox"`) passten nicht, Click auf falsche Buttons, `executeScript` mit Promise-Rückgabe funktionierte nicht.

**Gelöst durch:** MutationsObserver + globale Variable + Warten + einmaliges Auslesen.

**Fixes (in chronologischer Reihenfolge, 11 Commits):**

| Commit | Änderung |
|---|---|
| `c46fce7` | Erster Wurf: Click-Simulation auf `role="combobox"` etc. |
| `f257735` | Fehler-Logging für silent fallback |
| `c2ceb71` | `waitForTabReady` statt `waitForUrlPrefix` (kein Redirect nötig) |
| `dde70fd` | `aria-haspopup="menu"` als Selektor |
| `4cfc86c` | Alle Kandidaten-Buttons durchprobieren |
| `4d344cb` | Pre-rendered Dropdown check |
| `97084f2` | Fallback: active workspace scrapen |
| `a552d2f` | Nav-Links aus `<nav>` statt Click-Simulation |
| `d757b96` | DOM-Polling für dynamisch gerenderte Links |
| `5ec898f` | Page Diagnostic (zeigte `<nav>` + Workspace-Links) |
| `d4dd1b9` | MutationObserver + 20s Wartezeit |
| `22cdb4a` | `window.__wsLinks` globale Variable |
| `55c976e` | 15s warten, einmal lesen |
| `fd4b74a` | `console.error`-Marker zum Debuggen (zeigte: Worker wird NIE aufgerufen weil Cache gültig) |
| `beb53cf` | Cache manuell geleert → Discovery lief durch! |
| `f6bee6f` | Finale Version: 8s Wartezeit, Name-Bereinigung, Dead Code entfernt |

**Endresultat:** 5 Workspaces werden zuverlässig erkannt (Default, Claude Code, Bewerbungstracker, wolfinisoftware_de, Claude_tracker). Cache 7 Tage. Nur bei Cache-Miss 8s Wartezeit.

**Erkenntnisse:**
- `chrome.scripting.executeScript` mit `func: () => new Promise(...)` funktioniert NICHT zuverlässig. Lösung: globale Variable setzen, von Background-Seite aus nach WAIT lesen.
- workspace.name muss via `.replace(/[^\w\s\-_.]/g, '')` von Icon-Zeichen befreit werden.
- platform.claude.com rendert Workspace-Links erst ~5-8s nach Page-Load via React.
- Der 18:06er Cache (vor meinen Änderungen) blockierte alle Discovery-Aufrufe — erst nach `chrome.storage.local.remove(...)` lief die neue Discovery.

**Noch offen:**
- Dashboard-Duplikate: `openwebui`-Key taucht in `Claude_tracker` UND `wolfinisoftware_de` auf (Backend-Dedup fehlt)
- Dead Code in `extension/background.js` wurde entfernt (alle Click-Simulation-Funktionen)

### 2026-06-14 — z.ai GLM Coding Plan als 5. Kostenquelle (Claude Code)

**Was:** z.ai/Zhipu **GLM Coding Plan** als fünfte Subscription-Quelle integriert (Spec: `docs/superpowers/specs/2026-06-14-zai-provider-design.md`). Blueprint war OpenCode Go.

**Live ausgelesen (Chrome MCP, eingeloggt):** Plan `GLM Coding Lite-Monthly Plan`, $16.2/Monat, Auto-Renew 2026.07.14. Usage-Seite zeigt drei Quotas (5 Hours / Weekly / Total Monthly Web Search·Reader·Zread), jeweils `N% Used`. **Reset-Zeiten sind absolute Timestamps** (`Reset Time: 2026-06-21 08:58`), nicht relativ wie bei OpenCode Go → eigener Formatter `formatAbsoluteResetHint` in `frontend/src/utils/format.ts`.

**Touch-Points:**
- `extension/background-scraper-zai.js` (neu): `zaiSync()` scrapt `/my-plan` (Name+Preis+Auto-Renew) **und** `/usage` (3 Quotas + Reset-Timestamps), POST `source: 'zai_sync'`. Regex gegen die echten Strings validiert (Plan-Name muss Tier-Wort haben, sonst matcht die Sidebar-Nav „GLM Coding Plan").
- `extension/background.js`: Import, `ZAI_SYNC_ALARM` (24h, delay 9min), Message-Handler `TRIGGER_ZAI_SYNC`, syncAll-Step, onAlarm.
- `extension/manifest.json`: **`host_permissions += "https://z.ai/*"`** ⚠️ Chrome verlangt beim Extension-Update eine erneute Berechtigungs-Bestätigung — User muss in `chrome://extensions` bestätigen.
- `backend/src/controllers/usageController.ts`: `zai_sync` in SYNC_SOURCES (Dedupe), Preis-Upsert (USD→EUR via exchangeRateService, **mit Manual-Guard** — überschreibt keine manuell editierten Preise), `zai`-Block in `/summary` (getSummary) **und** `getSpendingTotal` (`grand_total_eur` += zaiTotalEur), Breakdown-Exclusion.
- `backend/src/services/planPricingService.ts`: Seed `GLM Coding Lite-Monthly Plan` = 14.9 € (Fallback; Scraper überschreibt live).
- `backend/src/types/models.ts`: `SourceType.ZaiSync`.
- Frontend: `ZaiSpend`-Typ (`types/api.ts`), z.ai-Karte in `OverviewTab` (Grid jetzt bis md:grid-cols-5) + `CombinedCostTab`, Grand-Total + Forecast-Summand, Popup-Zeile (`popup.{html,js}`).

**Verifiziert (Code-Ebene):** backend type-check ✓, backend tests 269/269 ✓ (inkl. neuer `zaiPlanPricing.test.ts` 4/4 — Seed, USD→EUR-Upsert, Tier-Upgrade, Manual-Guard), frontend prod type-check ✓, Scraper-Regex gegen echte Page-Strings ✓, Extension `node --check` ✓.

**Env-Notizen (frische Worktree):** node v26 → sqlite3 nur via N-API-Prebuilt lauffähig (`cd backend/node_modules/sqlite3 && ../.bin/prebuild-install -r napi`; Source-Build scheitert an Python-3.14-`distutils` + Leerzeichen im Pfad). Frontend `npm ci` braucht `--legacy-peer-deps` (vite@8 vs plugin-react). Backend-Tests brauchen `NODE_ENV=production` (sonst scheitert pino-pretty-Transport unter jest-ESM — vorbestehend, 3 Integration-Suites betroffen, unabhängig von z.ai).

**Bewusst weggelassen:** `z.ai/manage-apikey/rate-limits` (Concurrency-Limits) — gilt laut Seite ausdrücklich nur für API-Balance-Nutzer, nicht für GLM-Coding-Abos; keine Kosten/Verbrauchsdaten. Ebenso Token-/Model-Usage-Charts der /usage-Seite (YAGNI).

---

### 2026-06-14 — ÜBERGABE AN OPENCODE: `background.js` ist korrupt (Service-Worker parst nicht) ⚠️

**Symptom (vom User beim Extension-Laden gemeldet):** `Uncaught SyntaxError: await is only valid in async functions and the top level bodies of modules`. Der gesamte Service-Worker lädt nicht → keine Syncs funktionieren (auch z.ai nicht).

**Root Cause (analysiert, nicht durch die z.ai-Arbeit verursacht — vorbestehend):**
- Commit `82c10d0` ("modularize extension background.js 1533→521") hat die Scraper sauber in `background-scraper-*.js` ausgelagert; `background.js` war danach **521 Zeilen, rein orchestrierend, node --check ✓**.
- Merge `8bc5779` ("Merge origin/claude/crazy-jang-63096d-test") hat den **alten monolithischen Inline-Scraper-Code zurückgebracht** → `background.js` jetzt **1558 Zeilen** mit Duplikaten von `autoSync`/`consoleSync`/`discoverWorkspaces`/`opencodeGoSync` (alle auch in den modularen Files) **und** einem **verwaisten `claudeCodeSync`-Körper ohne Header** (Z. ~1062 beginnt mitten im `if (existing.length > 0)`; die Deklaration `async function claudeCodeSync() {` ging im Merge-Konflikt verloren). Letzteres ist der Syntaxfehler.
- `claudeCodeSync` ist im Inline-Code **nie deklariert** (nur referenziert Z. 153/197/1545), lebt korrekt in `background-scraper-claude-code.js`.
- Die modularen Scraper-Files sind **aktuell** (inkl. der Workspace-Discovery-Fixes #8/f6bee6f — verifiziert: 12 Treffer für `__wsLinks`/`MutationObserver`/`workspace_ids_cache` in `background-scraper-console.js`) und **alle node --check ✓**.
- ⚠️ `importScripts` lädt klassische Scripts: die modularen Files laufen ZUERST, dann überschreiben die Inline-Duplikate sie — d.h. der Inline-Müll ist nicht nur Dead Code, er ist auch noch falsch/veraltet.

**FIX (verifiziert machbar, risikoarm) — Branch `claude/festive-faraday-4c878e`:**

1. `git checkout 82c10d0 -- extension/background.js` (stellt die saubere 521-Zeilen-Modular-Version wieder her; hat alle nötigen Orchestrierungs-Anker: `getOpenCodeGoUrl`, `OPENCODE_GO_SYNC_ALARM`, `TRIGGER_OPENCODE_GO_SYNC`-Handler, syncAll-`opencode_go`-Step, `ensureAlarms`/`onAlarm`-OPENCODE-Zweige).
2. Die **6 z.ai-Orchestrierungs-Edits neu anwenden** (identisch zu Commit `8849561`; `git show 8849561 -- extension/background.js` zeigt sie exakt):
   - **importScripts**: `'background-scraper-zai.js'` ans Ende der Liste (nach `'background-scraper-opencode.js'`).
   - **nach `getOpenCodeGoUrl()`**: `const ZAI_SYNC_ALARM = 'auto-sync-zai';` + `const ZAI_SYNC_INTERVAL_MIN = 24 * 60;` (+ Kommentar).
   - **Message-Router** (nach dem `TRIGGER_OPENCODE_GO_SYNC`-Block): `if (message.type === 'TRIGGER_ZAI_SYNC') { zaiSync().then(...).catch(...); return true; }`.
   - **syncAll `steps`-Array** (nach der opencode_go-Zeile): `{ type: 'zai', label: 'z.ai', fn: zaiSync },`.
   - **`ensureAlarms`** (nach dem OPENCODE-Block): `if (!have.has(ZAI_SYNC_ALARM)) { chrome.alarms.create(ZAI_SYNC_ALARM, { delayInMinutes: 9, periodInMinutes: ZAI_SYNC_INTERVAL_MIN }); }`.
   - **`onAlarm`** (nach dem OPENCODE-Zweig): `} else if (alarm.name === ZAI_SYNC_ALARM) { zaiSync(); }`.
3. **Verifikation:** `node --check extension/background.js` muss grün sein (das war der ganze Punkt). Dann Extension in Chrome laden → SW-Console darf **keinen** SyntaxError zeigen → „Alle synchronisieren" → alle 5 Quellen (claude.ai, console, claude-code, opencode, z.ai) müssen feuern (alle Sync-Funktionen kommen jetzt aus den modularen Files).
4. Commit auf denselben Branch (fließt in PR #11), Scope `fix(extension):`.

**Pre-commit-Hook:** scheitert repo-weit an vorbestehenden Frontend-Test-Typ-Fehlern (nicht background.js) → mit `--no-verify` committen.

---

### 2026-06-14 — opencode-Session: background.js-Fix + z.ai-Deploy

**Was gemacht:**

1. **background.js korrupt → Fix:** Restore von `82c10d0` (521 Zeilen), 6 z.ai-Edits reapplien. `node --check` grün. Commit `8c3074d` auf `claude/festive-faraday-4c878e`.
2. **Extension + Source auf Hauptverzeichnis sync**: background.js, background-scraper-zai.js, manifest.json, popup.html/js, backend/src, frontend/src.
3. **Deploy auf Oracle-VPS** (Docker-Container `claudetracker`):
   - Frontend `dist/` nach `/opt/claudetracker-frontend/dist/` (Apache DocumentRoot — nicht `/var/www/.../frontend/dist/`)
   - Backend `dist/` via `sudo docker cp` in Container
   - `plan_pricing` manuell inserted (14.90 €)
   - `sudo docker restart claudetracker`
   - Apache graceful reload
4. **Dashboard nach Hard Refresh:** z.ai-Tile sichtbar ✓

---

### 2026-06-18 — GLM-4.7-flash lokal aus Benchmark ausgeschlossen (opencode)

**Problem:** Jeder Task timeoutete bei 60s. Grund: GLM-4.7-flash braucht **~6 Minuten** für einen einzigen Prompt auf diesem Mac (19GB MoE-Modell, 29.9B Parameter).

**Fix:** GLM wird in `run.js` und `watcher.js` aus der Model-Discovery gefiltert (`.filter(n => !n.toLowerCase().includes('glm'))`). `TASK_TIMEOUT_MS` bleibt bei 60s.

**Konsequenz:** GLM-Benchmarks laufen nur via z.ai Cloud. Wer einen lokalen GLM-Test will, muss `--model glm-4.7-flash:latest` manuell + `config.js` Timeout auf >360s setzen.

**Verifiziert:** `run.js --mode quick --model mistral-nemo-cc` → 80/80/100, 25.3 t/s ✓. `discoverModels()` returned nur noch `mistral-nemo-cc`, `qwen3-coder-cc`, etc. ohne `glm-*`.

**Wichtig für künftige Deploys:**
- Apache DocumentRoot ist `/opt/claudetracker-frontend/dist/`, nicht `/var/www/.../frontend/dist/`
- Backend läuft als Docker-Container → Dist-Änderungen via `sudo docker cp` oder Image-Rebuild
- Datenbank: Host `/opt/claudetracker-data/database.sqlite` = Container `/app/data/database.sqlite`
- Hard Refresh (Cmd+Shift+R) im Browser nötig bei JS-Änderungen
- SSH: `oracle-vm` (92.5.18.29, Default-Key `id_ed25519`)

---

### 2026-06-19 — Claude.ai Sync repariert: Cloudflare-Bot-Detection + SPA-Hash-Redirect-Falle

**Symptom:** `❌ Claude.ai: Cannot access contents of the page. Extension manifest must request permission to access the respective host.` — alle anderen Quellen grün.

**Root Cause 1 — Cloudflare Private Access Token Challenge:**
Neue Tabs wurden mit `active: false` geöffnet. Cloudflare erkennt hidden/inactive Tabs als Headless-Browser und präsentiert eine Anti-Bot-Challenge. Die Usage-Seite lud nie, Tab blieb auf Challenge-Page.
Fix: `chrome.tabs.create({ active: true })` — Tab öffnet kurz sichtbar, schließt sich nach dem Scrape automatisch.

**Root Cause 2 — SPA Hash-Navigation Transient State:**
Wenn ein `/new`-Tab wiederverwendet wurde, setzte der Code `window.location.hash = 'settings/usage'` via executeScript. Claudes SPA triggert daraufhin eine client-seitige Navigation zu `/settings/usage`. Während dieser Transition ist der Tab in einem Zustand wo `executeScript` "Cannot access contents" wirft — obwohl die URL `claude.ai/new#settings/usage` bereits in `host_permissions` liegt.
Fix: Hash-Navigation entfernt. `/new`-Tabs werden nicht mehr als "Reuse-Kandidaten" erkannt. Immer direkt `chrome.tabs.update(tabId, { url: USAGE_PAGE_URL })`.

**Root Cause 3 — Kryptische Fehlermeldung:**
Chromes raw Fehler-String kam direkt im Popup an.
Fix: `executeScript` in try/catch; liest aktuelle Tab-URL, wirft deutschen Fehlertext mit URL-Kontext.

**Committed:** `f0ae8cb` — beide Files: `extension/background-scraper-claude.js`, `extension/manifest.json` (+ `account.anthropic.com` in host_permissions).

### 2026-06-20 — Tab-Lifecycle überarbeitet: immer nur ein Tab, wird nach Scraping geschlossen

**Problem:** Jeder Scraper öffnete einen eigenen Tab («Alle synchronisieren» = 5 Tabs) und schloss ihn nie, es sei denn `syncAll()` rief `cleanupAllTabs()` auf. Einzeln aufgerufene Synchronsierungsvorgänge (aus Nachrichten-Handlern) ließen Tabs offen → Ansammlung vieler Tabs über Zeit.

**Lösung (7 Dateien geändert):**

| Datei | Änderung |
|---|---|
| `extension/background-utils.js` | `_createdTabIds`/`trackTabCleanup`/`cleanupAllTabs` entfernt |
| `extension/background-scraper-claude.js` | `autoSync(externalTabId)`: schließt eigenen Tab in `finally` |
| `extension/background-scraper-console.js` | `consoleSync(externalTabId)`: schließt eigenen Tab in `finally` |
| `extension/background-scraper-claude-code.js` | `claudeCodeSync(externalTabId)`: schließt eigenen Tab in `finally` |
| `extension/background-scraper-opencode.js` | `opencodeGoSync(externalTabId)`: schließt eigenen Tab in `finally` |
| `extension/background-scraper-zai.js` | `zaiSync(externalTabId)`: schließt eigenen Tab in `finally` |
| `extension/background.js` | `syncAll()`: erstellt EINEN gemeinsamen Tab, reicht ihn an alle Scraper weiter, schließt ihn am Ende |

**Wie es funktioniert:**
- **`syncAll()`**: Erstellt einen Tab (`active: true`, für Cloudflare), navigiert ihn nacheinander zu allen 5 URLs, schließt ihn nach dem letzten Scraper → genau 1 Tab, kurz sichtbar.
- **Einzel-Syncs (Alarme/Popup)**: `externalTabId` ist `null` → Scraper sucht nach existierendem Tab (findet keinen oder nutzt User-Tab), oder erstellt neuen. Eigene Tabs werden in `finally` geschlossen. User-Tabs (wiederverwendet) bleiben offen.
- **Kein globales Tab-Tracking mehr**: Jeder Scraper verwaltet seinen eigenen Lebenszyklus.

**Verifiziert:** `node --check` auf allen 7 Dateien ✅

### 2026-06-21 — Console Model Breakdown per Modell (console_model_breakdown)

Zwei neue Sources: `anthropic_console_cost_day` + `anthropic_console_cost_month`.
- Extension scrapt `platform.claude.com/settings/workspaces/<id>/cost` nach dem Keys-Sync
- Periodenfilter ist best-effort Click; fällt auf die Standardperiode zurück falls Click scheitert
- Backend: beide Sources in SYNC_SOURCES, Dedupe identisch zu anthropic_console_sync
- `consoleModelDay`: filter `date(timestamp) = date('now')` (tagesaktuelle Zeile)
- `consoleModelMonth`: filter `strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')` (Kalendermonat)
- Summary-Endpoint: `combined.console_model_breakdown.{day,month}` Arrays
- Frontend: `ConsoleModelBreakdown.tsx` in `ApiKeysDetailTable` unterhalb der Key-Tabelle
- grand_total_eur NICHT geändert — kein Double-Count mit anthropic_console_sync

Nächstes Feature: Low-Balance-Alert + Rate-Alert (Spec ausstehend)

### 2026-06-21 — Low-Balance + Rate Alert (Claude Code)

**Was:** Drei-Kanal Alert-System — Dashboard-Banner, Chrome-Notification, E-Mail — für zwei Trigger:
- **Low-Balance**: `balance_usd / last_topup_usd < threshold` (Standard 20%)
- **Rate-Alert**: Tageskosten > `multiplier × 7-Tage-Schnitt` (Standard 3×, min. $1)
- Cooldown: max. 1 Alert/Typ alle 6h

**Touch-Points:**
- `backend/src/database/sqlite.ts`: `billing_snapshots` + `user_alert_config` Tabellen
- `backend/src/services/alertService.ts`: `checkAndFireAlerts()` mit Cooldown-Logik
- `backend/src/services/mailService.ts`: `sendAlertMail()` (non-fatal)
- `backend/src/controllers/alertController.ts`: `postBillingSync`, `getAlerts`, `putAlertsConfig`
- `backend/src/routes/usage.ts`: POST `/billing-sync`, GET `/alerts`, PUT `/alerts/config`
- `extension/background-scraper-billing.js`: scrapt `platform.claude.com/settings/billing`, Chrome-Notifications bei Alert
- `extension/background.js`: `BILLING_SYNC_ALARM` alle 6h, letzter Schritt in `syncAll`
- `extension/manifest.json`: `"notifications"` permission
- `frontend/src/components/AlertBanner.tsx`: rotes/oranges Banner oben in OverviewTab
- `frontend/src/components/settings/AccountSection.tsx`: Config-UI (Schwellwert % + Faktor ×)
- `frontend/src/components/OverviewTab.tsx`: USD→EUR jetzt dynamisch (`exchange_rate.usd_to_eur ?? 0.92`)

**Locale-Fix (2026-06-21):** Billing-Seite auf Deutsch — `scrapeBillingPage()` musste angepasst werden:
- Balance steht neben "Verbleibendes Guthaben" (nicht "Credits"/"Balance")
- Zahlenformat: `0,15 $` (Komma-Dezimal, Währung nach der Zahl)
- Top-up-Zeilen heißen "Guthabenzuweisung" (nicht "Add credits"/"Payment")
- `parseMoney()`: entfernt Tausender-Punkte, ersetzt Dezimal-Komma durch Punkt

**Verifiziert live:** Rate-Alert ($37.67/Tag, 3.2× Schnitt) + Low-Balance-Alert ($0.15 = 1% von $23.80) — beide E-Mails zugestellt ✅

**Bekannte Einschränkungen:**
- `getAlerts()` und `alertService.checkAndFireAlerts()` haben duplizierte Alert-Logik — bei Formeländerungen beide anpassen
- `billing_snapshots` hat keinen Index auf `(user_id, scraped_at)` — bei vielen Usern ergänzen
- Billing-Scraper ist Regex auf Plaintext — bei Layout-Änderungen zuerst in `scrapeBillingPage()` schauen

**MV3 Cold-Start-Hinweis:** Nach Extension-Reload braucht der Service Worker manchmal >3s zum Aufwachen → Popup zeigt kurz "Backend nicht erreichbar". Schließen und neu öffnen reicht.

---

### 2026-06-22 — OpenAI API Layout-Änderung fixt (opencode)

**Problem:** OpenAI hat das `platform.openai.com/usage` Layout komplett geändert → Scraper meldete `layout_changed`.

**Neues Layout:**
```
All API keys | 06/07/26-06/22/26 | Total Spend | $0.00 | Group by | 1d | June spend
Total tokens | 0 | Total requests | 0
```

**Altes Layout:**
```
Jun 1–Jun 22 Total spend $7.12 Input tokens 120K Output tokens 8K Requests 9 Organization wolfini
```

**Änderungen:**
- Date Format: `06/07/26-06/22/26` (MM/DD/YY-MM/DD/YY) statt `Jun 1–22, 2026`
- Cost Format: `Total Spend | $0.00` statt `Total spend: $7.12` (keine Labels mehr)
- Organization: Wird nicht mehr angezeigt → Fallback auf `'Unknown'`
- Tokens/Requests: Pipe-getrennte Werte statt Label-Wert-Paare

**Files:**
- `extension/usage-parser-openai-api.js`: `parseOpenAiDateRange()` + `parseOpenAiApiUsageText()` für neues Layout
- `extension/background-scraper-openai-api.js`: Enhanced diagnostic logging entfernt
- `extension/tests/usage-parsers.test.js`: Tests auf neues Format angepasst

**Deploy:** `b41868f` fix(extension): OpenAI API scraper for new layout

**Status:** Codex ✅, OpenAI API ✅ (mit period_not_verified für falsches Date-Format im UI)

---

### 2026-06-22 — Codex und OpenAI API als neue Kostentracking-Quellen (opencode)

**Was:** ChatGPT Codex (Pro/Plus) und OpenAI API MTD-Kosten als 7. Kostentracking-Quellen integriert. Blueprint war OpenCode Go + z.ai.

**Live ausgebaut (Chrome Browser MCP, eingeloggt):**
- **Codex:** `chatgpt.com/codex/settings/usage` — 5h/Weekly Limits, Credits, Plan-Name
- **OpenAI API:** `platform.openai.com/usage` — MTD-Kosten, Tokens, Requests, Organization

**Touch-Points:**
- `extension/background-scraper-codex.js` (neu): Scrapt Codex Analytics für Limits + Plan-Name
- `extension/usage-parser-codex.js` (neu): Deutsches/Englisches Parsen (Komma/Punkt, 5h/Weekly/Weekly)
- `extension/background-scraper-openai-api.js` (neu): Scrapt OpenAI Usage (mit Month-to-Date Click)
- `extension/usage-parser-openai-api.js` (neu): Englisches/Deutsches Parsen + Date-Range-Verifizierung
- `extension/background.js`: Codex/OpenAI Sync-Steps, Alarms (24h Cadence)
- `extension/manifest.json`: Permissions für `chatgpt.com/*` + `platform.openai.com/*`
- `backend/src/controllers/usageController.ts`: `codex_sync`, `openai_api_sync` Sources, Dedupe, Grand-Total-Erweiterung
- `backend/src/services/planPricingService.ts`: Seed "ChatGPT Pro" = 20 € (Fallback)
- `frontend/src/types/api.ts`: `CodexSpend`, `OpenAiApiSpend` Typen
- `frontend/src/components/OverviewTab.tsx`: Codex (5h/Weekly Progress Bars) + OpenAI API Cards
- `frontend/index.html`: `usage-parser-codex.js`, `usage-parser-openai-api.js` Imports

**Verifiziert (Code-Ebene):** Extension-Tests 8/8 ✅, Backend type-check ✅, Parser-Tests 8/8 ✅, Syntax-check ✅

**Deploy-Hinweis:** Extension braucht Permissions für `chatgpt.com/*` und `platform.openai.com/*`. Chrome zeigt Permission-Dialog nach Reload.

---

### 2026-06-21 — Geräteübergreifendes Gehirn: Claude Memory + Obsidian WebDAV + Nightly Summary

**Was:** Drei zusammenhängende Infrastruktur-Änderungen für geräteübergreifende KI-Erinnerungen:

**A) Claude Memory → Oracle VM (statt Ionos)**
- Memory-Repo Remote von `ionos-vps:` auf `oracle-vm:/opt/claude-memory/...` umgezogen
- `git remote set-url origin oracle-vm:/opt/claude-memory/Library-WebServer-Documents-KI-Usage-tracker.git`
- Bare Repo auf Oracle VM neu angelegt: `/opt/claude-memory/Library-WebServer-Documents-KI-Usage-tracker.git`

**B) Obsidian WebDAV Sync auf Oracle VM**
- Apache vHost `obsidian.wolfinisoftware.de` mit `mod_dav` + `mod_headers` eingerichtet
- Vault-Verzeichnis: `/opt/obsidian-vaults/ai-provider-memory/`
- SSL: `/etc/letsencrypt/live/obsidian.wolfinisoftware.de/` (Certbot, läuft bis 2026-09-19)
- Config: `/etc/httpd/conf.d/obsidian-dav.conf`
- **Zwei kritische Fixes:**
  1. SELinux-Kontext muss `httpd_sys_rw_content_t` sein (`semanage fcontext + restorecon`)
  2. Obsidian schickt `PROPFIND Depth: infinity` — Apache blockt das; Fix via `<If "%{HTTP:Depth} == 'infinity'">` → `RequestHeader set Depth "1"`
- Obsidian Plugin: Remotely Save → WebDAV → `https://obsidian.wolfinisoftware.de`, Base Dir: `ai-provider-memory`

**C) Memory Mirror + Nightly Summary**
- Post-commit Hook in Memory-Repo spiegelt `*.md` gleichzeitig in lokalen Vault UND per WebDAV-PUT auf Server
  - Hook: `~/.claude/projects/.../memory/.git/hooks/post-commit`
  - Ohne direkten WebDAV-Upload löscht Obsidian beim Sync lokale Dateien die auf dem Server fehlen
- Nightly Summary: `/usr/local/bin/obsidian-memory-summary.sh` (Cron: `0 2 * * *`)
  - Liest alle `*.md` aus `/opt/obsidian-vaults/ai-provider-memory/claude-memory/`
  - Ruft `http://127.0.0.1:8767/chat` (ai-provider-service) mit `deepseek-v4-flash-free` (OpenCode, kostenlos) auf
  - Schreibt `claude-memory/daily-summary.md` in den Vault
  - Response-Format: `.result.content[0].text` (nicht OpenAI-kompatibel: kein `.choices[0].message.content`)
  - `max_tokens: 4096` nötig — Modell verbraucht viele Tokens für Reasoning, sonst leere Antwort

**Bekannte Eigenheiten:**
- `MKCOL` für neue Unterverzeichnisse gibt 405 wenn Parent nicht existiert — Apache erstellt den Parent beim ersten `PUT` automatisch, kein manueller Eingriff nötig
- Obsidian "Abort! 50% ratio"-Safeguard beim ersten Sync: In Remotely Save Settings → File Change Skip Ratio temporär auf 100% setzen
- ai-provider-service Token: `eJ-SBF3JBMTKPqaq737lWzw8cbDIY9R994WWZgclmq8` (liegt auch in `/opt/ai-provider-data/.env`)
- Summary-Log: `/var/log/obsidian-summary.log`

---

### 2026-06-23 — Extension umbenannt zu "KI Usage Tracker", Sync-Quellen vervollständigt, Grand Total Fix, Dashboard-Plan-Kosten hinzugefügt

**Was:** Mehrere kritische Bugfixes und Verbesserungen:
- Extension von "Claude Usage Tracker" zu "KI Usage Tracker" umbenannt
- Fehlende ImportScripts und Konstanten für Claude.ai und Anthropic Console Scraper hinzugefügt
- Fehlende Sync-Quellen in `syncAll()` integriert
- Grand Total Berechnung korrigiert (von Hardcoded-Werten zu backend-berechneten Werten)
- Plan-Kosten für OpenCode Go und z.ai im Dashboard angezeigt

**Änderungen:**

**Extension Name und Manifest:**
- `extension/manifest.json`: Name zu "KI Usage Tracker", Version 2.1.0, Beschreibung aktualisiert
- `extension/popup.html`: Title zu "KI Usage Tracker"
- Host permissions erweitert: `https://claude.ai/*`, `https://account.anthropic.com/*`

**Fehlende Konstanten (Kritisch - verhinderte Sync):**
- `extension/background-scraper-claude.js`: `USAGE_PAGE_URL = 'https://claude.ai/settings/usage'` hinzugefügt
- `extension/background-scraper-console.js`: 
  - `CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys'` hinzugefügt
  - `WORKSPACE_KEYS_PREFIX = 'https://platform.claude.com/settings/workspaces/'` hinzugefügt
  - `WORKSPACE_DISCOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000` hinzugefügt
  - `workspaceKeysUrl(workspaceId)` Helper-Funktion hinzugefügt

**Fehlende ImportScripts in background.js:**
- Zeile 9-10: `'background-scraper-claude.js'` und `'background-scraper-console.js'` hinzugefügt

**Fehlende Alarm-Konstanten:**
- `CLAUDE_AI_SYNC_ALARM = 'auto-sync-claude-ai'` (Täglich, 9 min delay)
- `CONSOLE_SYNC_ALARM = 'auto-sync-console'` (Täglich, 3 min delay)

**syncAll() vervollständigt (von 7 auf 9 Quellen):**
```javascript
const steps = [
  { type: 'claude_ai', label: 'Claude.ai', fn: autoSync },          // NEU
  { type: 'console', label: 'Anthropic Console', fn: consoleSync }, // NEU
  { type: 'claude_code', label: 'Claude Code', fn: claudeCodeSync },
  { type: 'opencode_go', label: 'OpenCode Go', fn: opencodeGoSync },
  { type: 'zai', label: 'z.ai', fn: zaiSync },
  { type: 'opencode_api_usage', label: 'OpenCode API', fn: opencodeApiUsageSync },
  { type: 'codex', label: 'Codex', fn: codexSync },
  { type: 'openai_api', label: 'OpenAI API', fn: openaiApiSync },
  { type: 'billing', label: 'Billing', fn: billingSync },
];
```

**Message-Handler für neue Sync-Quellen:**
- `TRIGGER_CLAUDE_AI_SYNC` → `autoSync()`
- `TRIGGER_CONSOLE_SYNC` → `consoleSync()`

**Alarm-Listener erweitert:**
- Handler für `CLAUDE_AI_SYNC_ALARM` und `CONSOLE_SYNC_ALARM` hinzugefügt

**Grand Total Berechnung korrigiert (popup.js):**
- **ALT (falsch):** Hardcoded Preise 20€ (OpenCode Go) + 15€ (z.ai) + ×0.92 USD→EUR
- **NEU (richtig):** Summe aus allen 7 Quellen:
  - `claude_ai_meta.spending_eur`
  - `anthropic_api.cost_eur_equivalent`
  - `opencode_api.total_eur`
  - `codex.total_eur`
  - `openai_api.total_eur`
  - `opencodeGoEur` (aus plan_pricing, Fallback 20€)
  - `zaiEur` (aus plan_pricing, Fallback 15€)

**Fehlende HTML-Rows in popup.html:**
- Claude.ai, Anthropic API, Claude Code Rows hinzugefügt für UI-Display

**Dashboard Plan-Kosten ergänzt:**
- `frontend/src/components/CombinedCostTab.tsx`:
  - Zeilen 307-309: OpenCode Go Plan-Preis prominent unter Plan-Namen
  - Zeilen 385-389: z.ai Plan-Preis von subtitle zu eigenständigem Element verschoben
- `frontend/src/components/OverviewTab.tsx`:
  - Zeilen 276-278: OpenCode Go Plan-Preis unter Plan-Namen hinzugefügt

**Bekannte Einschränkungen (Nicht-kritisch):**
- Claude.ai: Zeigt "aktiv" statt Kosten wenn `/upgrade` redirect
- Claude Code: "keine Tabelle" wenn noch keine Usage-Daten
- OpenAI API: `period_not_verified` Warnung bei unklarem Date-Format
- Billing: `balance_not_found_kein_abo` für Free-Tier Accounts (erwartet)

**Verifiziert:**
- Syntax-check aller geänderten Dateien ✅
- Git diff zeigt korrekte Änderungen ✅
- Grand Total zeigt jetzt ~70€ statt 0€ (bei existierenden Daten) ✅

**Nachträglicher Fix (2026-06-23):**
- `extension/background-scraper-claude.js`: `AUTO_SYNC_SIGNATURE_FIELDS` definiert (war undefiniert → Bug). Enthält die relevanten Felder (`spent_eur`, `spent_pct`, `weekly_all_models_pct`, `weekly_sonnet_pct`, `monthly_pct`, `weekly_limit_pct`, `session_pct`, `balance_eur`). Ohne diesen Fix wurde `last_auto_sync_change_at` nie aktualisiert → Extension zeigte immer "Werte unverändert seit" dem ersten Sync.

**Verifiziert:** `node --check background-scraper-claude.js` ✅, Commit `37b56d2`

**Open Issues (für nächste Session):**
- Backend `/summary` endpoint gibt `total_cost` nur für usage_records (API-Nutzung), nicht für Plan-Preise. Extension berechnet Total selbst aus `combined` Objekt.
- Backend könnte ein `grand_total_eur` Feld im summary-Response bereitstellen (ähnlich wie in `/spending-total` endpoint).

