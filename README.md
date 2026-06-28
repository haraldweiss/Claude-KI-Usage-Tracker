# KI Usage Tracker

A web application + browser extension that tracks the **real cost** of using AI across seven sources — claude.ai subscription, Anthropic Console API keys, Claude Code, OpenCode Go, z.ai GLM Coding Plan, ChatGPT Codex, and OpenAI API usage — and surfaces it as a single number on a unified dashboard with proactive alerts.

**Status**: ✅ Phase 5 — Multi-Source Cost Tracker (live on VPS, Plan-B architecture, multi-user auth)

---

## 🔑 Sign Up (hosted instance)

> This section applies to the publicly hosted instance at `https://wolfinisoftware.de/claudetracker/`. Skip it if you are running locally — local dev has no auth by default.

1. **Visit the dashboard URL** in your browser. You will be redirected to the login page.
2. **Enter your email address** and click "Magic-Link senden". Check your inbox for a login email (valid for 15 minutes, single-use).
3. **Click the link** in the email. You are now logged in with a 30-day rolling session — no password needed.
4. **Generate an API token**: open **Settings → API Token**, click "Generate", and copy the token. This is what the extension uses to authenticate its sync calls.
5. **Install the extension** (see §4 of Quick Start below) and paste the token into the extension popup's "⚙️ Verbindung" panel → **API Token** field → "Speichern".

> **Mail deliverability tip:** the sender domain must have valid SPF, DKIM, and DMARC records, or magic-link emails may land in spam. Check `Settings → Admin` if you are the first user; the first registered email address is automatically granted the admin role.

---

## 🎯 What it does

The dashboard tells you, in one number, what your AI tools actually cost you this month. It pulls from seven otherwise-disconnected places:

1. **claude.ai/settings/usage** — the consumer subscription page (Plan name, Zusatznutzung, weekly limits)
2. **platform.claude.com/settings/keys** — Anthropic Console workspace API keys + their cumulative cost
3. **platform.claude.com/claude-code** — Claude Code keys with cost + lines-of-code metrics
4. **opencode.ai** — OpenCode Go workspace subscription usage quotas (plan, continuous/weekly/monthly usage %)
5. **z.ai/my-plan** — GLM Coding Plan subscription (plan name, price, auto-renew date, 5h/weekly/monthly quota %)
6. **chatgpt.com/codex/settings/usage** — ChatGPT Codex limits (5h/Weekly remaining %, credits, plan name)
7. **platform.openai.com/usage** — OpenAI API month-to-date spend, tokens, requests, organization
5. **z.ai/manage-apikey/coding-plan** — GLM Coding Plan subscription (plan name + monthly price from `/my-plan`, 5-hour/weekly/monthly quota % + absolute reset times from `/usage`)
6. **chatgpt.com/codex/settings/usage** — ChatGPT Pro/Plus Codex usage (5-hour/weekly/monthly limits, credits, interactions, plugin calls)
7. **platform.openai.com/usage** — OpenAI API month-to-date spend (organization, total tokens, total requests, cost)

The system uses a **hybrid scraping architecture**: a **server-side Playwright scraper** on the Oracle VM handles sources without Cloudflare (OpenAI API, Claude.ai), while the **browser extension** scrapes Cloudflare-protected sites (platform.claude.com, chatgpt.com, opencode.ai, z.ai) in the user's real Chrome session. Both post to the same backend API, and the React dashboard renders the combined data.

### Why scraping, not the Anthropic API?

The official Usage/Cost API requires an Admin Key (organization-level credential). This tool was built for users who *don't* have one but can log into the same pages a human would. The extension reuses your already-logged-in browser session and pulls the same numbers Anthropic shows you — no extra credentials, no extra billing surface.

> **Trade-off:** scraping is fragile. If Anthropic redesigns one of the pages, that source breaks until the selectors are updated. The extension fails open: when one scraper can't find data, it logs and skips, the other sources still work.

---

## ✨ Features

### Cost tracking
- **Six sync sources**: claude.ai (every 10 min), Anthropic Console (every 24h), Claude Code (every 24h, 5 min offset), OpenCode Go (every 24h, 7 min offset), z.ai GLM Coding Plan (every 24h, 9 min offset), Billing/Credit balance (every 6h). Configurable; manual triggers from the popup or the service-worker console.
- **Plan subscription pricing** in an editable Settings table (Pro 18 €, Max 5x 99 €, Max 20x 199 €, Team 30 €, OpenCode Go $10, GLM Coding Lite ~15 €). Anthropic plans are seeded once; OpenCode Go price is auto-fetched daily from opencode.ai/go; the z.ai plan price is scraped live from `/my-plan` per sync and converted USD→EUR (manual edits in the table are preserved).
- **USD → EUR conversion** via [Frankfurter](https://api.frankfurter.app) (ECB-backed, free, no API key). Refreshed daily; falls back to the last persisted rate if the API is briefly unreachable.
- **Self-maintaining model pricing**: bundled snapshot covers Claude 4.x (Opus 4.7, Sonnet 4.6, Haiku 4.5), 3.7 line, and legacy models. Daily LiteLLM sync keeps prices current as Anthropic ships new ones.
- **History retention**: claude.ai snapshots are kept one-per-day so monthly diffs and all-time totals survive even though the page only ever shows the current month.
- **Console model breakdown**: per-model cost table (last 24h + current month) scraped from the Anthropic Console cost page — shows which model drove a cost spike without visiting the Console manually.

### Proactive alerts
- **Low-Balance alert**: fires when API credits fall below a configurable % of the last top-up (default 20%). Delivers via dashboard banner, Chrome notification, and email.
- **Rate alert**: fires when today's API cost exceeds a configurable multiple of the 7-day daily average (default 3×, minimum $1 threshold). Same three channels.
- **Configurable thresholds**: low-balance % and rate multiplier adjustable in Settings → Account.
- **Cooldown**: at most one alert per type per 6 hours — no spam on repeated syncs.
- **Handoff alert**: when any usage quota (hourly/weekly/monthly/rolling) reaches ≥90%, the system creates an AGENTS.md handoff entry + git commit via launchd (stündlich), so a follow-up agent can take over without data loss. Dashboard banner + Popup-Banner warnen.

### Dashboard
- **Übersicht (Overview)**: hero number in EUR, alert banners (low-balance / rate spike) at the top, "Aktive Abos" subscription summary bar, status cards (Plan, Wochenlimits with colour-shifting progress bars, Budget, **Anthropic API card** with workspace breakdown + balance + daily burn rate, OpenCode Go and z.ai usage-quota cards, Codex limits, OpenAI/OpenCode API costs), forecast card extrapolating today's daily rate to month-end, monthly trend block (≥ 2 months), sync-status footer.
- **Modelle (Models)**: per-key detail table (key/member, source badge, workspace, cost, lines, last sync) with a per-model cost breakdown panel (last 24h / current month toggle) — pinpoints which model drove a spike without opening the Console.
- **Gesamtkosten (Combined cost)**: same per-key table, plus a clearer "this month vs. all-time" split with a collapsible monthly breakdown (Plan-Abo + Zusatznutzung + total per month), and OpenCode Go + z.ai cards showing usage progress bars with reset timers.
- **Recommendations**: multi-provider insights driven by live sync data — provider cost ranking (biggest cost driver), subscription vs variable cost split, utilization cross-check across ALL providers (>75% limit warnings), plan right-sizing (claude.ai weekly usage), monthly-limit forecast, Claude Code key efficiency comparison. Plus an interactive model suggester for ad-hoc "which model for task X?" queries.
- **Settings**: **Provider-Übersicht** (7 farbcodierte Statuskarten aller Anbieter mit Plan, Kosten, Limits, Sync), editable Plan-Subscription pricing + editable Model token pricing + alert thresholds (low-balance % and rate multiplier).

### Architecture
- **Backend**: Node.js + Express + TypeScript (strict mode), SQLite, additive migrations.
- **Frontend**: React + TypeScript + Vite, Tailwind CSS. Same-origin XHRs in production; dev server uses Vite proxy.
- **Extension**: Chrome MV3 (v3.2.1), configurable Backend URL + API Token in the popup. Auto-sync: Hard-Sources (Tabs) alle 15min via chrome.alarms + Server-Scraper (Playwright) alle 1h via systemd timer. Manuell: **🔐 Sync geschützte Quellen** + Cookie-Export.
- **Server-Scraper**: Playwright TypeScript scrapers running on the VPS via systemd timer (every 1h). Handles 3 sources (Codex, OpenAI API, Claude.ai) using cookies auto-exported from the extension.
- **Hybrid sync**: 3 sources scraped server-side (1h Takt, Cookie-Export) + 4 sources scraped in-extension (httponly cookies encrypted by macOS Keychain — console, claude-code, z.ai, opencode). Sync-Kadenzen: Server-Scraper 1h · Extension Hard-Sync 15min · Popup-Refresh 15min · Handoff-Check 1h.
- **Proxy tunnel**: SOCKS5 via SSH reverse tunnel (microsocks on Mac + ssh -R) to route Playwright traffic through the residential IP, bypassing Cloudflare challenges.
- **VPS deployment**: Apache reverse-proxy + systemd unit + Let's Encrypt TLS + magic-link auth + automated health monitoring with email alerts.

---

## 📋 Prerequisites

- **Node.js**: 20 LTS or newer (22.x is what runs on the VPS).
- **Chrome / Chromium / Brave**: for the browser extension.
- **SQLite**: comes with the `sqlite3` npm dependency, no system install needed.

---

## 🚀 Quick Start (local dev)

### 1. Clone the repository
```bash
git clone git@github.com:haraldweiss/Claude-KI-Usage-Tracker.git
cd Claude-KI-Usage-Tracker
```

### 2. Install dependencies
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Run the application
```bash
# Terminal 1 — Backend on port 3000
cd backend && npm run dev

# Terminal 2 — Frontend on port 5173
cd frontend && npm run dev
```

Or use the convenience scripts that handle both at once:
```bash
./start.sh      # Open both in new Terminal windows (macOS) / fall back to background mode
./status.sh     # Show what's running and from which directory
./stop.sh       # Stop both, plus any zombie nodemon/vite processes
```

The scripts auto-detect when launched from a worktree and point the backend at the main repo's SQLite file so test runs and dev runs share the same data.

### 4. Install the extension

> **Version note**: the extension is now at **v3.2.1** (MV3). It is incompatible with any v1.x install — remove the old version from `chrome://extensions` before loading this one.

1. Open `chrome://extensions`.
2. Enable Developer mode (top right).
3. Click "Load unpacked".
4. Select the `extension/` directory.
5. Click the Tracker icon in the toolbar → expand "⚙️ Verbindung":
   - **Local dev**: leave Backend-API URL = `http://localhost:3000/api` and the API Token field empty → "Speichern".
   - **Hosted instance**: set Backend-API URL to `https://your-domain/claudetracker/api`, paste the **API Token** from Settings → API Token → "Speichern". The extension sends `Authorization: Bearer <token>` on every request; no Basic-Auth credentials are needed.

### 5. Trigger your first sync
Log into all services in regular browser tabs. The **server-scraper** (every 1h) handles Codex, OpenAI API, and Claude.ai automatically. For the 4 sources with macOS Keychain-encrypted httponly cookies (Anthropic Console, Claude Code, z.ai, OpenCode Go), open the extension popup and click **🔐 Sync geschützte Quellen** — it opens 4 tabs, scrapes data, and posts to the backend.

> **Note:** When a scraper finds no existing tab it opens a new one as an **active, visible tab** to pass Cloudflare's bot-detection (hidden tabs trigger anti-bot challenges). Each scraper closes its own tab after the scrape. When "↻ Sync alle" is used, a single tab is shared across all seven scrapers and closed once at the end. Re-open the popup if it dismisses during this window.

For ad-hoc runs from the service-worker console:
```javascript
autoSync().then(console.log)         // claude.ai
consoleSync().then(console.log)      // console.anthropic.com
claudeCodeSync().then(console.log)   // platform.claude.com/claude-code
```
The dashboard at `http://localhost:5173` will populate within a few seconds.

---

## 🌐 VPS Deployment

The tracker is also deployable as a subpath of an existing Apache vhost — useful if you already host other things on a domain and don't want to spin up a separate one.

**Live at:** `https://wolfinisoftware.de/claudetracker/` (magic-link auth; this is the maintainer's instance).

### How it works

| Layer | What lives where |
|---|---|
| Apache vhost | `/etc/httpd/conf.d/claudetracker.conf` — `Alias /claudetracker → /var/www/.../frontend/dist` plus `ProxyPass /claudetracker/api/ → http://127.0.0.1:3001/api/`. SPA fallback rewrite for client-side routing. |
| Backend | systemd unit `claudetracker-backend.service`, listens on `127.0.0.1:3001`, env-configured via `Environment=DATABASE_PATH=...` and `Environment=CORS_ALLOWED_ORIGINS=...`. |
| Frontend | static bundle under `/var/www/wolfinisoftware/claudetracker/frontend/dist/` (Vite build, base path `/claudetracker/`). |
| Auth | **Application-level magic-link auth** (see Sign Up section above). The Apache `.htpasswd-claudetracker` file is kept as a legacy fallback / extra layer but is no longer the primary gate — the app handles auth itself via session cookies and Bearer API tokens. |
| TLS | Let's Encrypt cert managed by the surrounding vhost (no separate cert for the subpath). |

The frontend production build reads `frontend/.env.production` (`VITE_API_URL=/claudetracker`) so all fetches use a same-origin relative URL — no separate API hostname, no CORS dance.

### Server-Scraper (Playwright)

The server-scraper runs on the VPS via systemd timer (`ki-usage-scraper.timer`, every 1h). It uses Playwright with headless Chromium to scrape 3 cost sources:

| Source | File | Data extracted |
|---|---|---|
| Codex | `codex.ts` | ❌ Cloudflare (use extension sync) |
| OpenAI API | `openai-api.ts` | ✅ MTD spend, tokens, requests |
| Claude.ai | `claude-ai.ts` | ✅ Session spend (no active plan → 0) |

Cookies are auto-exported from the Chrome extension (v3.2.1+) and uploaded to `POST /api/cookies/upload`. The backend saves them to `/opt/claudetracker-data/cookies/`, symlinked to the server-scraper's cookie directory.

**Proxy tunnel** (for Cloudflare bypass): The server-scraper runs through a SOCKS5 proxy that routes traffic via the Mac's residential IP.

```bash
# On Mac (one-time):
brew install microsocks
microsocks -i 127.0.0.1 -p 1080 &

# SSH reverse tunnel (launchd-managed with KeepAlive):
#   plist: ~/Library/LaunchAgents/com.autossh.proxy-tunnel.plist
#   Logs:  ~/Library/Logs/autossh-proxy-tunnel.log
#   Start: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.autossh.proxy-tunnel.plist
ssh -R 40000:localhost:1080 oracle-vm

# In /etc/systemd/system/ki-usage-scraper.service:
# Environment=PLAYWRIGHT_PROXY_URL=socks5://127.0.0.1:40000
```

**claudetracker Backend tunnel** (for local → oracle-vm:3001): Forwards port 3001 so benchmark results can be sent to the backend from the local machine.

```bash
# launchd-managed with autossh (KeepAlive + auto-restart):
#   plist: ~/Library/LaunchAgents/de.haraldweiss.claudetracker-tunnel.plist
#   Logs:  ~/Library/Logs/claudetracker-tunnel.log
#   Forward: -L 3001:127.0.0.1:3001 → opc@92.5.18.29
#   Start: launchctl load ~/Library/LaunchAgents/de.haraldweiss.claudetracker-tunnel.plist
#   Status: launchctl list | grep claudetracker
```

**Extension sync** (4 sources with httponly cookies): Open the popup and click **🔐 Sync geschützte Quellen**. The extension opens tabs for:

| Source | URL scraper | Data |
|---|---|---|
| Anthropic Console | `platform.claude.com/settings/keys` | Per-workspace API key costs |
| Claude Code | `platform.claude.com/claude-code/usage` | Per-member costs, lines, accept rate |
| z.ai | `z.ai/manage-apikey/coding-plan/` | Plan name, price, 5h/weekly/monthly quotas |
| OpenCode Go | `opencode.ai/workspace/.../go` | Plan name, continuous/weekly/monthly usage % |

Data from both pipelines flows to the same backend (`POST /api/usage/track`) and is displayed in the React dashboard.

### Ollama Benchmark Suite

A benchmark suite for local Ollama models lives in `benchmark/`. It tests text-generation models on a consistent prompt and sends results to the backend (`POST /api/benchmarks`).

**Scripts:**

| Script | Description |
|---|---|
| `benchmark/run.js` | Standard benchmark: coding, general, project, speed tasks. `--mode quick/standard --model NAME` |
| `benchmark/full-suite-test.cjs` | Quick one-prompt test across all text models. Sends results to backend |
| `benchmark/config.js` | `OLLAMA_BASE`, `BACKEND_BASE`, timeouts |
| `benchmark/send.js` | Shared backend upload helper for benchmark results |

**Quick full-suite run:**
```bash
cd benchmark
node full-suite-test.cjs
# Tests all 12 models, saves to benchmark/results/, uploads to backend
```

**Run benchmark for a single model:**
```bash
node run.js --model hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M --mode quick
```

**Backend query:**
```bash
curl "http://localhost:3001/api/benchmarks?mode=full_suite" \
  -H "Authorization: Bearer <token>"
```

**Local reports:** `benchmark/results/full-suite-*.json`

### Deploy a fresh build

```bash
# From the project root
cd backend && npm run build
cd ../frontend && npm run build

# Sync just the runtime artifacts
rsync -az --delete --exclude=node_modules --exclude=database.sqlite \
  backend/dist backend/package.json backend/package-lock.json \
  user@vps:/var/www/.../claudetracker/backend/
rsync -az --delete frontend/dist/ \
  user@vps:/var/www/.../claudetracker/frontend/dist/

ssh user@vps 'systemctl restart claudetracker-backend'
```

### Monitoring (live on the maintainer's VPS)

- `/usr/local/bin/claudetracker-healthcheck.sh` — cron every 5 minutes, fires an email after 3 consecutive `/health` failures, resets the streak on recovery.
- `/usr/local/bin/claudetracker-notify.sh` — wraps `sendmail`, rate-limits to 1 mail/h per alert key, always logs to journal.
- `claudetracker-onfailure.service` — systemd `OnFailure=` hook that fires when the backend exhausts its 5-restarts-in-10-min budget.
- Mail relay: Postfix → Ionos SMTP → recipient inbox. Tested and live.

See [docs/superpowers/specs/2026-04-29-console-api-tracking-design.md](./docs/superpowers/specs/2026-04-29-console-api-tracking-design.md) for the scraping architecture rationale and [docs/superpowers/specs/2026-04-29-multi-user-auth-design.md](./docs/superpowers/specs/2026-04-29-multi-user-auth-design.md) for the multi-user auth design decisions.

### Obsidian WebDAV (geräteübergreifendes Gedächtnis)

Neben dem Tracker läuft auf demselben Oracle VM ein WebDAV-Endpunkt für Obsidian-Vault-Sync:

| Was | Wert |
|---|---|
| Subdomain | `obsidian.wolfinisoftware.de` |
| Vault-Verzeichnis | `/opt/obsidian-vaults/ai-provider-memory/` |
| Apache Config | `/etc/httpd/conf.d/obsidian-dav.conf` |
| SSL-Cert | `/etc/letsencrypt/live/obsidian.wolfinisoftware.de/` |
| Credentials | In Claude Code Memory (siehe AGENTS.md §6.1) |

**Obsidian-Plugin:** Remotely Save → WebDAV → `https://obsidian.wolfinisoftware.de`, Remote Base Dir: `ai-provider-memory`.

**Claude Memory Mirror:** Post-commit Hook in `~/.claude/projects/.../memory/` spiegelt alle `.md`-Dateien automatisch nach `~/ObsidianVaults/ai-provider-memory/claude-memory/`.

**SELinux:** Vault-Verzeichnis braucht `httpd_sys_rw_content_t` — bei neuem Verzeichnis: `sudo semanage fcontext -a -t httpd_sys_rw_content_t '/opt/obsidian-vaults(/.*)?'` + `restorecon -Rv`.

---

## Container deployment (production)

The production deploy on the IONOS VPS runs the backend as a
podman-managed container, driven by a Quadlet at
`/etc/containers/systemd/claudetracker.container`. The frontend
stays statically served by Apache from `frontend/dist/`.

**First-time setup on the VPS:**

```bash
# 1. Data dir (UID/GID 1000 matches the container's `app` user)
mkdir -p /opt/claudetracker-data
chown -R 1000:1000 /opt/claudetracker-data
chcon -Rt container_file_t /opt/claudetracker-data

# 2. Secrets file (never in git)
mkdir -p /etc/claudetracker && chmod 700 /etc/claudetracker
cat > /etc/claudetracker/claudetracker.env <<'EOF'
SECRETS_KEY=...
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=KI Usage Tracker <claudetracker@wolfinisoftware.de>
EOF
chmod 600 /etc/claudetracker/claudetracker.env

# 3. Install the Quadlet
cp /var/www/wolfinisoftware/claudetracker/deploy/claudetracker.container \
   /etc/containers/systemd/
systemctl daemon-reload

# 4. Build the image and start
cd /var/www/wolfinisoftware/claudetracker/backend
podman build -t localhost/claudetracker:latest .
systemctl start claudetracker.service
```

**Re-deploy after a code change:**

```bash
cd /var/www/wolfinisoftware/claudetracker
git pull
cd backend
podman build -t localhost/claudetracker:latest .
systemctl restart claudetracker.service
```

**Logs:** `journalctl -u claudetracker.service -f`

**Health check:** The Quadlet configures a TCP-connect health check against port 3001 via the Node.js `net` module (no `curl` in the image) every 30 s. Inspect with:

```bash
podman healthcheck run claudetracker     # one-shot probe, exits 0 if healthy
podman inspect claudetracker --format '{{.State.Health.Status}}'
```

The check lives in the Quadlet (`HealthCmd=`) rather than the Dockerfile because Podman builds the image in OCI format by default, under which Dockerfile `HEALTHCHECK` directives are silently ignored.

**Backup:** `/opt/claudetracker-data/database.sqlite` is the only stateful path.

---

## 🏗️ Project Structure

```
Claude-KI-Usage-Tracker/
├── backend/
│   ├── src/
│   │   ├── server.ts                       # Express entry, cron scheduling
│   │   ├── app.ts                          # createApp() with allowlist CORS
│   │   ├── controllers/
│   │   │   ├── usageController.ts          # /usage/* — track, summary,
│   │   │   │                               #   models, history, console/keys,
│   │   │   │                               #   spending-total
│   │   │   ├── pricingController.ts        # /pricing/* — models + plans CRUD
│   │   │   └── modelRecommendationController.ts
│   │   ├── routes/                         # Route definitions + validators
│   │   ├── services/
│   │   │   ├── pricingService.ts           # Daily LiteLLM model-price sync
│   │   │   ├── planPricingService.ts       # Plan-Abo CRUD + daily refresh stub
│   │   │   ├── exchangeRateService.ts      # Frankfurter USD→EUR daily fetch
│   │   │   └── modelRecommendationService.ts
│   │   ├── middleware/                     # Validators, error handler
│   │   ├── database/sqlite.ts              # initDatabase(), addMissingColumns()
│   │   └── types/                          # TypeScript interfaces
│   └── dist/                               # Compiled JS (npm run build)
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx               # Tab shell
│   │   │   ├── Settings.tsx                # Plan + Model pricing tables
│   │   │   └── RecommendationsPage.tsx     # Insights + ModelSuggester
│   │   ├── components/
│   │   │   ├── OverviewTab.tsx             # Status cards + forecast + trend
│   │   │   ├── ModelsTab.tsx               # Per-key detail
│   │   │   ├── CombinedCostTab.tsx         # Month + all-time + per-key
│   │   │   ├── ApiKeysDetailTable.tsx      # Shared per-key table
│   │   │   ├── PlanPricingTable.tsx        # Editable plan-Abo grid
│   │   │   ├── InsightsBlock.tsx           # Live recommendations
│   │   │   └── ...                         # Pricing, ModelSuggester, etc.
│   │   ├── services/api.ts                 # Typed API client
│   │   └── types/api.ts                    # Shared API types
│   ├── .env.production                     # VITE_API_URL=/claudetracker
│   └── vite.config.ts                      # base: '/claudetracker/' in prod
│
├── extension/                               # ⭐ Chrome MV3 (Original)
│   ├── manifest.json                       # MV3, host permissions for all
│   │                                       #   five sync targets
│   ├── background.js                       # Orchestrator: syncAll(), alarms,
│   │                                       #   message router, authFetch
│   ├── background-utils.js                 # waitForTabReady, sleep helpers
│   ├── background-scraper-claude.js        # claude.ai usage scraper
│   ├── background-scraper-console.js       # Anthropic Console / platform.claude.com
│   │                                       #   keys scraper + workspace discovery
│   ├── background-scraper-claude-code.js   # Claude Code keys + LOC scraper
│   ├── background-scraper-opencode.js      # OpenCode Go quota scraper
│   ├── background-scraper-zai.js           # z.ai GLM Coding Plan scraper
│   ├── content.js                          # DOM scrape helpers (claude.ai)
│   └── popup.html / popup.js               # Stats + connection settings
│
├── extension-edge/                          # ✅ Edge MV3 (Chrome fork)
│   └── manifest.json (+ browser_specific_settings.edge)
│
├── extension-opera/                         # ✅ Opera MV3 (Chrome fork)
│   └── manifest.json (+ browser_specific_settings.opera)
│
├── extension-firefox/                       # ✅ Firefox MV2 (WebExtensions)
│   ├── manifest.json                       # MV2, background.scripts
│   ├── browser-compat.js                   # tabs.executeScript Bridge
│   ├── background.js                       # Adaptiert (kein importScripts)
│   ├── popup.html, popup.js
│   └── README.md
│
├── extension-palemoon/                      # 🔶 Pale Moon (XUL/XPCOM)
│   ├── install.rdf                         # RDF/XML Install-Manifest
│   ├── bootstrap.js                        # startup/shutdown/install/uninstall
│   ├── chrome.manifest                     # chrome:// Registration
│   ├── content/popup.xul                   # XUL-Fenster
│   ├── content/popup.js                    # XPCOM-Logik
│   ├── defaults/preferences/prefs.js       # Default-Preferences
│   └── README.md
│
├── docs/superpowers/specs/                 # Architecture decision records
│   ├── 2026-04-29-data-quality-insights-design.md     # ABANDONED
│   ├── 2026-04-29-console-api-tracking-design.md      # Plan B (current)
│   └── 2026-04-29-multi-user-auth-design.md           # Multi-user auth design
│
├── start.sh / stop.sh / status.sh          # Dev lifecycle (worktree-aware)
└── database.sqlite                         # Auto-created on first run
```

---

## 🔌 API Endpoints

### Usage tracking
- `POST /api/usage/track` — log a tracking record (used by the extension's syncs).
- `GET /api/usage/summary?period=day|week|month` — combined headline numbers + per-source breakdown + EUR-equivalent of the API USD figure + the exchange rate used.
- `GET /api/usage/models` — per-model token breakdown. Filters out the three synthetic sync sources (`claude_official_sync`, `anthropic_console_sync`, `claude_code_sync`) since they don't carry per-message tokens.
- `GET /api/usage/history?limit=500&offset=0` — recent usage records.
- `GET /api/usage/console/keys` — latest snapshot per key from both `platform.claude.com/settings/keys` and `platform.claude.com/claude-code`. Single response, source-tagged.
- `GET /api/usage/spending-total` — all-time totals per month, plus grand total in EUR using the latest stored exchange rate.

### Pricing management
- `GET /api/pricing` — model token pricing.
- `PUT /api/pricing/:model` — manual override; flips `source='manual'`.
- `POST /api/pricing/:model/confirm` — confirm an auto-detected `pending_confirmation` row.
- `GET /api/pricing/plans` — claude.ai plan subscription pricing.
- `PUT /api/pricing/plans/:name` — override a plan's monthly EUR.
- `POST /api/pricing/plans/refresh` — manual trigger for the (currently no-op) upstream scrape.

### Model recommendations
- `POST /api/recommend` — model recommendation for a free-text task description.
- `GET /api/recommend/analysis/models?period=…` — historical model statistics.
- `GET /api/recommend/analysis/opportunities?period=…` — legacy cost-optimization endpoint. Returns empty when no per-message data is available (the common case with the current scraping setup).

### System
- `GET /health` — backend liveness check (no auth required, used by the VPS health-check cron).

---

## 🔐 Authentication

### Local dev
None by default. Backend listens on `localhost:3000`, frontend on `localhost:5173`, extension talks to `http://localhost:3000/api`. Leave the popup's API Token field empty.

### VPS (production)
Magic-link auth at the application layer. Users sign in with their email address; the backend sends a single-use token link valid for 15 minutes. On success a 30-day rolling session cookie (`cut_session`) is set. The browser extension authenticates via a per-user **Bearer API token** (`Authorization: Bearer <token>`) obtained from Settings → API Token. No Basic-Auth credentials are required.

The Apache `.htpasswd-claudetracker` file remains on the VPS as an optional extra layer but the app no longer depends on it — removing it does not break anything.

---

## 🌍 Configuration

### Backend (`backend/.env`)
```env
PORT=3000                                       # 3001 on the VPS
DATABASE_PATH=./database.sqlite                 # absolute path on VPS
NODE_ENV=development                            # production on VPS
CORS_ALLOWED_ORIGINS=https://wolfinisoftware.de # comma-separated extras

# Auth (required on VPS; sensible defaults for local dev shown)
VERIFY_BASE_URL=https://your-domain/claudetracker/auth/verify
                                                # full URL the magic-link points to
MAIL_FROM=KI Usage Tracker <noreply@your-domain>
                                                # From: address for magic-link emails
SMTP_HOST=localhost                             # SMTP relay host (default: localhost)
SMTP_PORT=25                                    # SMTP port (default: 25)
COOKIE_PATH=/claudetracker/                     # cookie path; set to / for local dev
```

> **Mail deliverability**: ensure the sender domain has valid SPF, DKIM, and DMARC records so magic-link emails are not rejected by recipients' mail providers.

### Frontend
- `frontend/.env` (dev): `VITE_API_URL=http://localhost:3000`
- `frontend/.env.production` (prod build): `VITE_API_URL=/claudetracker` so the bundle issues same-origin requests.

### Extension
All connection settings live in `chrome.storage.local` and are configured through the popup's "⚙️ Verbindung" panel. No environment variables to bake in at build time. Reset clears the stored Backend URL and API token.

---

## 🧩 Browser-Kompatibilität

| Browser | Codebasis | Extension-API | Verzeichnis | Änderungsaufwand |
|---|---|---|---|---|
| **Chrome** | Chromium | WebExt MV3 | `extension/` | ⭐ Original |
| **Edge** | Chromium | WebExt MV3 | `extension-edge/` | 🟢 Minimal (manifest) |
| **Opera** | Chromium | WebExt MV3 | `extension-opera/` | 🟢 Minimal (manifest) |
| **Firefox** | Quantum Gecko | WebExt MV2 | `extension-firefox/` | 🟡 ~130 Zeilen |
| **Waterfox/Floorp/LibreWolf** | Quantum Gecko | WebExt MV2 | `extension-firefox/` | 🟡 Selbe Variante |
| **Pale Moon** | Goanna (UXP) | XUL/XPCOM | `extension-palemoon/` | 🔴 Neuentwicklung ~450 Z. |

Siehe `extension-*/README.md` für Details.

## 🔧 Code Quality

A systematic code review was performed in May 2026, fixing the following issues:

| Category | Changes |
|---|---|
| **XSS mitigation misuse** | Removed `express-validator` `.escape()` from all 6 validator chains — it was corrupting model names by HTML-encoding data before storage. React auto-escapes all output, making this both harmful and redundant. |
| **Dynamic imports in hot paths** | Replaced 4 `await import(...)` calls inside route handlers with static top-level imports (`planPricingService`, `exchangeRateService`). |
| **React remounts** | Extracted `NavBar` from inside `App` component to module level — defining components inside other components creates new function identities on every render, causing React to unmount/remount all DOM elements. |
| **Unhandled rejections** | Added `.catch()` handlers to fire-and-forget Promise chains in `server.ts` (cron ticks and startup invocations). |
| **Type safety** | Removed 5 `as any` type assertions from `usageController.ts` error responses. Added `error` field to `UsageTrackResponse` type. Introduced typed interfaces for all query results. |
| **NaN/Infinity display** | Added `isFinite()` guard to `formatEur()` / `formatUsd()` in the extension popup to avoid rendering "NaN €" / "$NaN". |

---

## 🐛 Troubleshooting

| Issue | Solution |
|---|---|
| Port 3000 already in use | Run `./stop.sh` (kills both port-bound and stale nodemon/vite processes), then `./start.sh`. |
| Multiple nodemon zombies | `./status.sh` shows them; `./stop.sh` cleans them up. |
| "No data" in dashboard | Trigger a sync manually from the extension popup or the service-worker console. Check `chrome://extensions` → service worker for errors. |
| ❌ Claude.ai sync error | Make sure you are **logged into claude.ai** in the browser. If a new tab is needed, the scraper opens one as an active tab — Cloudflare blocks hidden/background tabs. Check the service-worker console for `[autoSync] executeScript fehlgeschlagen, Tab-URL:` to see where the tab actually landed. |
| `sqlite3` GLIBC error on VPS | The pre-built binary needs glibc ≥ 2.38; on Rocky 9 run `npm rebuild sqlite3 --build-from-source` once. |
| 401 on every API call | Extension popup → "⚙️ Verbindung" → paste the API Token from Settings → API Token and Save. The extension authenticates with `Authorization: Bearer <token>`; it does not share cookies with the browser. |
| Frontend shows port 3000 in error message | Stale build — re-run `npm run build` and Cmd+Shift+R in the browser to bust the bundle cache. |
| Models tab shows 0,00 across the board | Expected. The three scrape sources don't carry per-message tokens; the per-key table below shows the real numbers. |
| All-time spending only shows current month | The history-retention change keeps one snapshot per UTC day, so older months only appear once they actually have data. |

---

## 🧪 Testing

```bash
# Backend (Jest + ts-jest)
cd backend && npm test

# Frontend (Vitest)
cd frontend && npm test
```

Backend dev runtime uses `tsx` (no compile step in dev). Production: `npm run build && npm start` builds to `dist/` and serves the compiled output.

---

## 👥 Multi-User Architecture

The hosted instance supports multiple independent users sharing a single deployment without any data leaking between them.

| Concern | How it works |
|---|---|
| **Data isolation** | Every `usage_records` and `model_analysis` row carries a `user_id` foreign key. All queries in controllers are scoped to `req.user.id`; there is no admin view that reads another user's usage data. |
| **Auth flow** | Passwordless magic-link. `POST /api/auth/request` → email with a single-use token → `GET /api/auth/verify?token=…` sets a 30-day rolling `cut_session` cookie. |
| **API tokens** | One active token per user (enforced by a partial UNIQUE index). Generated and revoked from Settings → API Token. The extension sends `Authorization: Bearer <token>`. |
| **Admin role** | The `is_admin` flag unlocks `/admin/*` routes for user management (list users, deactivate). Admins cannot read other users' usage data — the privacy boundary is at the controller layer, not just the route guard. |
| **Database** | Single SQLite file; no separate schema per user. Additive migrations keep the schema forward-compatible. |

---

## 🤝 Contributing

This is a personal project but the patterns are reusable. If you fork:

1. Create a branch: `git checkout -b feature/your-feature`.
2. Test: `cd backend && npm test && cd ../frontend && npm test`.
3. Type-check: `cd backend && npm run type-check`.
4. Commit; push.

The architectural decision records in `docs/superpowers/specs/` document why the project pivoted from per-message Haiku categorization (Plan A, abandoned) to multi-source page scraping (Plan B, current). Reading those before non-trivial changes saves the next person a lot of confusion.

---

## 📝 License

MIT — see [LICENSE](./LICENSE).

---

**Last Updated**: June 2026 (Phase 7 — Browser-Varianten: Edge, Opera, Firefox, Pale Moon)
**Maintained by**: Harald Weiss
**Repository**: [GitHub](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)

## Mitwirken

Pull-Requests sind willkommen. Bitte einmal kurz [`CONTRIBUTING.md`](CONTRIBUTING.md)
lesen — wir nutzen das Developer Certificate of Origin (DCO), Commits müssen
also mit `git commit -s` signiert werden.

## Lizenz

Veröffentlicht unter der [GNU AGPL v3.0](LICENSE) — © 2026 Harald Weiss.

Die AGPL stellt sicher, dass auch netzbasierte Bereitstellungen den Quellcode
ihrer Modifikationen weitergeben müssen. Ideen und Konzepte sind durch keine
Lizenz schützbar.
