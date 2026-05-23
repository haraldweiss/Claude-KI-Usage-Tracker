// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// AES-256-GCM helpers for per-user secret storage (e.g. ai-provider-service tokens).
// Storage format: "<iv-base64>:<authTag-base64>:<ciphertext-base64>"
// All segments are base64 so the result is safe in TEXT columns.
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (!raw) {
    throw new Error('SECRETS_KEY env var is required for token encryption');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_KEY must be ${KEY_BYTES} bytes (base64); got ${key.length}`,
    );
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = enc.split(':');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Invalid encrypted secret format');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}
