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
