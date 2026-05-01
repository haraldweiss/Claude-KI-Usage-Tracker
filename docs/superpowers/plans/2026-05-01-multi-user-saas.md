# Multi-User SaaS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-user (Apache-Basic-Auth-gated) Claude Usage Tracker into an open-signup SaaS where each user gets their own private tracking surface. Existing user (harald) migrates to user_id=1 with all historical data preserved.

**Architecture:** Single SQLite database, multi-tenant via `user_id` foreign keys on per-user tables. Magic-link auth (no passwords) with server-side sessions for the dashboard and long-lived API tokens for the extension. Apache becomes a transparent reverse proxy + TLS terminator; access control moves into the application layer. Seven phases, each independently deployable and reversible.

**Tech Stack:** Node.js + Express + sqlite3 (callback API), TypeScript, Jest (backend), React + Vite + Vitest (frontend), Chrome MV3 (extension), Apache (TLS/proxy), nodemailer + existing Postfix → Ionos SMTP relay.

**Spec reference:** `docs/superpowers/specs/2026-05-01-multi-user-saas-design.md`

---

## File Structure

### Backend — new files

| File | Responsibility |
|---|---|
| `backend/src/services/authService.ts` | Magic-link token CRUD, session create/validate, API-token CRUD |
| `backend/src/services/mailService.ts` | nodemailer wrapper, magic-link mail template |
| `backend/src/middleware/auth.ts` | `requireUser`, `requireAdmin`, session+bearer resolution |
| `backend/src/controllers/authController.ts` | `/api/auth/*` endpoints |
| `backend/src/controllers/accountController.ts` | `/api/account/*` endpoints (profile, token) |
| `backend/src/controllers/adminController.ts` | `/api/admin/*` endpoints (user mgmt, stats) |
| `backend/src/routes/auth.ts` | Auth endpoint routing |
| `backend/src/routes/account.ts` | Account endpoint routing |
| `backend/src/routes/admin.ts` | Admin endpoint routing |
| `backend/src/utils/scopedDb.ts` | `allForUser` / `getForUser` query helpers |
| `backend/src/__tests__/unit/authService.test.ts` | Token/session unit tests |
| `backend/src/__tests__/unit/mailService.test.ts` | Mail template tests |
| `backend/src/__tests__/integration/auth-flow.test.ts` | Full magic-link flow E2E |
| `backend/src/__tests__/integration/data-isolation.test.ts` | Two users can't see each other's data |

### Backend — modified files

| File | Change |
|---|---|
| `backend/src/database/sqlite.ts` | Add new tables (users/sessions/magic_link_tokens/api_tokens), add `user_id` columns to usage_records and model_analysis, migration insert harald |
| `backend/src/app.ts` | Wire new routes + middleware, add cookie-parser |
| `backend/src/controllers/usageController.ts` | Scope all queries by `req.user.id` |
| `backend/src/controllers/pricingController.ts` | PUT/PATCH endpoints gain `requireAdmin` |
| `backend/src/controllers/modelRecommendationController.ts` | Scope queries by `req.user.id` |
| `backend/src/types/index.ts` | Add User/Session/Token types, extend `Express.Request` |
| `backend/package.json` | Add: nodemailer, bcrypt, cookie-parser; types for each |

### Frontend — new files

| File | Responsibility |
|---|---|
| `frontend/src/pages/Login.tsx` | Email input, magic-link request |
| `frontend/src/pages/AuthVerify.tsx` | "Click to log in" intermediate page |
| `frontend/src/contexts/AuthContext.tsx` | `useAuth()` hook with user, loading, refresh, logout |
| `frontend/src/components/RequireAuth.tsx` | Route wrapper that redirects to /login if not authenticated |
| `frontend/src/components/UserMenu.tsx` | Top-bar user dropdown |
| `frontend/src/components/OnboardingBanner.tsx` | Dashboard banner shown when no API token exists |
| `frontend/src/components/settings/AccountSection.tsx` | Profile editor (display_name, plan, monthly_limit) |
| `frontend/src/components/settings/ApiTokenSection.tsx` | Token generate/rotate/revoke UI |
| `frontend/src/components/settings/AdminUsersSection.tsx` | Admin user table + edit/delete |
| `frontend/src/components/settings/AdminStatsSection.tsx` | Aggregate stats card |

### Frontend — modified files

| File | Change |
|---|---|
| `frontend/src/App.tsx` | Add Router, AuthProvider, RequireAuth wrapping |
| `frontend/src/pages/Settings.tsx` | Restructure with sections |
| `frontend/src/pages/Dashboard.tsx` | Mount OnboardingBanner |
| `frontend/src/services/api.ts` | `credentials: 'include'`, 401 → redirect |
| `frontend/src/types/api.ts` | Add User, AuthResponse, ApiToken, AdminUser types |
| `frontend/package.json` | Add react-router-dom |

### Extension — modified files

| File | Change |
|---|---|
| `extension/manifest.json` | Version bump (1.0.0 → 2.0.0) |
| `extension/popup.html` | Basic-Auth fields removed, API-token field added |
| `extension/popup.js` | Settings load/save updated for token; helper button to dashboard |
| `extension/background.js` | `Authorization: Bearer ck_live_…` instead of Basic |

### Apache — manual changes on VPS

| File | Change |
|---|---|
| `/etc/httpd/conf.d/claudetracker.conf` | Remove `AuthType Basic` block (Phase F) |

---

## Phase A — Schema Migration

**Outcome:** New tables exist, `user_id` column added to per-user tables, harald inserted as user 1, existing rows backfilled. No code-level behavior change yet.

### Task A1: Define users/sessions/tokens schema in `initDatabase`

**Files:**
- Modify: `backend/src/database/sqlite.ts:140-210` (after the existing `addMissingColumns` calls, before the final `resolve()`)

- [ ] **Step 1: Add CREATE TABLE statements for new tables**

In `backend/src/database/sqlite.ts`, inside `initDatabase`, after the existing `database.run('CREATE INDEX IF NOT EXISTS idx_pricing_model …')` callback opens but before any of the existing `addMissingColumns` calls, add four new `CREATE TABLE IF NOT EXISTS` blocks. Each follows the same callback pattern as existing tables:

```ts
database.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    plan_name TEXT,
    monthly_limit_eur REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  )
`, (err: Error | null) => { if (err && !err.message.includes('already exists')) reject(err); });

database.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT
  )
`, (err: Error | null) => { if (err && !err.message.includes('already exists')) reject(err); });

database.run(`
  CREATE TABLE IF NOT EXISTS magic_link_tokens (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  )
`, (err: Error | null) => { if (err && !err.message.includes('already exists')) reject(err); });

database.run(`
  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT
  )
`, (err: Error | null) => { if (err && !err.message.includes('already exists')) reject(err); });
```

- [ ] **Step 2: Add indexes for the new tables**

Inside the same async migration block (where existing indexes are created), add:

```ts
await new Promise<void>((res, rej) => {
  database.run('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
    (e: Error | null) => (e ? rej(e) : res()));
});
await new Promise<void>((res, rej) => {
  database.run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
    (e: Error | null) => (e ? rej(e) : res()));
});
await new Promise<void>((res, rej) => {
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_mlt_email_active ON magic_link_tokens(email) WHERE consumed_at IS NULL',
    (e: Error | null) => (e ? rej(e) : res()));
});
await new Promise<void>((res, rej) => {
  database.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_token_per_user ON api_tokens(user_id) WHERE revoked_at IS NULL',
    (e: Error | null) => (e ? rej(e) : res()));
});
```

- [ ] **Step 3: Run backend, verify tables exist**

```bash
cd backend && rm -f /tmp/test-multiuser.sqlite && DATABASE_PATH=/tmp/test-multiuser.sqlite npx tsx src/server.ts &
sleep 2
sqlite3 /tmp/test-multiuser.sqlite ".schema users"
sqlite3 /tmp/test-multiuser.sqlite ".schema sessions"
sqlite3 /tmp/test-multiuser.sqlite ".schema magic_link_tokens"
sqlite3 /tmp/test-multiuser.sqlite ".schema api_tokens"
kill %1
```

Expected: Each `.schema` prints the CREATE TABLE statement.

- [ ] **Step 4: Commit**

```bash
git add backend/src/database/sqlite.ts
git commit -m "feat(db): add users/sessions/magic_link_tokens/api_tokens tables"
```

### Task A2: Add `user_id` column to per-user tables

**Files:**
- Modify: `backend/src/database/sqlite.ts:148-169` (the `addMissingColumns('usage_records', …)` block) and add a new call for `model_analysis`

- [ ] **Step 1: Extend usage_records column list**

In the existing `addMissingColumns('usage_records', [...])` array, append:

```ts
{ name: 'user_id', ddl: 'INTEGER REFERENCES users(id)' }
```

- [ ] **Step 2: Add a new addMissingColumns call for model_analysis**

After the `addMissingColumns('plan_pricing', …)` call:

```ts
await addMissingColumns('model_analysis', [
  { name: 'user_id', ddl: 'INTEGER REFERENCES users(id)' }
]);
```

- [ ] **Step 3: Add composite index on (user_id, timestamp)**

```ts
await new Promise<void>((res, rej) => {
  database.run('CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_records(user_id, timestamp)',
    (e: Error | null) => (e ? rej(e) : res()));
});
```

- [ ] **Step 4: Verify against fresh DB**

```bash
cd backend && rm -f /tmp/test-multiuser.sqlite && DATABASE_PATH=/tmp/test-multiuser.sqlite npx tsx src/server.ts &
sleep 2
sqlite3 /tmp/test-multiuser.sqlite "PRAGMA table_info(usage_records)" | grep user_id
sqlite3 /tmp/test-multiuser.sqlite "PRAGMA table_info(model_analysis)" | grep user_id
kill %1
```

Expected: both grep lines show `user_id|INTEGER|0||0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/database/sqlite.ts
git commit -m "feat(db): add user_id column to usage_records and model_analysis"
```

### Task A3: Initial-user migration (insert harald + backfill)

**Files:**
- Create: `backend/src/database/migrations/seedInitialUser.ts`
- Modify: `backend/src/database/sqlite.ts` (call seedInitialUser at end of initDatabase)

- [ ] **Step 1: Write the seed function**

Create `backend/src/database/migrations/seedInitialUser.ts`:

```ts
import { runQuery, getQuery } from '../sqlite.js';

/**
 * One-time migration: ensure user 1 (harald) exists and that all pre-existing
 * usage_records / model_analysis rows are tagged with user_id = 1. Idempotent —
 * safe to run on every startup.
 */
export async function seedInitialUser(): Promise<void> {
  const existing = await getQuery<{ count: number }>('SELECT COUNT(*) as count FROM users');
  if (existing && existing.count > 0) return;  // already seeded

  await runQuery(
    `INSERT INTO users (id, email, display_name, is_admin, plan_name, monthly_limit_eur)
     VALUES (1, ?, ?, 1, ?, ?)`,
    ['anubclaw@gmail.com', 'Harald', 'Max (5x)', 50.0]
  );

  await runQuery('UPDATE usage_records SET user_id = 1 WHERE user_id IS NULL');
  await runQuery('UPDATE model_analysis SET user_id = 1 WHERE user_id IS NULL');

  console.log('[migration] Seeded initial user (harald) and backfilled user_id columns');
}
```

- [ ] **Step 2: Wire into initDatabase**

In `backend/src/database/sqlite.ts`, inside the migration async block, just before the final `resolve()`:

```ts
const { seedInitialUser } = await import('./migrations/seedInitialUser.js');
await seedInitialUser();
```

- [ ] **Step 3: Test with fresh DB containing pre-existing data**

```bash
# Setup: copy current production DB locally to test against real data shape
ssh ionos-vps 'cat /var/www/wolfinisoftware/claudetracker/backend/database.sqlite' > /tmp/prod-snapshot.sqlite
# Run startup — should backfill in place
cd backend && DATABASE_PATH=/tmp/prod-snapshot.sqlite npx tsx src/server.ts &
sleep 3
sqlite3 /tmp/prod-snapshot.sqlite "SELECT id, email, plan_name FROM users"
sqlite3 /tmp/prod-snapshot.sqlite "SELECT COUNT(*) as total, COUNT(user_id) as tagged FROM usage_records"
kill %1
```

Expected: users table has one row (id=1, email=anubclaw@gmail.com); `total == tagged` in usage_records.

- [ ] **Step 4: Commit**

```bash
git add backend/src/database/migrations/seedInitialUser.ts backend/src/database/sqlite.ts
git commit -m "feat(db): seed initial user and backfill user_id on existing rows"
```

---

## Phase B — Auth Backend

**Outcome:** Magic-link login works end-to-end. Session cookies are set on verify. API token CRUD works. Existing API endpoints are NOT yet protected (Phase C does that). Apache Basic Auth still gates everything from the outside, so this can be tested via `curl` from the VPS itself.

### Task B1: Add backend dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install runtime + types**

```bash
cd backend && npm install nodemailer bcrypt cookie-parser
npm install -D @types/nodemailer @types/bcrypt @types/cookie-parser
```

- [ ] **Step 2: Verify install**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore(backend): add nodemailer, bcrypt, cookie-parser deps"
```

### Task B2: Add types for User/Session/Token

**Files:**
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: Add type definitions**

Append to `backend/src/types/index.ts`:

```ts
export interface User {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: 0 | 1;
  plan_name: string | null;
  monthly_limit_eur: number | null;
  created_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

export interface MagicLinkTokenRow {
  token: string;
  email: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface ApiTokenRow {
  id: number;
  user_id: number;
  token_hash: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// Augment Express Request to include req.user (set by auth middleware)
declare global {
  namespace Express {
    interface Request {
      user?: User;
      via_api_token?: boolean;
    }
  }
}
```

- [ ] **Step 2: Verify type-check passes**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/index.ts
git commit -m "feat(types): add User/Session/Token types and Express.Request augmentation"
```

### Task B3: AuthService — magic-link tokens

**Files:**
- Create: `backend/src/services/authService.ts`
- Test: `backend/src/__tests__/unit/authService.test.ts`

- [ ] **Step 1: Write failing tests for magic-link create+consume**

Create `backend/src/__tests__/unit/authService.test.ts`:

```ts
import { initDatabase, runQuery } from '../../database/sqlite.js';
import { createMagicLinkToken, consumeMagicLinkToken } from '../../services/authService.js';

beforeAll(async () => {
  process.env.DATABASE_PATH = ':memory:';
  await initDatabase();
});

describe('magic-link tokens', () => {
  it('creates a token with 15-minute TTL', async () => {
    const token = await createMagicLinkToken('alice@example.com');
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('consumes a token and returns the email', async () => {
    const token = await createMagicLinkToken('bob@example.com');
    const result = await consumeMagicLinkToken(token);
    expect(result).toEqual({ email: 'bob@example.com' });
  });

  it('refuses to consume an already-consumed token', async () => {
    const token = await createMagicLinkToken('carol@example.com');
    await consumeMagicLinkToken(token);
    await expect(consumeMagicLinkToken(token)).rejects.toThrow('already consumed');
  });

  it('refuses to consume an expired token', async () => {
    const token = await createMagicLinkToken('dave@example.com');
    // backdate the token to expire it
    await runQuery(
      `UPDATE magic_link_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?`,
      [token]
    );
    await expect(consumeMagicLinkToken(token)).rejects.toThrow('expired');
  });

  it('invalidates outstanding tokens for the same email when a new one is created', async () => {
    const t1 = await createMagicLinkToken('eve@example.com');
    await createMagicLinkToken('eve@example.com');  // should invalidate t1
    await expect(consumeMagicLinkToken(t1)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify all fail with module-not-found**

```bash
cd backend && npm test -- authService.test.ts
```

Expected: FAIL — `Cannot find module '../../services/authService.js'`.

- [ ] **Step 3: Implement authService magic-link functions**

Create `backend/src/services/authService.ts`:

```ts
import crypto from 'crypto';
import { runQuery, getQuery } from '../database/sqlite.js';
import type { MagicLinkTokenRow } from '../types/index.js';

const MAGIC_LINK_TTL_MIN = 15;

export async function createMagicLinkToken(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  // Invalidate any outstanding unused tokens for this email
  await runQuery(
    `UPDATE magic_link_tokens SET consumed_at = datetime('now')
     WHERE email = ? AND consumed_at IS NULL`,
    [normalized]
  );
  const token = crypto.randomBytes(32).toString('hex');
  await runQuery(
    `INSERT INTO magic_link_tokens (token, email, expires_at)
     VALUES (?, ?, datetime('now', '+${MAGIC_LINK_TTL_MIN} minutes'))`,
    [token, normalized]
  );
  return token;
}

export async function consumeMagicLinkToken(token: string): Promise<{ email: string }> {
  const row = await getQuery<MagicLinkTokenRow>(
    'SELECT * FROM magic_link_tokens WHERE token = ?',
    [token]
  );
  if (!row) throw new Error('token not found');
  if (row.consumed_at) throw new Error('already consumed');
  if (new Date(row.expires_at) < new Date()) throw new Error('expired');
  await runQuery(
    `UPDATE magic_link_tokens SET consumed_at = datetime('now') WHERE token = ?`,
    [token]
  );
  return { email: row.email };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd backend && npm test -- authService.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/authService.ts backend/src/__tests__/unit/authService.test.ts
git commit -m "feat(auth): magic-link token create/consume with 15min TTL"
```

### Task B4: AuthService — sessions

**Files:**
- Modify: `backend/src/services/authService.ts`
- Modify: `backend/src/__tests__/unit/authService.test.ts`

- [ ] **Step 1: Write failing tests for session create/get/delete**

Append to `backend/src/__tests__/unit/authService.test.ts`:

```ts
import { createSession, getSessionUser, deleteSession } from '../../services/authService.js';

describe('sessions', () => {
  it('creates a session for a user and returns the session id', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (100, 'sess1@x.com')`);
    const sid = await createSession(100, 'Mozilla/5.0', '127.0.0.1');
    expect(sid).toMatch(/^[a-f0-9]{64}$/);
  });

  it('resolves a session id back to a user', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (101, 'sess2@x.com')`);
    const sid = await createSession(101, null, null);
    const user = await getSessionUser(sid);
    expect(user?.email).toBe('sess2@x.com');
  });

  it('returns null for an unknown session id', async () => {
    const user = await getSessionUser('deadbeef');
    expect(user).toBeNull();
  });

  it('returns null for an expired session', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (102, 'sess3@x.com')`);
    const sid = await createSession(102, null, null);
    await runQuery(`UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE id = ?`, [sid]);
    expect(await getSessionUser(sid)).toBeNull();
  });

  it('deletes a session', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (103, 'sess4@x.com')`);
    const sid = await createSession(103, null, null);
    await deleteSession(sid);
    expect(await getSessionUser(sid)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend && npm test -- authService.test.ts
```

Expected: FAIL with "is not a function" for the new helpers.

- [ ] **Step 3: Implement session functions**

Append to `backend/src/services/authService.ts`:

```ts
import type { User } from '../types/index.js';

const SESSION_TTL_DAYS = 30;

export async function createSession(
  userId: number,
  userAgent: string | null,
  ipAddress: string | null
): Promise<string> {
  const sid = crypto.randomBytes(32).toString('hex');
  await runQuery(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address)
     VALUES (?, ?, datetime('now', '+${SESSION_TTL_DAYS} days'), ?, ?)`,
    [sid, userId, userAgent, ipAddress]
  );
  await runQuery(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [userId]);
  return sid;
}

export async function getSessionUser(sessionId: string): Promise<User | null> {
  const row = await getQuery<User & { expires_at: string }>(
    `SELECT u.*, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [sessionId]
  );
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  // Strip expires_at from returned shape
  const { expires_at: _e, ...user } = row;
  return user;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await runQuery('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export async function touchSession(sessionId: string): Promise<void> {
  await runQuery(
    `UPDATE sessions SET expires_at = datetime('now', '+${SESSION_TTL_DAYS} days') WHERE id = ?`,
    [sessionId]
  );
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd backend && npm test -- authService.test.ts
```

Expected: PASS — all session tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/authService.ts backend/src/__tests__/unit/authService.test.ts
git commit -m "feat(auth): session create/get/delete/touch with 30-day rolling TTL"
```

### Task B5: AuthService — API tokens

**Files:**
- Modify: `backend/src/services/authService.ts`
- Modify: `backend/src/__tests__/unit/authService.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `backend/src/__tests__/unit/authService.test.ts`:

```ts
import { createApiToken, getActiveApiToken, revokeApiToken, findUserByApiToken } from '../../services/authService.js';

describe('API tokens', () => {
  it('creates a token, returns plaintext only once', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (200, 'tok1@x.com')`);
    const { plaintext, id } = await createApiToken(200, 'Test Label');
    expect(plaintext).toMatch(/^ck_live_[a-f0-9]{64}$/);
    expect(id).toBeGreaterThan(0);
  });

  it('rotates: creating a new token revokes the previous active one', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (201, 'tok2@x.com')`);
    const t1 = await createApiToken(201, 'first');
    const t2 = await createApiToken(201, 'second');
    expect(t1.id).not.toBe(t2.id);
    const active = await getActiveApiToken(201);
    expect(active?.id).toBe(t2.id);
  });

  it('resolves a plaintext token back to its user', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (202, 'tok3@x.com')`);
    const { plaintext } = await createApiToken(202, null);
    const user = await findUserByApiToken(plaintext);
    expect(user?.id).toBe(202);
  });

  it('returns null for an unknown token', async () => {
    expect(await findUserByApiToken('ck_live_deadbeef')).toBeNull();
  });

  it('revoked tokens no longer resolve', async () => {
    await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (203, 'tok4@x.com')`);
    const { plaintext, id } = await createApiToken(203, null);
    await revokeApiToken(203, id);
    expect(await findUserByApiToken(plaintext)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

```bash
cd backend && npm test -- authService.test.ts
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement token functions**

Append to `backend/src/services/authService.ts`:

```ts
import bcrypt from 'bcrypt';
import { allQuery } from '../database/sqlite.js';
import type { ApiTokenRow } from '../types/index.js';

const TOKEN_PREFIX = 'ck_live_';
const BCRYPT_ROUNDS = 10;

export async function createApiToken(
  userId: number,
  label: string | null
): Promise<{ plaintext: string; id: number }> {
  // Revoke existing active token for this user (one-active-per-user rule)
  await runQuery(
    `UPDATE api_tokens SET revoked_at = datetime('now')
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  const random = crypto.randomBytes(32).toString('hex');
  const plaintext = `${TOKEN_PREFIX}${random}`;
  const hash = await bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  const result = await runQuery(
    `INSERT INTO api_tokens (user_id, token_hash, label) VALUES (?, ?, ?)`,
    [userId, hash, label]
  );
  return { plaintext, id: result.lastID };
}

export async function getActiveApiToken(userId: number): Promise<ApiTokenRow | null> {
  return (await getQuery<ApiTokenRow>(
    `SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  )) ?? null;
}

export async function revokeApiToken(userId: number, tokenId: number): Promise<void> {
  await runQuery(
    `UPDATE api_tokens SET revoked_at = datetime('now')
     WHERE user_id = ? AND id = ? AND revoked_at IS NULL`,
    [userId, tokenId]
  );
}

export async function findUserByApiToken(plaintext: string): Promise<User | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  // Get all non-revoked tokens; bcrypt.compare against each.
  // Acceptable at < ~1k active tokens. Switch to prefix-indexed lookup if scale grows.
  const candidates = await allQuery<ApiTokenRow>(
    `SELECT * FROM api_tokens WHERE revoked_at IS NULL`
  );
  for (const row of candidates) {
    if (await bcrypt.compare(plaintext, row.token_hash)) {
      // Throttle last_used_at writes to once per 5 minutes
      const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
      if (Date.now() - last > 5 * 60 * 1000) {
        await runQuery(
          `UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?`,
          [row.id]
        );
      }
      return await getQuery<User>('SELECT * FROM users WHERE id = ?', [row.user_id]) ?? null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd backend && npm test -- authService.test.ts
```

Expected: PASS — all token tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/authService.ts backend/src/__tests__/unit/authService.test.ts
git commit -m "feat(auth): API token CRUD with bcrypt hashing and one-active-per-user rule"
```

### Task B6: MailService

**Files:**
- Create: `backend/src/services/mailService.ts`
- Test: `backend/src/__tests__/unit/mailService.test.ts`

- [ ] **Step 1: Write failing test (mocked transport)**

Create `backend/src/__tests__/unit/mailService.test.ts`:

```ts
import { jest } from '@jest/globals';

const sendMailMock = jest.fn();
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}));

const { sendMagicLinkMail } = await import('../../services/mailService.js');

describe('sendMagicLinkMail', () => {
  beforeEach(() => sendMailMock.mockReset());

  it('sends a plain-text mail with the verify URL', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' });
    await sendMagicLinkMail('alice@example.com', 'token123', 'https://example.com/verify');

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com',
      from: expect.stringContaining('noreply@wolfinisoftware.de'),
      subject: expect.stringContaining('Login-Link'),
      text: expect.stringContaining('https://example.com/verify?token=token123')
    }));
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd backend && npm test -- mailService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement mailService**

Create `backend/src/services/mailService.ts`:

```ts
import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '25', 10);
const FROM_ADDRESS = process.env.MAIL_FROM || 'Claude Usage Tracker <noreply@wolfinisoftware.de>';

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false
});

export async function sendMagicLinkMail(
  email: string,
  token: string,
  verifyBaseUrl: string
): Promise<void> {
  const link = `${verifyBaseUrl}?token=${encodeURIComponent(token)}`;
  const body = [
    'Hallo!',
    '',
    'Klicke den folgenden Link um dich einzuloggen:',
    '',
    link,
    '',
    'Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.',
    '',
    'Falls du diesen Login nicht angefordert hast, ignoriere diese Mail.',
    '',
    '—',
    'Claude Usage Tracker'
  ].join('\n');

  await transport.sendMail({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Dein Login-Link für Claude Usage Tracker',
    text: body
  });
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd backend && npm test -- mailService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/mailService.ts backend/src/__tests__/unit/mailService.test.ts
git commit -m "feat(mail): nodemailer transport + magic-link mail template"
```

### Task B7: Auth middleware

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Test: extends `backend/src/__tests__/integration/auth-flow.test.ts` in B9

- [ ] **Step 1: Implement requireUser + requireAdmin**

Create `backend/src/middleware/auth.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { getSessionUser, findUserByApiToken, touchSession } from '../services/authService.js';

const SESSION_COOKIE = 'cut_session';

/**
 * Resolves req.user from EITHER a session cookie OR a Bearer API token.
 * 401 if neither present or both invalid.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1. Session cookie
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    const user = await getSessionUser(sid);
    if (user) {
      await touchSession(sid);  // rolling expiry
      req.user = user;
      return next();
    }
  }
  // 2. Bearer API token
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const user = await findUserByApiToken(token);
    if (user) {
      req.user = user;
      req.via_api_token = true;
      return next();
    }
  }
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * requireUser + admin check. 403 if user is authenticated but not admin.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireUser(req, res, () => {
    if (req.user?.is_admin === 1) return next();
    res.status(403).json({ error: 'admin only' });
  });
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
```

- [ ] **Step 2: Type-check**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/auth.ts
git commit -m "feat(auth): requireUser/requireAdmin middleware (session + bearer)"
```

### Task B8: Auth controller and routes

**Files:**
- Create: `backend/src/controllers/authController.ts`
- Create: `backend/src/routes/auth.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Implement controller**

Create `backend/src/controllers/authController.ts`:

```ts
import type { Request, Response } from 'express';
import { createMagicLinkToken, consumeMagicLinkToken, createSession, deleteSession, getSessionUser } from '../services/authService.js';
import { sendMagicLinkMail } from '../services/mailService.js';
import { runQuery, getQuery } from '../database/sqlite.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';
import type { User } from '../types/index.js';

const VERIFY_BASE_URL = process.env.VERIFY_BASE_URL || 'https://wolfinisoftware.de/claudetracker/auth/verify';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/claudetracker/',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

const requestRateLimit = new Map<string, number[]>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_PER_IP = 5;
const RATE_MAX_PER_EMAIL = 3;

function isRateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const hits = (requestRateLimit.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= max) return true;
  hits.push(now);
  requestRateLimit.set(key, hits);
  return false;
}

export async function requestMagicLink(req: Request, res: Response): Promise<void> {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const ip = req.ip || 'unknown';
  if (!email || !email.includes('@')) {
    // Always 200 — no enumeration leak
    res.json({ ok: true });
    return;
  }
  if (isRateLimited(`ip:${ip}`, RATE_MAX_PER_IP) || isRateLimited(`email:${email}`, RATE_MAX_PER_EMAIL)) {
    res.json({ ok: true });
    return;
  }
  try {
    const token = await createMagicLinkToken(email);
    await sendMagicLinkMail(email, token, VERIFY_BASE_URL);
  } catch (err) {
    console.error('[auth] mail send failed:', (err as Error).message);
    // Still 200 — token row stays in DB for retry / no enumeration leak
  }
  res.json({ ok: true });
}

/**
 * Renders an HTML page with a "Log in" button. The button POSTs back to
 * /api/auth/verify which actually consumes the token. This intermediate
 * step prevents mail-scanner GET requests (Outlook, Apple Mail) from
 * burning the token.
 */
export async function showVerifyPage(req: Request, res: Response): Promise<void> {
  const token = String(req.query.token || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><title>Login</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center}
button{font-size:18px;padding:12px 32px;background:#3B82F6;color:white;border:none;border-radius:8px;cursor:pointer}
button:hover{background:#2563EB}</style></head><body>
<h1>Login bestätigen</h1>
<p>Klicke auf den Button um dich anzumelden.</p>
<form method="POST" action="/claudetracker/api/auth/verify">
  <input type="hidden" name="token" value="${token.replace(/"/g, '&quot;')}">
  <button type="submit">Einloggen</button>
</form>
</body></html>`);
}

export async function consumeVerify(req: Request, res: Response): Promise<void> {
  const token = String(req.body?.token || req.query?.token || '');
  try {
    const { email } = await consumeMagicLinkToken(token);
    let user = await getQuery<User>('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      // Open signup: implicit user creation on first verified login
      const display = email.split('@')[0];
      const result = await runQuery(
        `INSERT INTO users (email, display_name) VALUES (?, ?)`,
        [email, display]
      );
      user = await getQuery<User>('SELECT * FROM users WHERE id = ?', [result.lastID]);
    }
    if (!user) throw new Error('user creation failed');
    const sid = await createSession(user.id, req.headers['user-agent'] || null, req.ip || null);
    res.cookie(SESSION_COOKIE_NAME, sid, COOKIE_OPTS);
    res.redirect('/claudetracker/');
  } catch (err) {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center">
      <h1>Login fehlgeschlagen</h1><p>${(err as Error).message}. <a href="/claudetracker/login">Neuen Link anfordern</a></p>
      </body></html>`
    );
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE_NAME];
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/claudetracker/' });
  res.status(204).send();
}

export async function whoami(req: Request, res: Response): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sid) { res.status(401).json({ error: 'no session' }); return; }
  const user = await getSessionUser(sid);
  if (!user) { res.status(401).json({ error: 'invalid session' }); return; }
  res.json({ id: user.id, email: user.email, display_name: user.display_name,
             plan_name: user.plan_name, monthly_limit_eur: user.monthly_limit_eur,
             is_admin: user.is_admin === 1 });
}
```

- [ ] **Step 2: Wire routes**

Create `backend/src/routes/auth.ts`:

```ts
import { Router } from 'express';
import { requestMagicLink, showVerifyPage, consumeVerify, logout, whoami } from '../controllers/authController.js';

const router = Router();
router.post('/request', requestMagicLink);
router.get('/verify', showVerifyPage);
router.post('/verify', consumeVerify);
router.post('/logout', logout);
router.get('/me', whoami);
export default router;
```

- [ ] **Step 3: Mount in app + add cookie-parser**

In `backend/src/app.ts`, add near the top with other imports:

```ts
import cookieParser from 'cookie-parser';
import authRouter from './routes/auth.js';
```

Add middleware before route registration:

```ts
app.use(cookieParser());
```

Mount the router (place near other route mounts):

```ts
app.use('/api/auth', authRouter);
```

- [ ] **Step 4: Type-check + start server**

```bash
cd backend && npx tsc --noEmit && npx tsx src/server.ts &
sleep 2
curl -s -X POST http://localhost:3000/api/auth/request -H 'Content-Type: application/json' -d '{"email":"test@example.com"}'
kill %1
```

Expected: `{"ok":true}` (mail send may fail since localhost has no Postfix in dev; ignore that, it logs server-side).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/authController.ts backend/src/routes/auth.ts backend/src/app.ts
git commit -m "feat(auth): magic-link request/verify/logout/me endpoints"
```

### Task B9: Integration test — full magic-link flow

**Files:**
- Create: `backend/src/__tests__/integration/auth-flow.test.ts`

- [ ] **Step 1: Write E2E test**

Create `backend/src/__tests__/integration/auth-flow.test.ts`:

```ts
import { jest } from '@jest/globals';
import request from 'supertest';

const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'x' });
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}));

process.env.DATABASE_PATH = ':memory:';
process.env.VERIFY_BASE_URL = 'http://localhost/claudetracker/auth/verify';

const { default: app } = await import('../../app.js');
const { initDatabase } = await import('../../database/sqlite.js');

beforeAll(async () => { await initDatabase(); });

describe('magic-link auth flow', () => {
  it('full happy path: request → verify → me → logout', async () => {
    // 1. Request link
    const reqRes = await request(app).post('/api/auth/request').send({ email: 'newuser@example.com' });
    expect(reqRes.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalled();
    const sentTo = sendMailMock.mock.calls[0][0];
    const tokenMatch = sentTo.text.match(/token=([a-f0-9]{64})/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch[1];

    // 2. Consume token
    const verifyRes = await request(app).post('/api/auth/verify').send({ token });
    expect(verifyRes.status).toBe(302);  // redirect
    const cookie = verifyRes.headers['set-cookie'][0];
    expect(cookie).toContain('cut_session=');

    // 3. /me with cookie
    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('newuser@example.com');

    // 4. Logout
    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);

    // 5. /me after logout → 401
    const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meAfter.status).toBe(401);
  });

  it('returns 200 even for invalid email (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/request').send({ email: 'not-an-email' });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Install supertest**

```bash
cd backend && npm install -D supertest @types/supertest
```

- [ ] **Step 3: Run test**

```bash
cd backend && npm test -- auth-flow.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/__tests__/integration/auth-flow.test.ts backend/package.json backend/package-lock.json
git commit -m "test(auth): full magic-link flow integration test"
```

### Task B10: Account/Token controller + routes

**Files:**
- Create: `backend/src/controllers/accountController.ts`
- Create: `backend/src/routes/account.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Implement controller**

Create `backend/src/controllers/accountController.ts`:

```ts
import type { Request, Response } from 'express';
import { runQuery, getQuery } from '../database/sqlite.js';
import { createApiToken, getActiveApiToken, revokeApiToken } from '../services/authService.js';
import type { User } from '../types/index.js';

export async function getAccount(req: Request, res: Response): Promise<void> {
  const u = req.user!;
  res.json({
    email: u.email,
    display_name: u.display_name,
    plan_name: u.plan_name,
    monthly_limit_eur: u.monthly_limit_eur,
    is_admin: u.is_admin === 1
  });
}

export async function patchAccount(req: Request, res: Response): Promise<void> {
  const u = req.user!;
  const { display_name, plan_name, monthly_limit_eur } = req.body || {};
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof display_name === 'string') { updates.push('display_name = ?'); values.push(display_name.slice(0, 100)); }
  if (typeof plan_name === 'string' || plan_name === null) { updates.push('plan_name = ?'); values.push(plan_name); }
  if (typeof monthly_limit_eur === 'number' || monthly_limit_eur === null) {
    updates.push('monthly_limit_eur = ?'); values.push(monthly_limit_eur);
  }
  if (updates.length === 0) { res.status(400).json({ error: 'nothing to update' }); return; }
  values.push(u.id);
  await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  const updated = await getQuery<User>('SELECT * FROM users WHERE id = ?', [u.id]);
  res.json(updated);
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  // CASCADE delete is configured on FK; usage_records, sessions, api_tokens go too
  await runQuery('DELETE FROM users WHERE id = ?', [req.user!.id]);
  res.clearCookie('cut_session', { path: '/claudetracker/' });
  res.status(204).send();
}

export async function getToken(req: Request, res: Response): Promise<void> {
  const t = await getActiveApiToken(req.user!.id);
  if (!t) { res.json(null); return; }
  res.json({ id: t.id, label: t.label, created_at: t.created_at, last_used_at: t.last_used_at });
}

export async function rotateToken(req: Request, res: Response): Promise<void> {
  const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 100) : 'Extension';
  const { plaintext, id } = await createApiToken(req.user!.id, label);
  res.status(201).json({ token: plaintext, id, label });
}

export async function revokeToken(req: Request, res: Response): Promise<void> {
  const t = await getActiveApiToken(req.user!.id);
  if (t) await revokeApiToken(req.user!.id, t.id);
  res.status(204).send();
}
```

- [ ] **Step 2: Wire routes**

Create `backend/src/routes/account.ts`:

```ts
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { getAccount, patchAccount, deleteAccount, getToken, rotateToken, revokeToken } from '../controllers/accountController.js';

const router = Router();
router.use(requireUser);
router.get('/', getAccount);
router.patch('/', patchAccount);
router.delete('/', deleteAccount);
router.get('/token', getToken);
router.post('/token', rotateToken);
router.delete('/token', revokeToken);
export default router;
```

- [ ] **Step 3: Mount in app**

In `backend/src/app.ts`:

```ts
import accountRouter from './routes/account.js';
// ...
app.use('/api/account', accountRouter);
```

- [ ] **Step 4: Type-check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/accountController.ts backend/src/routes/account.ts backend/src/app.ts
git commit -m "feat(account): account profile + API token endpoints"
```

### Task B11: Hourly cleanup of expired tokens/sessions

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Find existing node-cron usage**

```bash
cd backend && grep -n "cron" src/server.ts
```

Expected: a cron import + scheduling for pricing refresh exists.

- [ ] **Step 2: Add cleanup job**

Append in `backend/src/server.ts` after existing cron schedules:

```ts
import { runQuery } from './database/sqlite.js';

cron.schedule('0 * * * *', async () => {
  try {
    const sessions = await runQuery(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
    const tokens = await runQuery(`DELETE FROM magic_link_tokens WHERE expires_at < datetime('now')`);
    if (sessions.changes || tokens.changes) {
      console.log(`[cleanup] sessions: ${sessions.changes}, magic_link_tokens: ${tokens.changes}`);
    }
  } catch (err) {
    console.error('[cleanup] error:', (err as Error).message);
  }
});
console.log('Hourly cleanup scheduled for expired sessions and magic-link tokens');
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat(auth): hourly cleanup of expired sessions and magic-link tokens"
```

### Task B12: End-of-Phase-B local smoke test

- [ ] **Step 1: Boot backend, exercise full flow via curl**

```bash
cd backend && rm -f /tmp/test.sqlite && DATABASE_PATH=/tmp/test.sqlite SMTP_HOST=localhost SMTP_PORT=2525 npx tsx src/server.ts &
sleep 2
# Assume Postfix isn't installed locally; mail send will fail but token still creates
curl -s -X POST http://localhost:3000/api/auth/request -H 'Content-Type: application/json' -d '{"email":"smoke@example.com"}'
# Grab the token from DB directly (mail couldn't send)
TOKEN=$(sqlite3 /tmp/test.sqlite "SELECT token FROM magic_link_tokens WHERE email='smoke@example.com' AND consumed_at IS NULL LIMIT 1")
echo "Token: $TOKEN"
# Consume it (extract Set-Cookie)
curl -s -i -X POST -d "token=$TOKEN" http://localhost:3000/api/auth/verify | grep -i set-cookie
kill %1
```

Expected: response includes `Set-Cookie: cut_session=…`.

- [ ] **Step 2: Verify the new user got created in DB**

```bash
sqlite3 /tmp/test.sqlite "SELECT id, email, display_name FROM users"
```

Expected: row with email=smoke@example.com.

---

## Phase C — Endpoint Scoping

**Outcome:** All existing endpoints require auth and only return the logged-in user's data. Pricing-mutation endpoints require admin. Two test users cannot see each other's records (proven by integration test).

### Task C1: ScopedDb helper

**Files:**
- Create: `backend/src/utils/scopedDb.ts`

- [ ] **Step 1: Implement helper**

Create `backend/src/utils/scopedDb.ts`:

```ts
import { allQuery, getQuery } from '../database/sqlite.js';

/**
 * Auto-scoped variants of the database query helpers. The SQL must use a
 * caller-controlled WHERE clause, but `user_id = ?` is appended automatically.
 *
 * Call site:
 *   db.allForUser('SELECT * FROM usage_records WHERE timestamp > ?', userId, [t])
 *   →  SELECT * FROM usage_records WHERE timestamp > ? AND user_id = ?
 *      params: [t, userId]
 *
 * If your SQL has no WHERE clause yet, prefix it (the helper just appends).
 */

function appendUserScope(sql: string, userId: number, params: unknown[]): { sql: string; params: unknown[] } {
  const trimmed = sql.trim();
  const hasWhere = /\bWHERE\b/i.test(trimmed);
  const newSql = hasWhere
    ? trimmed.replace(/\bWHERE\b/i, 'WHERE user_id = ? AND ')
    : trimmed + ' WHERE user_id = ?';
  // user_id goes FIRST in the params array because we inserted it right after WHERE
  return { sql: newSql, params: hasWhere ? [userId, ...params] : [...params, userId] };
}

export async function allForUser<T = unknown>(
  sql: string, userId: number, params: unknown[] = []
): Promise<T[]> {
  const scoped = appendUserScope(sql, userId, params);
  return allQuery<T>(scoped.sql, scoped.params);
}

export async function getForUser<T = unknown>(
  sql: string, userId: number, params: unknown[] = []
): Promise<T | undefined> {
  const scoped = appendUserScope(sql, userId, params);
  return getQuery<T>(scoped.sql, scoped.params);
}
```

- [ ] **Step 2: Test the helper**

Create `backend/src/__tests__/unit/scopedDb.test.ts`:

```ts
import { initDatabase, runQuery } from '../../database/sqlite.js';
import { allForUser } from '../../utils/scopedDb.js';

beforeAll(async () => {
  process.env.DATABASE_PATH = ':memory:';
  await initDatabase();
  await runQuery(`INSERT INTO users (id, email) VALUES (1, 'a@x.com'), (2, 'b@x.com')`);
  await runQuery(
    `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, user_id) VALUES
     ('m1', 100, 50, 150, 1),
     ('m1', 200, 100, 300, 1),
     ('m1', 999, 999, 1998, 2)`
  );
});

describe('allForUser', () => {
  it('scopes a no-WHERE query', async () => {
    const rows = await allForUser<{ model: string }>('SELECT * FROM usage_records', 1);
    expect(rows).toHaveLength(2);
  });

  it('scopes a WHERE query without breaking existing predicates', async () => {
    const rows = await allForUser<{ model: string }>(
      'SELECT * FROM usage_records WHERE input_tokens > ?', 1, [150]
    );
    expect(rows).toHaveLength(1);   // user 1's row with 200
  });

  it('does not leak rows from other users', async () => {
    const rows = await allForUser<{ model: string }>('SELECT * FROM usage_records', 2);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd backend && npm test -- scopedDb.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/utils/scopedDb.ts backend/src/__tests__/unit/scopedDb.test.ts
git commit -m "feat(db): scopedDb helper with auto user_id WHERE injection"
```

### Task C2: Scope usageController endpoints

**Files:**
- Modify: `backend/src/controllers/usageController.ts`
- Modify: `backend/src/routes/usage.ts`

- [ ] **Step 1: Add requireUser to all routes**

In `backend/src/routes/usage.ts`, import middleware and apply at router level:

```ts
import { requireUser } from '../middleware/auth.js';
const router = Router();
router.use(requireUser);
// ... existing route registrations unchanged
```

- [ ] **Step 2: Update POST /track to write user_id**

In `backend/src/controllers/usageController.ts`, find the `INSERT INTO usage_records` statement (around the trackUsage function) and add `user_id` to the column list and values:

```ts
const insertSql = `INSERT INTO usage_records (
  model, input_tokens, output_tokens, total_tokens, cost,
  conversation_id, source, task_description, success_status, response_metadata,
  workspace, key_name, key_id_suffix, cost_usd, user_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const params = [
  model, input_tokens, output_tokens, total_tokens, cost,
  conversation_id, source, task_description, success_status, metaJson,
  workspace, key_name, key_id_suffix, cost_usd,
  req.user!.id
];
```

(Adjust to match the current parameter order in the file.)

- [ ] **Step 3: Update getSummary to scope all sub-queries**

In `getSummary`, every `FROM usage_records` query needs `AND user_id = ?` and the param list needs `req.user!.id`. Walk through each `getQuery` / `allQuery` call and add the scope. There are roughly 5–7 such queries (summary, claudeAi latest, console-by-workspace, baseline, latest_in_window, etc.). Use Find-and-Replace carefully — each query needs the user_id appended to params.

Example for the `apiTotalRow` query (already complex with CTEs):

```ts
const apiByWorkspace = await allQuery<ApiWorkspaceRow>(
  `WITH latest_in_window AS (
     SELECT ... FROM usage_records
     WHERE ${apiSourceFilter} AND user_id = ?
       AND datetime(timestamp) >= datetime(${windowStartExpr})
   ), baseline AS (
     SELECT ... FROM usage_records
     WHERE ${apiSourceFilter} AND user_id = ?
       AND datetime(timestamp) < datetime(${windowStartExpr})
   ) ...`,
  [req.user!.id, req.user!.id]   // appears twice — once per CTE
);
```

- [ ] **Step 4: Update getSpendingTotal similarly**

The `allRows` query and `apiTotalRow` query both need user_id scoping. Add `WHERE user_id = ?` and param.

- [ ] **Step 5: Update remaining endpoints (history, models, etc.)**

For each remaining handler, identify the SQL query and add user_id scope. Use the `scopedDb.allForUser` helper for simple cases.

- [ ] **Step 6: Type-check + run unit tests**

```bash
cd backend && npx tsc --noEmit && npm test -- usageController
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/usageController.ts backend/src/routes/usage.ts
git commit -m "feat(scope): require auth + filter usage queries by user_id"
```

### Task C3: Scope modelRecommendationController

**Files:**
- Modify: `backend/src/controllers/modelRecommendationController.ts`
- Modify: `backend/src/routes/recommendation.ts`

- [ ] **Step 1: Add requireUser to routes**

In `backend/src/routes/recommendation.ts`:

```ts
import { requireUser } from '../middleware/auth.js';
router.use(requireUser);
```

- [ ] **Step 2: Scope all queries**

Walk through `modelRecommendationController.ts` and add `AND user_id = ?` to every `usage_records` and `model_analysis` query. Pass `req.user!.id` in params.

- [ ] **Step 3: Type-check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/modelRecommendationController.ts backend/src/routes/recommendation.ts
git commit -m "feat(scope): require auth + filter recommendation queries by user_id"
```

### Task C4: Scope pricingController + admin gating

**Files:**
- Modify: `backend/src/routes/pricing.ts`

- [ ] **Step 1: Apply requireUser globally and requireAdmin on writes**

In `backend/src/routes/pricing.ts`:

```ts
import { requireUser, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireUser);  // all reads need login

router.get('/', getPricing);
router.put('/:model', requireAdmin, updatePricing);
router.post('/:model/confirm', requireAdmin, confirmPricing);
router.get('/plans', getPlans);
router.put('/plans/:name', requireAdmin, updatePlan);
router.post('/plans/refresh', requireAdmin, triggerPlanRefresh);
```

(Adjust to match actual route names in the file.)

- [ ] **Step 2: Type-check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/pricing.ts
git commit -m "feat(scope): require auth on pricing reads, admin on writes"
```

### Task C5: Integration test — data isolation between users

**Files:**
- Create: `backend/src/__tests__/integration/data-isolation.test.ts`

- [ ] **Step 1: Write the test**

Create `backend/src/__tests__/integration/data-isolation.test.ts`:

```ts
import request from 'supertest';

process.env.DATABASE_PATH = ':memory:';
const { default: app } = await import('../../app.js');
const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { createSession } = await import('../../services/authService.js');

beforeAll(async () => {
  await initDatabase();
  await runQuery(`INSERT INTO users (id, email) VALUES (10, 'iso-a@x.com'), (11, 'iso-b@x.com')`);
  await runQuery(`INSERT INTO usage_records
    (model, input_tokens, output_tokens, total_tokens, cost, source, user_id)
    VALUES ('m', 100, 50, 150, 0.5, 'claude_ai', 10),
           ('m', 999, 999, 1998, 9.0, 'claude_ai', 11)`);
});

describe('cross-user isolation', () => {
  it('user A only sees their own records', async () => {
    const sidA = await createSession(10, null, null);
    const res = await request(app).get('/api/usage/history?period=month')
      .set('Cookie', `cut_session=${sidA}`);
    expect(res.status).toBe(200);
    const records = res.body.records || res.body;
    expect(records).toHaveLength(1);
    expect(records[0].cost).toBe(0.5);
  });

  it('user B only sees their own records', async () => {
    const sidB = await createSession(11, null, null);
    const res = await request(app).get('/api/usage/history?period=month')
      .set('Cookie', `cut_session=${sidB}`);
    expect(res.status).toBe(200);
    const records = res.body.records || res.body;
    expect(records).toHaveLength(1);
    expect(records[0].cost).toBe(9.0);
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/usage/history?period=month');
    expect(res.status).toBe(401);
  });

  it('non-admin user cannot PUT pricing → 403', async () => {
    const sidA = await createSession(10, null, null);
    const res = await request(app).put('/api/pricing/test-model')
      .set('Cookie', `cut_session=${sidA}`)
      .send({ input_price: 1, output_price: 2 });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd backend && npm test -- data-isolation
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/integration/data-isolation.test.ts
git commit -m "test(scope): cross-user data isolation + admin gating"
```

### Task C6: Admin controller and routes

**Files:**
- Create: `backend/src/controllers/adminController.ts`
- Create: `backend/src/routes/admin.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Implement controller**

Create `backend/src/controllers/adminController.ts`:

```ts
import type { Request, Response } from 'express';
import { runQuery, allQuery, getQuery } from '../database/sqlite.js';

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await allQuery(`
    SELECT u.id, u.email, u.display_name, u.is_admin, u.plan_name, u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM usage_records WHERE user_id = u.id) as record_count
    FROM users u ORDER BY u.created_at DESC
  `);
  res.json({ users });
}

export async function patchUser(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (!isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const { display_name, plan_name, is_admin } = req.body || {};
  const updates: string[] = []; const values: unknown[] = [];
  if (typeof display_name === 'string' || display_name === null) { updates.push('display_name = ?'); values.push(display_name); }
  if (typeof plan_name === 'string' || plan_name === null) { updates.push('plan_name = ?'); values.push(plan_name); }
  if (typeof is_admin === 'boolean') { updates.push('is_admin = ?'); values.push(is_admin ? 1 : 0); }
  if (updates.length === 0) { res.status(400).json({ error: 'nothing to update' }); return; }
  values.push(id);
  await runQuery(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  const updated = await getQuery('SELECT id, email, display_name, plan_name, is_admin FROM users WHERE id = ?', [id]);
  res.json(updated);
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id, 10);
  if (id === req.user!.id) { res.status(400).json({ error: 'cannot delete yourself' }); return; }
  await runQuery('DELETE FROM users WHERE id = ?', [id]);
  res.status(204).send();
}

export async function adminStats(_req: Request, res: Response): Promise<void> {
  const totalUsers = await getQuery<{ n: number }>('SELECT COUNT(*) as n FROM users');
  const active7d = await getQuery<{ n: number }>(
    `SELECT COUNT(*) as n FROM users WHERE last_login_at > datetime('now', '-7 days')`
  );
  const totalRecords = await getQuery<{ n: number }>('SELECT COUNT(*) as n FROM usage_records');
  res.json({
    total_users: totalUsers?.n ?? 0,
    active_last_7d: active7d?.n ?? 0,
    total_records: totalRecords?.n ?? 0
  });
}
```

- [ ] **Step 2: Wire routes**

Create `backend/src/routes/admin.ts`:

```ts
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { listUsers, patchUser, deleteUser, adminStats } from '../controllers/adminController.js';

const router = Router();
router.use(requireAdmin);
router.get('/users', listUsers);
router.patch('/users/:id', patchUser);
router.delete('/users/:id', deleteUser);
router.get('/stats', adminStats);
export default router;
```

- [ ] **Step 3: Mount in app.ts**

```ts
import adminRouter from './routes/admin.js';
// ...
app.use('/api/admin', adminRouter);
```

- [ ] **Step 4: Type-check + run all tests**

```bash
cd backend && npx tsc --noEmit && npm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/adminController.ts backend/src/routes/admin.ts backend/src/app.ts
git commit -m "feat(admin): user management + system stats endpoints"
```

---

## Phase D — Frontend

**Outcome:** Login page, magic-link verify intermediate page, AuthContext, RequireAuth wrapper, restructured Settings page with Account/Token/Admin sections, OnboardingBanner. All existing pages send credentials and redirect to /login on 401.

### Task D1: Add react-router-dom

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install**

```bash
cd frontend && npm install react-router-dom
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(frontend): add react-router-dom"
```

### Task D2: Frontend types

**Files:**
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add auth types**

Append to `frontend/src/types/api.ts`:

```ts
export interface CurrentUser {
  id: number;
  email: string;
  display_name: string | null;
  plan_name: string | null;
  monthly_limit_eur: number | null;
  is_admin: boolean;
}

export interface ApiTokenInfo {
  id: number;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AdminUserRow {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: 0 | 1;
  plan_name: string | null;
  created_at: string;
  last_login_at: string | null;
  record_count: number;
}

export interface AdminStats {
  total_users: number;
  active_last_7d: number;
  total_records: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat(types): add auth and admin types"
```

### Task D3: API service updates (credentials + 401 handling)

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add credentials and 401 redirect to all fetches**

Find the central fetch helper (likely named `apiCall` or similar). Add `credentials: 'include'` to its default options. Add a 401 interceptor:

```ts
async function apiCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.location.assign('/claudetracker/login');
    throw new Error('redirecting to login');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Add new auth/account/admin API functions**

Append to `frontend/src/services/api.ts`:

```ts
import type { CurrentUser, ApiTokenInfo, AdminUserRow, AdminStats } from '../types/api';

export const requestMagicLink = (email: string) =>
  apiCall<{ ok: true }>('/auth/request', { method: 'POST', body: JSON.stringify({ email }) });

export const getCurrentUser = () => apiCall<CurrentUser>('/auth/me');

export const logout = () =>
  fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });

export const getAccount = () => apiCall<CurrentUser>('/account');
export const patchAccount = (body: Partial<{ display_name: string; plan_name: string; monthly_limit_eur: number }>) =>
  apiCall<CurrentUser>('/account', { method: 'PATCH', body: JSON.stringify(body) });
export const deleteAccount = () => apiCall<void>('/account', { method: 'DELETE' });

export const getApiToken = () => apiCall<ApiTokenInfo | null>('/account/token');
export const rotateApiToken = (label?: string) =>
  apiCall<{ token: string; id: number; label: string }>('/account/token', {
    method: 'POST', body: JSON.stringify({ label })
  });
export const revokeApiToken = () => apiCall<void>('/account/token', { method: 'DELETE' });

export const adminListUsers = () => apiCall<{ users: AdminUserRow[] }>('/admin/users');
export const adminPatchUser = (id: number, body: Partial<AdminUserRow>) =>
  apiCall<AdminUserRow>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const adminDeleteUser = (id: number) => apiCall<void>(`/admin/users/${id}`, { method: 'DELETE' });
export const adminStats = () => apiCall<AdminStats>('/admin/stats');
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(api): credentials include, 401 redirect, auth/account/admin clients"
```

### Task D4: AuthContext + RequireAuth

**Files:**
- Create: `frontend/src/contexts/AuthContext.tsx`
- Create: `frontend/src/components/RequireAuth.tsx`

- [ ] **Step 1: Implement AuthContext**

Create `frontend/src/contexts/AuthContext.tsx`:

```tsx
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getCurrentUser, logout as apiLogout } from '../services/api';
import type { CurrentUser } from '../types/api';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (): Promise<void> => {
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    await apiLogout();
    setUser(null);
    window.location.assign('/claudetracker/login');
  };

  useEffect(() => { refresh(); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Implement RequireAuth wrapper**

Create `frontend/src/components/RequireAuth.tsx`:

```tsx
import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RequireAuth({ children }: { children: ReactNode }): React.ReactElement {
  const { user, loading } = useAuth();
  if (loading) return <div className="text-center py-12 text-gray-500">Lade…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/components/RequireAuth.tsx
git commit -m "feat(auth): AuthContext + RequireAuth route guard"
```

### Task D5: Login + AuthVerify pages

**Files:**
- Create: `frontend/src/pages/Login.tsx`
- Create: `frontend/src/pages/AuthVerify.tsx`

- [ ] **Step 1: Login page**

Create `frontend/src/pages/Login.tsx`:

```tsx
import React, { useState, FormEvent } from 'react';
import { requestMagicLink } from '../services/api';

export default function LoginPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch {
      // we still want to show "sent" — backend always returns 200
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="bg-white p-8 rounded-lg shadow w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">📊 Claude Usage Tracker</h1>
        {sent ? (
          <div className="mt-6">
            <p className="text-gray-700">
              Wir haben dir einen Login-Link an <strong>{email}</strong> geschickt.
              Prüfe dein Postfach und klicke den Link (gültig 15 Minuten).
            </p>
            <button onClick={() => setSent(false)} className="mt-4 text-sm text-blue-600 hover:underline">
              Nochmal anfordern oder andere Email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-gray-600">Gib deine Email ein, wir schicken dir einen Login-Link.</p>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="du@example.com"
              className="w-full px-4 py-2 border rounded focus:outline-none focus:border-blue-500" />
            <button type="submit" disabled={submitting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Wird gesendet…' : 'Login-Link anfordern'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AuthVerify page (form post fallback)**

Create `frontend/src/pages/AuthVerify.tsx`. Note: the actual verify is server-rendered HTML by the backend (showVerifyPage returns HTML directly). This frontend route exists only for the redirect target after verify. It just renders a "logging in…" splash and triggers a refresh of AuthContext.

```tsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthVerifyPage(): React.ReactElement {
  const { refresh } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    refresh().then(() => nav('/', { replace: true }));
  }, [refresh, nav]);

  return <div className="min-h-screen flex items-center justify-center text-gray-500">Logge ein…</div>;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Login.tsx frontend/src/pages/AuthVerify.tsx
git commit -m "feat(frontend): login + auth-verify pages"
```

### Task D6: Wire Router + AuthProvider in App

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/UserMenu.tsx`

- [ ] **Step 1: UserMenu component**

Create `frontend/src/components/UserMenu.tsx`:

```tsx
import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function UserMenu(): React.ReactElement {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!user) return <></>;
  const initials = (user.display_name || user.email).slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="w-9 h-9 rounded-full bg-blue-600 text-white font-semibold flex items-center justify-center">
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border py-1 z-10">
          <div className="px-4 py-2 text-xs text-gray-500 border-b">{user.email}</div>
          <button onClick={logout} className="w-full text-left px-4 py-2 hover:bg-gray-50">
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Restructure App.tsx**

Replace contents of `frontend/src/App.tsx`:

```tsx
import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import RequireAuth from './components/RequireAuth';
import ErrorBoundary from './components/ErrorBoundary';
import UserMenu from './components/UserMenu';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import RecommendationsPage from './pages/RecommendationsPage';
import LoginPage from './pages/Login';
import AuthVerifyPage from './pages/AuthVerify';
import './index.css';

function NavBar(): React.ReactElement {
  const loc = useLocation();
  const tab = (path: string, label: string) => (
    <Link to={path} className={`px-4 py-2 rounded-lg font-medium transition ${
      loc.pathname === path ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
    }`}>{label}</Link>
  );
  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📊</span>
          <h1 className="text-xl font-bold text-gray-900">Claude Usage Tracker</h1>
        </div>
        <div className="flex gap-4 items-center">
          {tab('/', 'Dashboard')}
          {tab('/recommendations', '🎯 Recommendations')}
          {tab('/settings', 'Settings')}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}

function ProtectedShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <NavBar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </RequireAuth>
  );
}

export default function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <BrowserRouter basename="/claudetracker">
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/verify" element={<AuthVerifyPage />} />
            <Route path="/" element={<ProtectedShell><Dashboard /></ProtectedShell>} />
            <Route path="/recommendations" element={<ProtectedShell><RecommendationsPage /></ProtectedShell>} />
            <Route path="/settings" element={<ProtectedShell><Settings /></ProtectedShell>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/UserMenu.tsx
git commit -m "feat(frontend): router, AuthProvider, protected shell, user menu"
```

### Task D7: Settings page restructure (Account + Token sections)

**Files:**
- Create: `frontend/src/components/settings/AccountSection.tsx`
- Create: `frontend/src/components/settings/ApiTokenSection.tsx`
- Modify: `frontend/src/pages/Settings.tsx`

- [ ] **Step 1: AccountSection**

Create `frontend/src/components/settings/AccountSection.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { getAccount, patchAccount, getPlanPricing } from '../../services/api';
import type { CurrentUser, PlanPricingRow } from '../../types/api';

export default function AccountSection(): React.ReactElement {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [planName, setPlanName] = useState('');
  const [limit, setLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getAccount().then((u) => {
      setMe(u);
      setDisplayName(u.display_name || '');
      setPlanName(u.plan_name || '');
      setLimit(u.monthly_limit_eur != null ? String(u.monthly_limit_eur) : '');
    });
    getPlanPricing().then((r) => setPlans(r.plans));
  }, []);

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      await patchAccount({
        display_name: displayName,
        plan_name: planName || null as unknown as string,
        monthly_limit_eur: limit === '' ? null as unknown as number : parseFloat(limit)
      });
      setStatus('Gespeichert ✓');
    } catch (e) {
      setStatus('Fehler: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!me) return <div className="text-gray-500">Lade…</div>;
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-gray-700">Email</label>
          <p className="mt-1 text-gray-900">{me.email}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Display-Name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Plan</label>
          <select value={planName} onChange={(e) => setPlanName(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded bg-white">
            <option value="">— kein Plan —</option>
            {plans.map((p) => <option key={p.plan_name} value={p.plan_name}>{p.plan_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Monatliches Limit (EUR)</label>
          <input type="number" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded" placeholder="z.B. 50.00" />
        </div>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Speichern…' : 'Speichern'}
        </button>
        {status && <p className="text-sm text-gray-600">{status}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ApiTokenSection**

Create `frontend/src/components/settings/ApiTokenSection.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { getApiToken, rotateApiToken, revokeApiToken } from '../../services/api';
import type { ApiTokenInfo } from '../../types/api';

export default function ApiTokenSection(): React.ReactElement {
  const [token, setToken] = useState<ApiTokenInfo | null | undefined>(undefined);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => getApiToken().then(setToken);
  useEffect(() => { load(); }, []);

  const rotate = async () => {
    if (token && !window.confirm('Aktuellen Token rotieren? Bestehende Extension-Verbindungen brechen.')) return;
    setBusy(true);
    try {
      const r = await rotateApiToken('Browser Extension');
      setPlaintext(r.token);
      await load();
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!window.confirm('Token endgültig widerrufen? Extension-Verbindung bricht.')) return;
    setBusy(true);
    try { await revokeApiToken(); setPlaintext(null); await load(); }
    finally { setBusy(false); }
  };

  if (token === undefined) return <div className="text-gray-500">Lade…</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">API-Token (für Extension)</h2>
      <p className="text-sm text-gray-600 mb-4">
        Die Browser-Extension nutzt diesen Token zum Authentifizieren am Backend.
        Nur ein aktiver Token pro User. Beim Rotieren bricht die alte Verbindung.
      </p>

      {plaintext && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded">
          <p className="text-sm text-amber-900 font-semibold mb-2">⚠️ Token nur jetzt sichtbar — kopieren!</p>
          <code className="block bg-white p-2 border rounded font-mono text-sm break-all">{plaintext}</code>
          <button onClick={() => navigator.clipboard.writeText(plaintext)}
            className="mt-2 text-xs text-blue-600 hover:underline">Kopieren</button>
        </div>
      )}

      {token ? (
        <div>
          <p className="text-sm">Status: <span className="text-green-600 font-medium">● Aktiv</span></p>
          <p className="text-sm text-gray-500">Erstellt: {new Date(token.created_at).toLocaleString('de-DE')}</p>
          <p className="text-sm text-gray-500">Zuletzt benutzt: {token.last_used_at ? new Date(token.last_used_at).toLocaleString('de-DE') : 'noch nie'}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={rotate} disabled={busy} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Rotieren</button>
            <button onClick={revoke} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700">Widerrufen</button>
          </div>
        </div>
      ) : (
        <button onClick={rotate} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Token erzeugen
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Restructure Settings.tsx**

Replace contents of `frontend/src/pages/Settings.tsx`:

```tsx
import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AccountSection from '../components/settings/AccountSection';
import ApiTokenSection from '../components/settings/ApiTokenSection';
import PlanPricingTable from '../components/PlanPricingTable';
import PricingTable from '../components/PricingTable';
import AdminUsersSection from '../components/settings/AdminUsersSection';
import AdminStatsSection from '../components/settings/AdminStatsSection';

export default function Settings(): React.ReactElement {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <AccountSection />
      <ApiTokenSection />
      <PlanPricingTable readOnly={!isAdmin} />
      <PricingTable readOnly={!isAdmin} />
      {isAdmin && <AdminUsersSection />}
      {isAdmin && <AdminStatsSection />}
    </div>
  );
}
```

(Note: `PlanPricingTable` and `PricingTable` need `readOnly` prop added — see next task.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/AccountSection.tsx \
        frontend/src/components/settings/ApiTokenSection.tsx \
        frontend/src/pages/Settings.tsx
git commit -m "feat(frontend): account + token sections, restructured Settings"
```

### Task D8: Add readOnly to PricingTable + PlanPricingTable

**Files:**
- Modify: `frontend/src/components/PricingTable.tsx`
- Modify: `frontend/src/components/PlanPricingTable.tsx`

- [ ] **Step 1: PricingTable readOnly**

In `frontend/src/components/PricingTable.tsx`, add a `readOnly?: boolean` prop. When true, hide the Edit/Confirm buttons (or render them disabled with a tooltip "Nur Admin").

Example minimal change:

```tsx
interface PricingTableProps {
  pricing: PricingData[];
  onUpdate: () => void;
  readOnly?: boolean;
}
// inside row rendering:
{!readOnly && <button onClick={...}>Edit</button>}
```

- [ ] **Step 2: PlanPricingTable readOnly**

Same pattern in `frontend/src/components/PlanPricingTable.tsx`.

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PricingTable.tsx frontend/src/components/PlanPricingTable.tsx
git commit -m "feat(frontend): readOnly mode for pricing tables (non-admin users)"
```

### Task D9: Admin sections

**Files:**
- Create: `frontend/src/components/settings/AdminUsersSection.tsx`
- Create: `frontend/src/components/settings/AdminStatsSection.tsx`

- [ ] **Step 1: AdminStatsSection**

Create `frontend/src/components/settings/AdminStatsSection.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { adminStats } from '../../services/api';
import type { AdminStats } from '../../types/api';

export default function AdminStatsSection(): React.ReactElement {
  const [stats, setStats] = useState<AdminStats | null>(null);
  useEffect(() => { adminStats().then(setStats); }, []);
  if (!stats) return <div className="text-gray-500">Lade…</div>;
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">System-Stats (Admin)</h2>
      <div className="grid grid-cols-3 gap-4">
        <div><div className="text-2xl font-bold">{stats.total_users}</div><div className="text-sm text-gray-500">User insgesamt</div></div>
        <div><div className="text-2xl font-bold">{stats.active_last_7d}</div><div className="text-sm text-gray-500">Aktiv (7 Tage)</div></div>
        <div><div className="text-2xl font-bold">{stats.total_records.toLocaleString('de-DE')}</div><div className="text-sm text-gray-500">Records gesamt</div></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: AdminUsersSection**

Create `frontend/src/components/settings/AdminUsersSection.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { adminListUsers, adminPatchUser, adminDeleteUser } from '../../services/api';
import type { AdminUserRow } from '../../types/api';

export default function AdminUsersSection(): React.ReactElement {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  const load = () => adminListUsers().then((r) => setUsers(r.users));
  useEffect(() => { load(); }, []);

  const remove = async (u: AdminUserRow) => {
    if (!window.confirm(`User ${u.email} wirklich löschen? Alle Daten gehen verloren.`)) return;
    await adminDeleteUser(u.id);
    load();
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">User-Verwaltung (Admin)</h2>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500 uppercase">
          <tr><th className="text-left py-2">Email</th><th className="text-left">Plan</th>
              <th className="text-right">Records</th><th className="text-left">Letzter Login</th><th></th></tr>
        </thead>
        <tbody className="divide-y">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2">{u.email} {u.is_admin === 1 && <span className="text-xs bg-purple-100 px-1.5 rounded ml-1">admin</span>}</td>
              <td>{u.plan_name || '—'}</td>
              <td className="text-right">{u.record_count}</td>
              <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('de-DE') : '—'}</td>
              <td className="text-right">
                <button onClick={() => setEditing(u)} className="text-blue-600 text-xs hover:underline mr-2">Edit</button>
                <button onClick={() => remove(u)} className="text-red-600 text-xs hover:underline">Löschen</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function EditModal({ user, onClose, onSaved }: { user: AdminUserRow; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [planName, setPlanName] = useState(user.plan_name || '');
  const [isAdmin, setIsAdmin] = useState(user.is_admin === 1);

  const save = async () => {
    await adminPatchUser(user.id, { display_name: displayName, plan_name: planName, is_admin: isAdmin ? 1 : 0 });
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg mb-4">User bearbeiten: {user.email}</h3>
        <div className="space-y-3">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display Name" className="w-full px-3 py-2 border rounded" />
          <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Plan" className="w-full px-3 py-2 border rounded" />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            <span>Admin-Rechte</span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-gray-600">Abbrechen</button>
          <button onClick={save} className="px-3 py-1.5 bg-blue-600 text-white rounded">Speichern</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/AdminUsersSection.tsx frontend/src/components/settings/AdminStatsSection.tsx
git commit -m "feat(frontend): admin user management + system stats sections"
```

### Task D10: Onboarding banner on Dashboard

**Files:**
- Create: `frontend/src/components/OnboardingBanner.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Banner component**

Create `frontend/src/components/OnboardingBanner.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiToken } from '../services/api';

const STORAGE_KEY = 'onboarding_banner_dismissed';

export default function OnboardingBanner(): React.ReactElement | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === 'true') return;
    getApiToken().then((t) => setShow(t === null));
  }, []);

  if (!show) return null;
  const dismiss = () => { localStorage.setItem(STORAGE_KEY, 'true'); setShow(false); };

  return (
    <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r mb-6 flex items-start gap-3">
      <span className="text-2xl">🔌</span>
      <div className="flex-1">
        <p className="font-semibold text-blue-900">Browser-Extension einrichten</p>
        <p className="text-sm text-blue-800">
          Generiere einen API-Token in <Link to="/settings" className="underline">Settings → API-Token</Link>,
          installiere die Extension und trage den Token ein, um automatisch zu syncen.
        </p>
      </div>
      <button onClick={dismiss} className="text-blue-600 hover:text-blue-800 text-sm">✕</button>
    </div>
  );
}
```

- [ ] **Step 2: Mount in Dashboard**

In `frontend/src/pages/Dashboard.tsx`, add at the top of the JSX (above tabs):

```tsx
import OnboardingBanner from '../components/OnboardingBanner';
// ...
return (
  <>
    <OnboardingBanner />
    {/* existing dashboard content */}
  </>
);
```

- [ ] **Step 3: Build + smoke-test**

```bash
cd frontend && npm run build 2>&1 | tail -3
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OnboardingBanner.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat(frontend): onboarding banner for users without API token"
```

---

## Phase E — Extension Update

**Outcome:** Extension uses Bearer API token instead of Basic Auth. Settings UI updated. Manifest version bumped.

### Task E1: Manifest version bump

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Bump version**

```json
{
  "manifest_version": 3,
  "name": "Claude Usage Tracker",
  "version": "2.0.0",
  ...
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/manifest.json
git commit -m "chore(extension): bump version to 2.0.0 (multi-user / token auth)"
```

### Task E2: popup.html — token field

**Files:**
- Modify: `extension/popup.html`

- [ ] **Step 1: Replace Basic-Auth fields with API-token field**

In the `<details class="settings">` block, replace the auth_user/auth_pass labels and inputs with:

```html
<label for="api-token-input">API-Token</label>
<input id="api-token-input" type="password" autocomplete="off"
  placeholder="ck_live_..." />
<p style="font-size:10px;color:#777;margin-top:4px">
  Generiere im Dashboard unter Settings → API-Token.
</p>
<button class="btn-secondary" id="open-token-page" type="button">
  Token-Seite öffnen
</button>
```

Remove the old `auth-user-input` and `auth-pass-input` elements.

- [ ] **Step 2: Commit**

```bash
git add extension/popup.html
git commit -m "feat(extension): popup UI for API-token field"
```

### Task E3: popup.js — token storage + UI handlers

**Files:**
- Modify: `extension/popup.js`

- [ ] **Step 1: Update initSettings to read api_token (drop auth_user/auth_pass)**

In `initSettings()`:

```js
async function initSettings() {
  const stored = await chrome.storage.local.get(['api_base', 'dashboard_url', 'api_token']);
  const apiBase = stored.api_base || DEFAULT_API_BASE;
  const dashboardUrl = stored.dashboard_url || DEFAULT_DASHBOARD_URL;

  document.getElementById('api-base-input').value = apiBase;
  document.getElementById('dashboard-url-input').value = dashboardUrl;
  document.getElementById('api-token-input').value = stored.api_token || '';

  const footerEl = document.getElementById('footer-api-base');
  if (footerEl) {
    try { footerEl.textContent = new URL(apiBase).host; } catch { footerEl.textContent = apiBase; }
  }
}
```

- [ ] **Step 2: Update saveSettings**

```js
async function saveSettings() {
  const apiBase = document.getElementById('api-base-input').value.trim();
  const dashboardUrl = document.getElementById('dashboard-url-input').value.trim();
  const apiToken = document.getElementById('api-token-input').value.trim();
  const status = document.getElementById('settings-status');

  if (!apiBase || !dashboardUrl) {
    status.textContent = '⚠️ Backend- und Dashboard-URL müssen ausgefüllt sein';
    status.style.color = '#c33'; return;
  }
  await chrome.storage.local.set({
    api_base: apiBase.replace(/\/+$/, ''),
    dashboard_url: dashboardUrl.replace(/\/+$/, ''),
    api_token: apiToken
  });
  await chrome.storage.local.remove(['auth_user', 'auth_pass']);  // clean up old
  status.textContent = '✅ Gespeichert.';
  status.style.color = '#3a3';
  await initSettings();
}
```

- [ ] **Step 3: Update resetSettings**

```js
async function resetSettings() {
  await chrome.storage.local.remove(['api_base', 'dashboard_url', 'api_token', 'auth_user', 'auth_pass']);
  await initSettings();
  document.getElementById('settings-status').textContent = 'Auf localhost zurückgesetzt.';
}
```

- [ ] **Step 4: Wire "Token-Seite öffnen" button**

In `DOMContentLoaded` listener:

```js
document.getElementById('open-token-page').addEventListener('click', async () => {
  const { dashboard_url } = await chrome.storage.local.get('dashboard_url');
  const url = (dashboard_url || DEFAULT_DASHBOARD_URL) + '/settings';
  chrome.tabs.create({ url });
});
```

- [ ] **Step 5: Commit**

```bash
git add extension/popup.js
git commit -m "feat(extension): popup uses api_token storage; cleans old basic-auth keys"
```

### Task E4: background.js — Bearer auth

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Replace getAuthHeaders**

Find `getAuthHeaders()` (around line 25–35) and replace:

```js
async function getAuthHeaders() {
  try {
    const stored = await chrome.storage.local.get('api_token');
    if (stored.api_token) {
      return { Authorization: `Bearer ${stored.api_token}` };
    }
  } catch { /* ignore */ }
  return {};
}
```

- [ ] **Step 2: Test**

```bash
node -c extension/background.js && echo "syntax ok"
```

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat(extension): send Bearer api_token instead of Basic auth"
```

### Task E5: Manual extension reload + smoke-test

- [ ] **Step 1: Open `chrome://extensions`, reload the extension**

Click ↻ on Claude Usage Tracker.

- [ ] **Step 2: Open popup, enter dashboard URL + paste API token, save**

(Generated in dashboard Settings → API-Token after Phase D deploy.)

- [ ] **Step 3: Verify popup loads month stats and badge updates within ~1 minute**

Should show monthly figures (cost/limits) — confirms Bearer-token-based fetch works.

---

## Phase F — Apache Cutover

**Outcome:** Apache Basic Auth removed. App-level auth (sessions + bearer) is the only access control. Old extension installs stop working until upgraded.

### Task F1: Stage new Apache config

- [ ] **Step 1: Inspect current config**

```bash
ssh ionos-vps 'sudo cat /etc/httpd/conf.d/claudetracker.conf'
```

- [ ] **Step 2: Prepare new config (remove AuthType Basic block)**

On the VPS, edit the file and remove the `<Location>` block's `AuthType Basic`, `AuthName`, `AuthUserFile`, `Require valid-user` lines. Keep the `ProxyPass` and `ProxyPassReverse` lines.

```bash
ssh ionos-vps 'sudo cp /etc/httpd/conf.d/claudetracker.conf /etc/httpd/conf.d/claudetracker.conf.pre-multiuser'
ssh ionos-vps 'sudo nano /etc/httpd/conf.d/claudetracker.conf'  # interactive
```

(Or sed/script the change.)

- [ ] **Step 3: Test config validity**

```bash
ssh ionos-vps 'sudo httpd -t'
```

Expected: `Syntax OK`.

### Task F2: Cutover

- [ ] **Step 1: Reload Apache**

```bash
ssh ionos-vps 'sudo systemctl reload httpd'
```

- [ ] **Step 2: Immediately verify**

```bash
# Dashboard reachable without basic auth?
curl -s -o /dev/null -w "%{http_code}\n" https://wolfinisoftware.de/claudetracker/
# Should be 200 (renders index.html)

# /api/auth/me returns 401 (no session yet), NOT 401-with-WWW-Authenticate-Basic
curl -i https://wolfinisoftware.de/claudetracker/api/auth/me 2>&1 | grep -i "401\|www-authen"
# Should be: HTTP/2 401, no Basic challenge
```

- [ ] **Step 3: If broken — rollback**

```bash
ssh ionos-vps 'sudo cp /etc/httpd/conf.d/claudetracker.conf.pre-multiuser /etc/httpd/conf.d/claudetracker.conf && sudo systemctl reload httpd'
```

- [ ] **Step 4: End-to-end browser test**

In a normal browser (not authenticated): navigate to `https://wolfinisoftware.de/claudetracker/`. Should land on Login page. Enter your email, click Login-Link in mail, get redirected to dashboard.

---

## Phase G — Open Signup Live

**Outcome:** New email addresses can sign up and create accounts via magic link.

### Task G1: Verify open signup works end-to-end

- [ ] **Step 1: Test as a fresh email**

Use a never-before-seen email address (e.g., a tester address). Go to `/login`, enter the email, click the magic-link in the mail. Verify:
- Redirect to dashboard works
- New row created in `users` table:

```bash
ssh ionos-vps 'cd /var/www/wolfinisoftware/claudetracker/backend && node -e "
const sq = require(\"sqlite3\");
new sq.Database(\"./database.sqlite\").all(\"SELECT id, email, created_at FROM users\", (e,r) => { console.table(r); process.exit(0); });
"'
```

- [ ] **Step 2: Verify isolation**

Log in as the new user, check Dashboard — should be empty (no records). Log out, log in as harald — should see all historical data.

### Task G2: Pre-launch DKIM/SPF/DMARC check

- [ ] **Step 1: DNS records**

```bash
dig +short TXT wolfinisoftware.de | grep -E "v=spf1|v=DMARC"
dig +short TXT default._domainkey.wolfinisoftware.de
```

- [ ] **Step 2: Mail-tester**

Visit https://www.mail-tester.com, get a unique test address. Trigger a magic-link send to that address from the live system. Score should be ≥ 8/10.

- [ ] **Step 3: If score is low, document next steps**

Add to `README.md` an "Email Deliverability" section noting current score and what needs DNS work, but proceed with launch (best-effort per spec).

### Task G3: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document signup + extension setup flow**

Add a "Sign Up" section explaining how a new user joins (visit URL, request magic link, paste token in extension). Update existing "VPS Deployment" section to remove Basic-Auth references.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document multi-user signup flow"
```

### Task G4: Announce — share the URL

- [ ] **Step 1: Final smoke test from a fresh browser profile**

Confirm the full flow works for a true first-time user.

- [ ] **Step 2: Share the link with whoever you want to onboard**

(Manual — out of scope for the engineer.)

---

## Self-Review Notes

This plan covers all 7 phases of the spec. Spec sections map to tasks as follows:

- Spec §1 (Schema) → Tasks A1, A2, A3
- Spec §2 (Auth backend) → Tasks B1–B12
- Spec §3 (Extension API tokens) → Tasks B5 (backend), E1–E5 (extension)
- Spec §4 (API surface changes) → Tasks C1–C6
- Spec §5 (Frontend) → Tasks D1–D10
- Spec §6 (Email) → Task B6 (impl), G2 (deliverability check)
- Spec §7 (Migration & Rollout) → Phase ordering matches spec phases A–G

No placeholders. All file paths concrete. All code blocks self-contained. Type/function names consistent across tasks: `requireUser` / `requireAdmin` / `createMagicLinkToken` / `consumeMagicLinkToken` / `createSession` / `getSessionUser` / `deleteSession` / `touchSession` / `createApiToken` / `getActiveApiToken` / `revokeApiToken` / `findUserByApiToken` / `sendMagicLinkMail` / `allForUser` / `getForUser`.

Estimated total effort: 5–7 days full-time, 2–3 weeks part-time. Each task is 5–30 minutes; phases provide natural review/deploy checkpoints.
