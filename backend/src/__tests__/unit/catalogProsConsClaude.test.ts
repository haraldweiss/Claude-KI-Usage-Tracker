// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { buildClaudePrompt, generateClaudeProsCons } = await import(
  '../../services/catalogProsConsService.js'
);
const { getModelProsCons } = await import('../../data/modelProsConsRepo.js');

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
  await runQuery('DELETE FROM model_pros_cons');
  jest.resetAllMocks();
  delete process.env.CATALOG_LLM_URL;
  delete process.env.CATALOG_LLM_TOKEN;
  delete process.env.CATALOG_LLM_MODEL;
});

describe('buildClaudePrompt', () => {
  it('includes model name, tier, and pricing', () => {
    const p = buildClaudePrompt('Claude Sonnet 4.6', 'sonnet', { input: 3, output: 15 });
    expect(p).toContain('Claude Sonnet 4.6');
    expect(p).toContain('sonnet');
    expect(p).toContain('3');
    expect(p).toContain('15');
    expect(p).toMatch(/JSON/);
  });

  it('handles null tier', () => {
    const p = buildClaudePrompt('Claude Some-Model', null, { input: 1, output: 5 });
    expect(p).toContain('Claude Some-Model');
    expect(p).toMatch(/JSON/);
  });
});

describe('generateClaudeProsCons', () => {
  it('generates and caches pros/cons via primary LLM', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pros: ['Strong reasoning', '200k context', 'Vision capable'],
                cons: ['Higher cost', 'Slower than Haiku', 'Rate limits'],
              }),
            },
          },
        ],
      }),
    });
    const ok = await generateClaudeProsCons(
      'Claude Sonnet 4.6',
      'sonnet',
      { input: 3, output: 15 },
    );
    expect(ok).toBe(true);
    const cached = await getModelProsCons('Claude Sonnet 4.6');
    expect(cached!.pros).toEqual(['Strong reasoning', '200k context', 'Vision capable']);
    expect(cached!.cons).toEqual(['Higher cost', 'Slower than Haiku', 'Rate limits']);
  });

  it('returns false when LLM unavailable', async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    const ok = await generateClaudeProsCons(
      'Claude Sonnet 4.6',
      'sonnet',
      { input: 3, output: 15 },
    );
    expect(ok).toBe(false);
  });
});
