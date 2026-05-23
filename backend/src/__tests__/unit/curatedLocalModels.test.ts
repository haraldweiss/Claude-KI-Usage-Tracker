// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';
import {
  normalizeOllamaName,
  CURATED_LOCAL_MODELS,
  lookupCuratedLocal,
} from '../../data/curatedLocalModels.js';

describe('normalizeOllamaName', () => {
  it.each([
    ['mistral-nemo:latest', 'mistral-nemo'],
    ['mistral-nemo:12b-instruct-2407-q5_K_M', 'mistral-nemo'],
    ['mistral-nemo-cc:latest', 'mistral-nemo'],
    ['deepseek-r1:8b', 'deepseek-r1'],
    ['llama3.1:8b-instruct-q5_K_M', 'llama3.1'],
    ['nomic-embed-text:latest', 'nomic-embed-text'],
    ['qwen3-coder:latest', 'qwen3-coder'],
    ['qwen3-coder-cc:latest', 'qwen3-coder'],
    ['anubclaw/dev-coder:q5', 'dev-coder'],
    ['hf.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M', 'qwen2.5-coder'],
    ['hf.co/Jiunsong/supergemma4-26b-uncensored-gguf-v2:Q4_K_M', 'supergemma'],
    ['hf.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M', 'llama3.1'],
    ['soc-analyst:latest', 'soc-analyst'],
    ['qwen3.6:latest', 'qwen3.6'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeOllamaName(input)).toBe(expected);
  });
});

describe('CURATED_LOCAL_MODELS', () => {
  it('every entry has exactly 3 pros and 3 cons', () => {
    for (const [name, entry] of Object.entries(CURATED_LOCAL_MODELS)) {
      expect(entry.pros).toHaveLength(3);
      expect(entry.cons).toHaveLength(3);
      expect(['chat', 'code', 'embedding', 'custom']).toContain(entry.family);
      for (const p of [...entry.pros, ...entry.cons]) {
        expect(p.length).toBeLessThanOrEqual(80);
        expect(p.length).toBeGreaterThan(5);
      }
    }
    expect(Object.keys(CURATED_LOCAL_MODELS)).toContain('mistral-nemo');
    expect(Object.keys(CURATED_LOCAL_MODELS)).toContain('deepseek-r1');
    expect(Object.keys(CURATED_LOCAL_MODELS)).toContain('nomic-embed-text');
  });
});

describe('lookupCuratedLocal', () => {
  it('returns entry for known name', () => {
    expect(lookupCuratedLocal('mistral-nemo:latest')).toMatchObject({ family: 'chat' });
  });
  it('returns entry for HF-prefixed name', () => {
    expect(
      lookupCuratedLocal('hf.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Q4_K_M'),
    ).toMatchObject({ family: 'code' });
  });
  it('returns null for unknown', () => {
    expect(lookupCuratedLocal('some-random-custom-model:latest')).toBeNull();
  });
});
