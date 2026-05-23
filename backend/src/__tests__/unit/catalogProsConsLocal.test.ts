// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { buildLocalPrompt, generateLocalProsCons } = await import(
  '../../services/catalogProsConsService.js'
);
const { getLocalProsCons } = await import('../../data/localProsConsRepo.js');

let fetchMock: jest.Mock;

beforeAll(async () => {
  await initDatabase();
});

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  process.env.CATALOG_LLM_URL = 'http://pool.test';
  process.env.CATALOG_LLM_TOKEN = 'tok';
  process.env.CATALOG_LLM_MODEL = 'mistral-nemo:latest';
});

afterEach(async () => {
  await runQuery('DELETE FROM catalog_local_pros_cons');
  jest.resetAllMocks();
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
  delete process.env.CATALOG_LLM_MODEL;
});

describe('buildLocalPrompt', () => {
  it('includes model name and family hint', () => {
    const p = buildLocalPrompt('mystery-coder:latest', 'code');
    expect(p).toContain('mystery-coder:latest');
    expect(p).toContain('code');
    expect(p).toMatch(/JSON/);
  });
});

describe('generateLocalProsCons', () => {
  it('generates and caches pros/cons via primary LLM', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pros: ['Pro 1', 'Pro 2', 'Pro 3'],
                cons: ['Con 1', 'Con 2', 'Con 3'],
              }),
            },
          },
        ],
      }),
    });
    const ok = await generateLocalProsCons('mystery:latest', 'custom');
    expect(ok).toBe(true);
    const cached = await getLocalProsCons('mystery:latest');
    expect(cached!.pros).toEqual(['Pro 1', 'Pro 2', 'Pro 3']);
    expect(cached!.family).toBe('custom');
  });

  it('returns false when LLM unavailable', async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    const ok = await generateLocalProsCons('mystery:latest', 'custom');
    expect(ok).toBe(false);
  });
});
