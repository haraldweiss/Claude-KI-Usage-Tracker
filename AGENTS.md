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

- **Multi-source AI cost tracker**: surfaces real spend from 4 disconnected places into one dashboard:
  1. `claude.ai/settings/usage` — consumer subscription
  2. `console.anthropic.com/settings/keys` — workspace API keys
  3. `platform.claude.com/claude-code` — Claude Code keys + LOC metrics
  4. `opencode.ai` — OpenCode Go workspace subscription (added 2026-05-27)
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

### 3.1 Port / process / log
- Backend runs on **port 3001** (not 3000 — past confusion lost 30 min of debugging).
- Logs live in `/var/log/claudetracker-backend.log` (not journal).
- After every `npm ci`: `npm rebuild sqlite3 --build-from-source` — the prebuilt binary demands glibc 2.38, VPS has older. Skip = crashes on boot.

### 3.2 Scraper resilience
- Extension scrapers in `extension/background.js` are **best-effort**: claude.ai and opencode.ai layouts change without warning. When they break:
  - Look for the actual text in the new DOM (e.g. "Zurücksetzung in" was added alongside "Reset in" — accept both)
  - Increase render delays before scraping (e.g. 2.5s → 4s)
  - Search before/after the percentage match, not only one direction
- Don't aggressively cache scraper results — make them idempotent so a re-sync just upserts.

### 3.3 Cost math is user-trust-critical
- All currency conversions go through `frankfurter.app` daily; cache the rate.
- `formatEur` / `formatUsd` in extension popup: always `isFinite()` guard before format. Past bug surfaced `NaN€` when a scraper returned undefined.
- "Grand total" in `OverviewTab` must include **all four sources** (claude.ai, console, Claude Code, OpenCode Go) — if you add a 5th source, add it to the sum.

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
| claude.ai scraper | `extension/background.js` (legacy of all scrapers) |

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
-->
