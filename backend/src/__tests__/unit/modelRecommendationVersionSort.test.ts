// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/secretCrypto.js', () => ({
  decryptSecret: (_blob: string) => 'mock-token',
  encryptSecret: (s: string) => s,
}));

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { recommendModel, extractVersionKey } = await import(
  '../../services/modelRecommendationService.js'
);

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
});

beforeEach(async () => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  // Seed only the relevant pricing rows for these tests.
  await runQuery('DELETE FROM pricing');
});

afterEach(async () => {
  jest.resetAllMocks();
});

describe('extractVersionKey', () => {
  it.each([
    ['Claude Sonnet 4.6', [4, 6]],
    ['Claude Sonnet 4.5', [4, 5]],
    ['Claude Sonnet 4.10', [4, 10]],
    ['Claude Sonnet 4', [4, 0]],
    ['Claude Haiku 5', [5, 0]],
    ['Claude Opus 4.7', [4, 7]],
    ['Claude 3.7 Sonnet', [3, 7]],
    ['No-Version-Model', [0, 0]],
  ] as Array<[string, [number, number]]>)('extracts %s → %j', (input, expected) => {
    expect(extractVersionKey(input)).toEqual(expected);
  });

  it('"4.10" beats "4.5" via tuple comparison (not float)', () => {
    const a = extractVersionKey('Claude Sonnet 4.10');
    const b = extractVersionKey('Claude Sonnet 4.5');
    // tuple-wise: a > b
    expect(a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]).toBeGreaterThan(0);
  });
});

describe('recommendModel picks latest version within tier on score-tie', () => {
  it('prefers Sonnet 4.6 over Sonnet 4.5 when scores tie', async () => {
    const now = new Date().toISOString();
    await runQuery(
      `INSERT INTO pricing (model, input_price, output_price, tier, status, last_updated)
       VALUES
         ('Claude Sonnet 4.5', 3, 15, 'sonnet', 'active', ?),
         ('Claude Sonnet 4.6', 3, 15, 'sonnet', 'active', ?)`,
      [now, now],
    );
    const r = await recommendModel('refactor this code', {});
    expect(r.recommended).toBe('Claude Sonnet 4.6');
  });

  it('prefers Opus 4.10 over Opus 4.5 (numeric, not lexicographic)', async () => {
    const now = new Date().toISOString();
    await runQuery(
      `INSERT INTO pricing (model, input_price, output_price, tier, status, last_updated)
       VALUES
         ('Claude Opus 4.5', 5, 25, 'opus', 'active', ?),
         ('Claude Opus 4.10', 5, 25, 'opus', 'active', ?)`,
      [now, now],
    );
    const r = await recommendModel('design a complex system architecture', {});
    expect(r.recommended).toBe('Claude Opus 4.10');
  });
});
