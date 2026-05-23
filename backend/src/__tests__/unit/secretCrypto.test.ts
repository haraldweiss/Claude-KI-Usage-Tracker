// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { encryptSecret, decryptSecret } from '../../utils/secretCrypto.js';

const TEST_KEY = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex',
).toString('base64');

beforeEach(() => {
  process.env.SECRETS_KEY = TEST_KEY;
});

describe('secretCrypto', () => {
  it('roundtrips a plain string', () => {
    const enc = encryptSecret('super-secret-token');
    expect(enc).not.toBe('super-secret-token');
    expect(decryptSecret(enc)).toBe('super-secret-token');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('throws when ciphertext is tampered with', () => {
    const enc = encryptSecret('hello');
    const parts = enc.split(':');
    const tampered = Buffer.from(parts[2], 'base64');
    tampered[0] ^= 0xff;
    parts[2] = tampered.toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('throws when SECRETS_KEY missing', () => {
    delete process.env.SECRETS_KEY;
    expect(() => encryptSecret('x')).toThrow(/SECRETS_KEY/);
  });
});
