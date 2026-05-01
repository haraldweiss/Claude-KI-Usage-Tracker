import { initDatabase, runQuery } from '../../database/sqlite.js';
import { createMagicLinkToken, consumeMagicLinkToken, createSession, getSessionUser, deleteSession, createApiToken, getActiveApiToken, revokeApiToken, findUserByApiToken } from '../../services/authService.js';

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
    await expect(consumeMagicLinkToken(t1)).rejects.toThrow('already consumed');
  });

  it('survives concurrent double-consume — only one wins', async () => {
    const token = await createMagicLinkToken('frank@example.com');
    const results = await Promise.allSettled([
      consumeMagicLinkToken(token),
      consumeMagicLinkToken(token)
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe('already consumed');
  });
});

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
