# Claude Usage Tracker

A web application + browser extension that tracks the **real cost** of using Claude across three Anthropic surfaces — claude.ai subscription, Anthropic Console API keys, and Claude Code — and surfaces it as a single number on a unified dashboard.

**Status**: ✅ Phase 5 — Multi-Source Cost Tracker (live on VPS, Plan-B architecture)

---

## 🎯 What it does

The dashboard tells you, in one number, what Claude actually costs you this month. It pulls from three otherwise-disconnected places:

1. **claude.ai/settings/usage** — the consumer subscription page (Plan name, Zusatznutzung, weekly limits)
2. **console.anthropic.com/settings/keys** — workspace API keys + their cumulative cost
3. **platform.claude.com/claude-code** — Claude Code keys with cost + lines-of-code metrics

The browser extension scrapes those pages on a schedule, posts the numbers to the local backend, and the backend exposes them through a typed API the React dashboard renders.

### Why scraping, not the Anthropic API?

The official Usage/Cost API requires an Admin Key (organization-level credential). This tool was built for users who *don't* have one but can log into the same pages a human would. The extension reuses your already-logged-in browser session and pulls the same numbers Anthropic shows you — no extra credentials, no extra billing surface.

> **Trade-off:** scraping is fragile. If Anthropic redesigns one of the pages, that source breaks until the selectors are updated. The extension fails open: when one scraper can't find data, it logs and skips, the other sources still work.

---

## ✨ Features

### Cost tracking
- **Three sync sources**: claude.ai (every 10 min), Anthropic Console (every 24h), Claude Code (every 24h, 5 min offset). Configurable; manual triggers from the popup or the service-worker console.
- **Plan subscription pricing** in an editable Settings table (Pro 18 €, Max 5x 99 €, Max 20x 199 €, Team 30 €). Daily refresh hook ready for when Anthropic exposes a scrape-friendly pricing page; until then values are seeded once and survive cron runs unless the user edits them.
- **USD → EUR conversion** via [Frankfurter](https://api.frankfurter.app) (ECB-backed, free, no API key). Refreshed daily; falls back to the last persisted rate if the API is briefly unreachable.
- **Self-maintaining model pricing**: bundled snapshot covers Claude 4.x (Opus 4.7, Sonnet 4.6, Haiku 4.5), 3.7 line, and legacy models. Daily LiteLLM sync keeps prices current as Anthropic ships new ones.
- **History retention**: claude.ai snapshots are kept one-per-day so monthly diffs and all-time totals survive even though the page only ever shows the current month.

### Dashboard
- **Übersicht (Overview)**: hero number in EUR, three status cards (Plan, Wochenlimits with colour-shifting progress bars, Budget), forecast card extrapolating today's daily rate to month-end, monthly trend block (≥ 2 months), sync-status footer.
- **Modelle (Models)**: per-key detail table (key/member, source badge, workspace, cost, lines, last sync) — works without per-message data because the source is the cumulative-cost-per-key sync.
- **Gesamtkosten (Combined cost)**: same per-key table, plus a clearer "this month vs. all-time" split with a collapsible monthly breakdown (Plan-Abo + Zusatznutzung + total per month).
- **Recommendations**: live insights driven by the actual sync data (plan right-sizing based on weekly usage %, monthly-limit forecast, cost-source ratio, Claude Code key efficiency comparison) plus an interactive model suggester for ad-hoc "which model for task X?" queries.
- **Settings**: editable Plan-Subscription pricing + editable Model token pricing.

### Architecture
- **Backend**: Node.js + Express + TypeScript (strict mode), SQLite, additive migrations.
- **Frontend**: React + TypeScript + Vite, Tailwind CSS. Same-origin XHRs in production; dev server uses Vite proxy.
- **Extension**: Chrome MV3, configurable Backend URL + Basic-Auth credentials in the popup so the same extension build works against local dev (`localhost:3000`) and the deployed VPS.
- **VPS deployment**: Apache reverse-proxy + systemd unit + Let's Encrypt TLS + HTTP Basic Auth + automated health monitoring with email alerts.

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
1. Open `chrome://extensions`.
2. Enable Developer mode (top right).
3. Click "Load unpacked".
4. Select the `extension/` directory.
5. Click the Tracker icon in the toolbar → expand "⚙️ Verbindung" → leave Backend-API URL = `http://localhost:3000/api` (default) and Auth fields empty for local dev → "Speichern".

### 5. Trigger your first sync
Log into claude.ai, console.anthropic.com, and platform.claude.com in regular browser tabs (so the extension can reuse your session). Then in the extension popup, click the sync button — or in the service-worker console:
```javascript
autoSync().then(console.log)         // claude.ai
consoleSync().then(console.log)      // console.anthropic.com
claudeCodeSync().then(console.log)   // platform.claude.com/claude-code
```
The dashboard at `http://localhost:5173` will populate within a few seconds.

---

## 🌐 VPS Deployment

The tracker is also deployable as a subpath of an existing Apache vhost — useful if you already host other things on a domain and don't want to spin up a separate one.

**Live at:** `https://wolfinisoftware.de/claudetracker/` (Basic Auth protected; this is the maintainer's instance).

### How it works

| Layer | What lives where |
|---|---|
| Apache vhost | `/etc/httpd/conf.d/claudetracker.conf` — `Alias /claudetracker → /var/www/.../frontend/dist` plus `ProxyPass /claudetracker/api/ → http://127.0.0.1:3001/api/`. SPA fallback rewrite for client-side routing. |
| Backend | systemd unit `claudetracker-backend.service`, listens on `127.0.0.1:3001`, env-configured via `Environment=DATABASE_PATH=...` and `Environment=CORS_ALLOWED_ORIGINS=...`. |
| Frontend | static bundle under `/var/www/wolfinisoftware/claudetracker/frontend/dist/` (Vite build, base path `/claudetracker/`). |
| Auth | HTTP Basic via `.htpasswd-claudetracker`. The extension's popup has matching User/Password fields that get sent as `Authorization: Basic …` on every fetch. |
| TLS | Let's Encrypt cert managed by the surrounding vhost (no separate cert for the subpath). |

The frontend production build reads `frontend/.env.production` (`VITE_API_URL=/claudetracker`) so all fetches use a same-origin relative URL — no separate API hostname, no CORS dance, the browser remembers the Basic-Auth credentials across requests.

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

See [docs/superpowers/specs/2026-04-29-console-api-tracking-design.md](./docs/superpowers/specs/2026-04-29-console-api-tracking-design.md) for the architectural rationale and [docs/superpowers/specs/2026-04-29-multi-user-auth-design.md](./docs/superpowers/specs/2026-04-29-multi-user-auth-design.md) for the planned multi-user replacement of HTTP Basic Auth.

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
├── extension/
│   ├── manifest.json                       # MV3, host permissions for the
│   │                                       #   three sync targets
│   ├── background.js                       # autoSync, consoleSync,
│   │                                       #   claudeCodeSync; chrome.alarms;
│   │                                       #   authFetch with Basic-Auth header
│   ├── content.js                          # DOM scrape helpers (claude.ai)
│   └── popup.html / popup.js               # Stats + connection settings
│
├── docs/superpowers/specs/                 # Architecture decision records
│   ├── 2026-04-29-data-quality-insights-design.md     # ABANDONED
│   ├── 2026-04-29-console-api-tracking-design.md      # Plan B (current)
│   └── 2026-04-29-multi-user-auth-design.md           # Next session
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
- `GET /api/usage/console/keys` — latest snapshot per key from both `console.anthropic.com` and `platform.claude.com/claude-code`. Single response, source-tagged.
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
None by default. Backend listens on `localhost:3000`, frontend on `localhost:5173`, extension talks to `http://localhost:3000/api`. Leave the popup's Basic-Auth fields empty.

### VPS (production)
HTTP Basic Auth at the Apache layer, applied to the whole `/claudetracker/` subtree (frontend + API). The extension popup has matching User/Password fields under "⚙️ Verbindung" that get sent as `Authorization: Basic <base64>` on every fetch. Browsers cache the credentials after the first prompt.

### Future: multi-user (planned, not implemented)
Replaces Basic Auth with JWT-based login, an admin role for invites, and per-user data partitioning. Specced in [docs/superpowers/specs/2026-04-29-multi-user-auth-design.md](./docs/superpowers/specs/2026-04-29-multi-user-auth-design.md). To be implemented in a separate session.

---

## 🌍 Configuration

### Backend (`backend/.env`)
```env
PORT=3000                                       # 3001 on the VPS
DATABASE_PATH=./database.sqlite                 # absolute path on VPS
NODE_ENV=development                            # production on VPS
CORS_ALLOWED_ORIGINS=https://wolfinisoftware.de # comma-separated extras
```

### Frontend
- `frontend/.env` (dev): `VITE_API_URL=http://localhost:3000`
- `frontend/.env.production` (prod build): `VITE_API_URL=/claudetracker` so the bundle issues same-origin requests.

### Extension
All connection settings live in `chrome.storage.local` and are configured through the popup's "⚙️ Verbindung" panel. No environment variables to bake in at build time. Reset removes both the URLs and any stored Basic-Auth credentials.

---

## 🐛 Troubleshooting

| Issue | Solution |
|---|---|
| Port 3000 already in use | Run `./stop.sh` (kills both port-bound and stale nodemon/vite processes), then `./start.sh`. |
| Multiple nodemon zombies | `./status.sh` shows them; `./stop.sh` cleans them up. |
| "No data" in dashboard | Trigger a sync manually from the extension popup or the service-worker console. Check `chrome://extensions` → service worker for errors. |
| `sqlite3` GLIBC error on VPS | The pre-built binary needs glibc ≥ 2.38; on Rocky 9 run `npm rebuild sqlite3 --build-from-source` once. |
| 401 on every API call | Extension popup → "⚙️ Verbindung" → enter the matching Basic-Auth credentials and Save. The extension does not share cookies with the browser; credentials must be set in the popup. |
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

**Last Updated**: April 2026 (Phase 5 — multi-source cost tracker, VPS deployment, USD/EUR conversion, live insights)
**Maintained by**: Harald Weiss
**Repository**: [GitHub](https://github.com/haraldweiss/Claude-KI-Usage-Tracker)
