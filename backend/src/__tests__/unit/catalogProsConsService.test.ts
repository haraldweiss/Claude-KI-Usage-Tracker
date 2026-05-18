// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals';

process.env.DATABASE_PATH = ':memory:';

const { initDatabase, runQuery, allQuery } = await import('../../database/sqlite.js');
const {
  buildPrompt,
  parseProsCons,
  callPrimaryLLM,
  callFallbackLLM,
  generateAndCacheProsCons,
  isProsConsEnabled,
} = await import('../../services/catalogProsConsService.js');

beforeAll(async () => {
  await initDatabase();
});

let fetchMock: jest.Mock;

const CARD = {
  repo: 'bartowski/X-GGUF',
  source_label: 'Bartowski',
  size_b: 7,
  quant_count: 4,
  downloads: 1000,
  default_quant: 'Q4_K_M',
  ollama_command: 'ollama run hf.co/bartowski/X-GGUF:Q4_K_M',
  description: 'Coding LLM',
};

describe('buildPrompt', () => {
  it('includes repo, size, source_label and description', () => {
    const card = {
      repo: 'bartowski/Awesome-Model-GGUF',
      source_label: 'Bartowski',
      size_b: 7,
      quant_count: 4,
      downloads: 1000,
      default_quant: 'Q4_K_M',
      ollama_command: 'ollama run hf.co/bartowski/Awesome-Model-GGUF:Q4_K_M',
      description: 'A great coding LLM by Qwen.',
    };
    const prompt = buildPrompt(card as never);
    expect(prompt).toContain('bartowski/Awesome-Model-GGUF');
    expect(prompt).toContain('7B');
    expect(prompt).toContain('Bartowski');
    expect(prompt).toContain('A great coding LLM');
    expect(prompt).toContain('"pros"');
    expect(prompt).toContain('"cons"');
  });

  it('handles missing description gracefully', () => {
    const card = {
      repo: 'x/y',
      source_label: 'Other',
      size_b: 1,
      quant_count: 1,
      downloads: 1,
      default_quant: 'Q4_K_M',
      ollama_command: 'x',
      description: '',
    };
    const prompt = buildPrompt(card as never);
    expect(prompt).toContain('x/y');
    expect(prompt).not.toContain('undefined');
  });
});

describe('parseProsCons', () => {
  it('parses clean JSON', () => {
    const r = parseProsCons('{"pros": ["A", "B", "C"], "cons": ["X", "Y", "Z"]}');
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(r.cons).toEqual(['X', 'Y', 'Z']);
  });

  it('extracts JSON from surrounding text', () => {
    const noisy =
      'Hier ist meine Antwort:\n```json\n{"pros":["A","B","C"],"cons":["X","Y","Z"]}\n```\nHoffe das hilft!';
    const r = parseProsCons(noisy);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(r.cons).toEqual(['X', 'Y', 'Z']);
  });

  it('trims strings to 80 chars', () => {
    const long = 'A'.repeat(120);
    const json = `{"pros":["${long}","B","C"],"cons":["X","Y","Z"]}`;
    const r = parseProsCons(json);
    expect(r.pros[0]).toHaveLength(80);
  });

  it('throws if pros is missing', () => {
    expect(() => parseProsCons('{"cons":["X","Y","Z"]}')).toThrow();
  });

  it('throws if pros is empty array', () => {
    expect(() => parseProsCons('{"pros":[],"cons":["X","Y","Z"]}')).toThrow();
  });

  it('pads 2-bullet response to 3', () => {
    const r = parseProsCons('{"pros":["A","B"],"cons":["X","Y","Z"]}');
    expect(r.pros).toHaveLength(3);
    expect(r.pros[2]).toBe('');
  });

  it('truncates 4+-bullet response to 3', () => {
    const r = parseProsCons('{"pros":["A","B","C","D"],"cons":["X","Y","Z","W"]}');
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(r.cons).toEqual(['X', 'Y', 'Z']);
  });

  it('rejects unparseable garbage', () => {
    expect(() => parseProsCons('totally not json')).toThrow();
  });
});

describe('callPrimaryLLM', () => {
  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    process.env.CATALOG_LLM_URL = 'http://pool.test';
    process.env.CATALOG_LLM_TOKEN = 'test-token';
  });
  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_MODEL;
  });

  it('happy path: parses OpenAI-compat response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' } }],
      }),
    });
    const r = await callPrimaryLLM(CARD as never);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/chat/completions');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('throws on HTTP 500', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'pool down',
    });
    await expect(callPrimaryLLM(CARD as never)).rejects.toThrow(/500/);
  });

  it('throws on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'auth',
    });
    await expect(callPrimaryLLM(CARD as never)).rejects.toThrow(/401/);
  });

  it('retries once if response is not valid JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'sorry no JSON' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' } }],
        }),
      });
    const r = await callPrimaryLLM(CARD as never);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws if both attempts return unparseable', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'still no JSON' } }] }),
    });
    await expect(callPrimaryLLM(CARD as never)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws if env vars missing', async () => {
    delete process.env.CATALOG_LLM_URL;
    await expect(callPrimaryLLM(CARD as never)).rejects.toThrow(/not configured/);
  });

  it('uses custom model from env', async () => {
    process.env.CATALOG_LLM_MODEL = 'qwen2.5:7b';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' } }],
      }),
    });
    await callPrimaryLLM(CARD as never);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(opts.body));
    expect(body.model).toBe('qwen2.5:7b');
  });
});

describe('callFallbackLLM', () => {
  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY = 'sk-ant-test';
  });
  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    delete process.env.CATALOG_LLM_FALLBACK_MODEL;
  });

  it('happy path: parses Anthropic messages response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' }],
      }),
    });
    const r = await callFallbackLLM(CARD as never);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const headers = opts.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBeTruthy();
  });

  it('uses custom model from env', async () => {
    process.env.CATALOG_LLM_FALLBACK_MODEL = 'claude-sonnet-4-5';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' }],
      }),
    });
    await callFallbackLLM(CARD as never);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(opts.body));
    expect(body.model).toBe('claude-sonnet-4-5');
  });

  it('uses default claude-haiku-4-5 if model env unset', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' }],
      }),
    });
    await callFallbackLLM(CARD as never);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.model).toBe('claude-haiku-4-5');
  });

  it('throws on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"auth"}',
    });
    await expect(callFallbackLLM(CARD as never)).rejects.toThrow(/401/);
  });

  it('throws if key missing', async () => {
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    await expect(callFallbackLLM(CARD as never)).rejects.toThrow(/not configured/);
  });

  it('retries once if response is not valid JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'no JSON' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"pros":["A","B","C"],"cons":["X","Y","Z"]}' }],
        }),
      });
    const r = await callFallbackLLM(CARD as never);
    expect(r.pros).toEqual(['A', 'B', 'C']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('isProsConsEnabled', () => {
  afterEach(() => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
  });
  it('returns true if primary is configured', () => {
    process.env.CATALOG_LLM_URL = 'x';
    process.env.CATALOG_LLM_TOKEN = 'y';
    expect(isProsConsEnabled()).toBe(true);
  });
  it('returns true if only fallback is configured', () => {
    process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY = 'sk-ant-x';
    expect(isProsConsEnabled()).toBe(true);
  });
  it('returns false if neither is configured', () => {
    expect(isProsConsEnabled()).toBe(false);
  });
});

describe('generateAndCacheProsCons', () => {
  beforeEach(async () => {
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    process.env.CATALOG_LLM_URL = 'http://pool.test';
    process.env.CATALOG_LLM_TOKEN = 'tok';
    process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY = 'sk-ant';
    // Seed the card in cache so upsert can update pros/cons
    await runQuery(
      `INSERT OR REPLACE INTO catalog_hf_cache (repo, data_json, fetched_at, last_error) VALUES (?, ?, ?, NULL)`,
      [CARD.repo, JSON.stringify(CARD), new Date().toISOString()],
    );
  });
  afterEach(async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    jest.resetAllMocks();
    await runQuery(`DELETE FROM catalog_hf_cache`);
  });

  it('primary succeeds: upserts pros/cons, no fallback call', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"pros":["P1","P2","P3"],"cons":["C1","C2","C3"]}' } }],
      }),
    });
    const ok = await generateAndCacheProsCons(CARD as never);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rows = await allQuery<{ data_json: string }>(
      `SELECT data_json FROM catalog_hf_cache WHERE repo=?`,
      [CARD.repo],
    );
    const card = JSON.parse(rows[0]!.data_json);
    expect(card.pros).toEqual(['P1', 'P2', 'P3']);
    expect(card.cons).toEqual(['C1', 'C2', 'C3']);
    expect(card.auto_pros_generated_at).toBeTruthy();
  });

  it('primary fails, fallback succeeds: upserts pros/cons', async () => {
    // 1st call: primary returns 503 → callPrimaryLLM throws (HTTP errors do NOT
    // trigger the parse-retry path). Wrapper falls through to fallback.
    // 2nd call: fallback returns valid JSON → success.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'pool down' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"pros":["F1","F2","F3"],"cons":["G1","G2","G3"]}' }],
        }),
      });
    const ok = await generateAndCacheProsCons(CARD as never);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await allQuery<{ data_json: string }>(
      `SELECT data_json FROM catalog_hf_cache WHERE repo=?`,
      [CARD.repo],
    );
    const card = JSON.parse(rows[0]!.data_json);
    expect(card.pros).toEqual(['F1', 'F2', 'F3']);
  });

  it('both fail: records last_error with both messages, returns false', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'down' });
    const ok = await generateAndCacheProsCons(CARD as never);
    expect(ok).toBe(false);
    const rows = await allQuery<{ last_error: string | null }>(
      `SELECT last_error FROM catalog_hf_cache WHERE repo=?`,
      [CARD.repo],
    );
    expect(rows[0]!.last_error).toMatch(/primary.*fallback/);
  });

  it('returns false if neither provider configured', async () => {
    delete process.env.CATALOG_LLM_URL;
    delete process.env.CATALOG_LLM_TOKEN;
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    const ok = await generateAndCacheProsCons(CARD as never);
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records last_error with only primary message when fallback unconfigured', async () => {
    delete process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY;
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'down' });
    const ok = await generateAndCacheProsCons(CARD as never);
    expect(ok).toBe(false);
    const rows = await allQuery<{ last_error: string | null }>(
      `SELECT last_error FROM catalog_hf_cache WHERE repo=?`,
      [CARD.repo],
    );
    expect(rows[0]!.last_error).toMatch(/primary/);
    expect(rows[0]!.last_error).not.toMatch(/fallback/);
  });
});
