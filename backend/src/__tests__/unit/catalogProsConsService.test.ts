// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';

const { buildPrompt, parseProsCons } = await import('../../services/catalogProsConsService.js');

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
