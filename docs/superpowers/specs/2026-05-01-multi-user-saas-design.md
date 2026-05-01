# Multi-User SaaS Design — Claude Usage Tracker

**Date**: 2026-05-01
**Status**: Approved (sections 1–7), ready for implementation plan
**Scope**: Convert single-user (Basic-Auth-gated) tracker into open-signup SaaS with per-user data isolation

---

## Goals & Non-Goals

**Goal**: Anyone with a working email address can sign up at `https://wolfinisoftware.de/claudetracker/` and get their own private tracking surface (dashboard + extension). The single existing user (`harald`) keeps all historical data via migration.

**Non-Goals (explicitly out of v1)**:

- Payments / paid tiers — every user gets the same feature set
- Separate email-verification step — magic-link click implicitly verifies
- Two-factor auth, security questions, OAuth providers (Google/GitHub)
- Per-user API rate limiting (only login-rate-limit)
- Admin audit log
- Account-recovery flows beyond magic-link

**Constraints carried over from existing system**:

- Backend: Node.js + Express + better-sqlite3 on Rocky Linux VPS
- Frontend: React + Vite served as static bundle via Apache reverse-proxy
- Extension: Chrome MV3, scrapes claude.ai / console.anthropic.com / platform.claude.com per-user in their own browser
- Mail: existing Postfix → Ionos SMTP relay (already used for health alerts)
- Single VPS instance, no horizontal scaling planned

---

## Architecture Overview

Single SQLite database, multi-tenant via `user_id` foreign keys on per-user tables. Magic-link auth (no passwords) backed by server-side sessions for the dashboard and long-lived API tokens for the extension. Apache stays as reverse proxy + TLS terminator only — Basic Auth gets removed; all access control moves into the application layer.

```
                      ┌─────────────────────────────┐
                      │   wolfinisoftware.de:443    │
                      │      (Apache + TLS)         │
                      └──────────────┬──────────────┘
                                     │ proxy
                                     ▼
              ┌──────────────────────────────────────────┐
              │          Node/Express :3001              │
              │                                          │
              │  /api/auth/*       (no auth required)    │
              │  /api/account/*    (requireUser)         │
              │  /api/usage/*      (requireUser, scoped) │
              │  /api/admin/*      (requireAdmin)        │
              │  /api/pricing      (read all, write admin)│
              └──────────────┬───────────────────────────┘
                             │ better-sqlite3
                             ▼
              ┌──────────────────────────────────────────┐
              │           database.sqlite                │
              │                                          │
              │  Per-user: usage_records, model_analysis │
              │  Global:   pricing, plan_pricing, fx     │
              │  Auth:     users, sessions,              │
              │            magic_link_tokens, api_tokens │
              └──────────────────────────────────────────┘
```

---

## 1. Database Schema

### New tables

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  plan_name TEXT,                   -- selected from plan_pricing options
  monthly_limit_eur REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- crypto.randomBytes(32).toString('hex')
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE magic_link_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,         -- created + 15 minutes
  consumed_at TEXT
);
CREATE INDEX idx_mlt_email_active ON magic_link_tokens(email) WHERE consumed_at IS NULL;

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,         -- bcrypt hash, never store plaintext
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX idx_one_active_token_per_user
  ON api_tokens(user_id) WHERE revoked_at IS NULL;
```

### Schema changes to existing tables

```sql
ALTER TABLE usage_records ADD COLUMN user_id INTEGER REFERENCES users(id);
CREATE INDEX idx_usage_user_time ON usage_records(user_id, timestamp);

ALTER TABLE model_analysis ADD COLUMN user_id INTEGER REFERENCES users(id);
```

After backfill, `user_id` becomes effectively NOT NULL via application-level invariant. SQLite would require a table rebuild for an actual NOT NULL constraint — deferred.

### What stays global

- `pricing` — Anthropic model prices, identical for everyone
- `plan_pricing` — plan templates ("Pro = €18/mo"), identical for everyone
- `exchange_rates` — USD/EUR rates from Frankfurter API

Per-user plan selection lives in `users.plan_name` (FK-by-name into `plan_pricing.plan_name`).

### Migration

```sql
-- One-time on initial deploy
INSERT INTO users (id, email, display_name, is_admin, plan_name, monthly_limit_eur)
VALUES (1, 'anubclaw@gmail.com', 'Harald', 1, 'Max (5x)', 50.0);

UPDATE usage_records SET user_id = 1 WHERE user_id IS NULL;
UPDATE model_analysis SET user_id = 1 WHERE user_id IS NULL;
```

---

## 2. Auth Backend

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/request` | none | Request magic link. Body: `{ email }`. Returns 200 unconditionally (no enumeration). |
| GET | `/api/auth/verify?token=...` | none | Renders intermediate "Click to log in" page (mail-scanner protection). |
| POST | `/api/auth/verify` | none | Consumes token, creates session, sets HttpOnly cookie, redirects to `/`. |
| POST | `/api/auth/logout` | session | Deletes session row, clears cookie. |
| GET | `/api/auth/me` | session | Returns current user info or 401. |

### Middleware

```ts
// requireUser: accepts EITHER session cookie OR Bearer API token
//   - resolves to req.user (DB row from users)
//   - 401 if neither present/valid
async function requireUser(req, res, next) { ... }

// requireAdmin: requireUser + req.user.is_admin === 1
//   - 403 if user but not admin
async function requireAdmin(req, res, next) { ... }
```

### Session details

- Token: `crypto.randomBytes(32).toString('hex')`
- TTL: 30 days, rolling (refreshed on each request)
- Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/claudetracker/`
- Cleanup: hourly cron deletes expired sessions and magic_link_tokens

### Magic-link details

- Token: `crypto.randomBytes(32).toString('hex')`
- TTL: 15 minutes
- Single-use: `consumed_at` set on verify
- Generating a new token for the same email invalidates outstanding unused tokens for that email
- Click flow: link → intermediate page with explicit "Log in" button → POST consumes token. Prevents Mail-scanner false-clicks (Outlook, Apple Mail) from burning tokens.

### Rate limiting

- `POST /api/auth/request`: max 5/IP/15min, max 3/email/15min
- In-memory Map with TTL — single VPS instance, no Redis needed

### Apache config change

Remove Basic Auth entirely; backend handles all access control:

```apache
# /etc/httpd/conf.d/claudetracker.conf
<Location "/claudetracker">
  # OLD: AuthType Basic, AuthUserFile, Require valid-user — REMOVE
  ProxyPass http://localhost:3001/
  ProxyPassReverse http://localhost:3001/
</Location>
```

Cutover window between reload + verification is ~5 seconds. Accepted risk.

---

## 3. Extension Auth (API Tokens)

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/account/token` | session | Returns active token metadata (id, label, created_at, last_used_at) or null |
| POST | `/api/account/token` | session | Rotates: revokes current active token, issues new one. Returns plaintext **once**. |
| DELETE | `/api/account/token` | session | Revokes active token (user is then "tokenless") |

### Token format

- Plaintext: `ck_live_<32-byte-hex>` (prefixed for grep/leak detection)
- Storage: bcrypt hash of plaintext, never plaintext itself
- One active token per user enforced by partial unique index

### Auth resolution in middleware

```ts
async function requireUser(req, res, next) {
  // 1. Try session cookie
  const session = await getSessionFromCookie(req);
  if (session) { req.user = await getUserById(session.user_id); return next(); }

  // 2. Try Bearer API token
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ck_live_')) {
    const token = auth.slice(7);
    const tokenRow = await findApiTokenByPlaintext(token);  // bcrypt.compare loop
    if (tokenRow) {
      await touchApiTokenLastUsed(tokenRow.id);  // throttled to 5min granularity
      req.user = await getUserById(tokenRow.user_id);
      req.via_api_token = true;
      return next();
    }
  }
  return res.status(401).json({ error: 'unauthorized' });
}
```

### Performance

bcrypt.compare against all non-revoked tokens is O(N) per request. Acceptable at ~50 tokens; if it ever scales beyond ~1000, switch to prefix-indexed lookup (first 8 chars indexed, bcrypt only on match).

### Extension UI changes

Settings panel (popup.html `<details>`) currently has: api_base, dashboard_url, auth_user, auth_pass. New shape:

| Field | Status |
|---|---|
| Backend API URL | unchanged |
| Dashboard URL | unchanged |
| Basic Auth user | **removed** |
| Basic Auth password | **removed** |
| API token | **new** |

Plus a "Get token from dashboard" button that opens `${dashboardUrl}/settings#api-token` in a new tab.

---

## 4. API Surface Changes

### Existing endpoints — all gain `requireUser` + `WHERE user_id = req.user.id`

| Endpoint | Scoping |
|---|---|
| `POST /api/usage/track` | Insert with `user_id = req.user.id` |
| `GET /api/usage/summary` | All sub-queries filtered by user |
| `GET /api/usage/spending-total` | Cycle aggregation per user |
| `GET /api/usage/history` | Filtered |
| `GET /api/usage/models` | Filtered |
| `GET /api/console-keys` | Filtered |
| `POST /api/recommend` | model_analysis is per-user |
| `GET /api/recommend/analysis/*` | Filtered |
| `GET /api/pricing` | **Stays global**, requireUser only (read-all) |
| `PUT /api/pricing/:model` | **requireAdmin** |
| `GET /api/pricing/plans` | **Stays global**, requireUser only |
| `PUT /api/pricing/plans/:name` | **requireAdmin** |

### User-owned settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/account` | Returns `{ email, display_name, plan_name, monthly_limit_eur }` |
| PATCH | `/api/account` | Update `display_name`, `plan_name`, `monthly_limit_eur` |
| DELETE | `/api/account` | CASCADE delete all own data — DSGVO right-to-erasure |

### Admin endpoints (requireAdmin, no per-user data exposure)

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users` | List `{ id, email, plan_name, created_at, last_login_at, record_count }` only |
| PATCH | `/api/admin/users/:id` | Update `display_name`, `plan_name`, `is_admin`. **NOT email** (hijack risk). |
| DELETE | `/api/admin/users/:id` | CASCADE delete user + all their data |
| GET | `/api/admin/stats` | Aggregates only: total users, active-7d, total records — no per-user content |

### Admin restrictions (by design)

- ❌ View individual `usage_records` of another user
- ❌ View plaintext API token of another user (only revoke)
- ❌ Generate magic-link "as another user"
- ❌ Change another user's email

### Defensive query helper

```ts
// All queries on usage_records / model_analysis go through:
db.allForUser(sql, userId, params);
// Auto-injects WHERE user_id = ? — forgetting becomes compile error, not data leak
```

---

## 5. Frontend Changes

### New routes

| Route | Auth | Purpose |
|---|---|---|
| `/login` | none | Email input, magic-link request |
| `/auth/verify` | none | Intermediate "Click to log in" page after mail-link |

### Restructured Settings page

Single page with conditional sections via `useAuth().user.is_admin`:

```
Settings
├─ Account              (all users)  — email, display_name, plan, monthly_limit
├─ API Token            (all users)  — generate / rotate / revoke
├─ Plan Pricing         (all see, admin edits)
├─ Model Pricing        (all see, admin edits)
├─ User Management      (admin only) — table, edit/delete
└─ System Stats         (admin only) — aggregate dashboard
```

### App-shell additions

- `AuthProvider` (React Context) — calls `/api/auth/me` on mount, holds `{ user, loading, refresh, logout }`
- `<RequireAuth>` wrapper for all routes except `/login`, `/auth/verify`
- Top-bar gains user-menu (initials avatar → dropdown: Account, Logout, Admin link if admin)
- All `fetch()` calls add `credentials: 'include'`
- 401 response → redirect to `/login` (replace current "Backend error" toast)

### Onboarding banner (Dashboard)

Shown when `GET /api/account/token` returns null:

> 🔌 **Browser-Extension einrichten**: Generiere einen API-Token in Settings → API Token, lade die Extension und trage den Token ein, um automatisch zu syncen. [Dismiss]

Dismiss state stored in localStorage (`onboarding_banner_dismissed: true`).

---

## 6. Email Setup

### Sender

- Address: `noreply@wolfinisoftware.de` (no subdomain isolation; reputation tied to main domain)
- Display name: `Claude Usage Tracker`

### Transport

```ts
import nodemailer from 'nodemailer';
const transport = nodemailer.createTransport({
  host: 'localhost', port: 25, secure: false  // existing Postfix relay
});
```

Postfix relays through Ionos SMTP, identical path as existing health-alert mails.

### Magic-link mail (plain text only — better deliverability for low-volume sender)

```
Subject: Dein Login-Link für Claude Usage Tracker

Hallo!

Klicke den folgenden Link um dich einzuloggen:

https://wolfinisoftware.de/claudetracker/auth/verify?token=<32hex>

Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.

Falls du diesen Login nicht angefordert hast, ignoriere diese Mail.

—
Claude Usage Tracker
```

### Pre-launch verification (best-effort, not blocking)

```bash
dig TXT wolfinisoftware.de | grep -E "v=spf1|v=DMARC1"
dig TXT default._domainkey.wolfinisoftware.de
# Send test mail to mail-tester.com, verify score ≥ 8/10
```

If score < 8: extend SPF to include Ionos SMTP, generate DKIM key + add to DNS, set DMARC `p=quarantine`. Done as best-effort; launch proceeds even if score is borderline.

### Send-failure handling

Mail send error → user still sees 200 (no enumeration), `console.error` logged server-side. Token row not consumed → user can retry.

---

## 7. Migration & Rollout

Seven phases, each independently deployable and reversible:

### Phase A — Schema migration (backend-only, no user impact)

- New tables: `users`, `sessions`, `magic_link_tokens`, `api_tokens`
- `ALTER TABLE usage_records ADD COLUMN user_id`
- `ALTER TABLE model_analysis ADD COLUMN user_id`
- Insert user 1 (harald) + backfill `user_id = 1` on existing rows
- Indexes

**Risk**: low. Existing queries continue working (extra column ignored).
**Rollback**: drop new tables + drop user_id column.

### Phase B — Auth backend (endpoints, middleware, mail)

- Magic-link endpoints + nodemailer setup
- `requireUser` / `requireAdmin` middleware (defined but **not yet** applied to existing endpoints)
- Account/token endpoints

**Apache config not yet changed** → Basic Auth still gates everything. Allows parallel testing.

### Phase C — Endpoint scoping

- All existing endpoints get `requireUser` + `WHERE user_id = ?`
- Introduce `db.allForUser` helper
- Smoke tests against each endpoint with harald's session

**Risk**: medium. A missed scope = cross-user data leak. Mitigated by helper + integration tests asserting isolation.

### Phase D — Frontend (login, account, settings, banner)

- Login page, AuthContext, RequireAuth wrapper
- Settings restructure with Account/Token/Admin sections
- Onboarding banner
- All `fetch()` get `credentials: 'include'`

### Phase E — Extension update

- popup.html/js: replace Basic-Auth fields with API-token field
- background.js: send `Authorization: Bearer ck_live_...` instead of Basic
- Manifest version bump → users must reload extension
- README setup instructions updated

**Risk**: low. Old Basic-Auth headers were stripped by Apache before reaching the backend, so old extension installs simply stop syncing once Phase F removes Apache's Basic Auth — they re-prompt the user for credentials, which now do nothing. Users will need to install/reload the extension and paste a new API token. Acceptable because the user base is currently 1 (harald) at cutover.

### Phase F — Apache cutover (critical moment)

```bash
sudo vim /etc/httpd/conf.d/claudetracker.conf  # remove AuthType Basic block
sudo systemctl reload httpd
# Immediately verify:
curl -I https://wolfinisoftware.de/claudetracker/api/auth/me   # 401, not 401-Basic-Auth
curl https://wolfinisoftware.de/claudetracker/                  # 200
```

**Cutover window**: ~5 seconds. If broken: revert config, reload.

### Phase G — Open signup live

- `/api/auth/request` accepts emails not yet in `users` → implicit user creation
- Until this point, unknown emails return 200 silently but no user is created
- Share the URL publicly

### Effort estimate

Full-time: ~5–7 days. Side-project pace: ~2–3 weeks.

---

## Out of Scope (v1)

- Payment / paid tiers
- Two-factor auth, security questions
- OAuth (Google/GitHub) login
- Account recovery beyond magic-link re-request
- Per-user API rate limiting
- Admin audit log
- Email verification as separate step (magic-link click is implicit verification)
- Per-user pricing overrides

---

## Open Risks

1. **Magic-link deliverability**: existing Postfix → Ionos relay may not have DKIM signing. If Gmail/Outlook bounce or spam-folder magic links, new users hang. Mitigation: best-effort pre-launch check via mail-tester.com, fall back to subdomain isolation if score is poor.
2. **Cross-user data leak**: every `WHERE user_id = ?` filter must be present. Mitigation: `db.allForUser` helper makes forgetting a compile error; integration tests assert isolation between two test users.
3. **Apache cutover window**: ~5 second period where Basic Auth is gone but app-level auth not yet enforced. Mitigation: have rollback config staged; verification curl in same shell session.
4. **Extension token leak**: API tokens are long-lived bearer credentials. Mitigation: `ck_live_` prefix for grep/scan tools; one-active-token-per-user via partial unique index limits blast radius; user can rotate at will.
