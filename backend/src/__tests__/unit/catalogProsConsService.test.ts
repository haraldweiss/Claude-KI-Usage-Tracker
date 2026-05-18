// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';

const { buildPrompt } = await import('../../services/catalogProsConsService.js');

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
