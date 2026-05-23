// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from '@jest/globals';
import { resolveTargetFamilies, KEYWORD_TO_FAMILIES } from '../../data/keywordFamilyMap.js';

describe('resolveTargetFamilies', () => {
  it('returns ["chat"] for empty input', () => {
    expect(resolveTargetFamilies([])).toEqual(['chat']);
  });

  it('returns ["chat"] for unknown keywords', () => {
    expect(resolveTargetFamilies(['totally-unknown-keyword'])).toEqual(['chat']);
  });

  it('returns ["code"] for "debug"', () => {
    expect(resolveTargetFamilies(['debug'])).toEqual(['code']);
  });

  it('returns deduplicated union for multiple keywords', () => {
    const result = resolveTargetFamilies(['debug', 'explain']);
    expect(result.sort()).toEqual(['chat', 'code']);
  });

  it('handles "ctf" → ["custom", "code"]', () => {
    const result = resolveTargetFamilies(['ctf']);
    expect(result.sort()).toEqual(['code', 'custom']);
  });

  it('deduplicates when multiple keywords map to same family', () => {
    expect(resolveTargetFamilies(['debug', 'refactor', 'fix'])).toEqual(['code']);
  });
});

describe('KEYWORD_TO_FAMILIES', () => {
  it('covers all keywords from the recommender service', () => {
    const required = [
      'summarize', 'list', 'format', 'extract', 'simple', 'search', 'translate', 'rewrite', 'capitalize',
      'debug', 'review', 'explain', 'refactor', 'analyze', 'code review', 'fix', 'improve', 'optimize',
      'architecture', 'design', 'reasoning', 'system design', 'ctf', 'exploit', 'research', 'multi-step', 'novel', 'challenging',
    ];
    for (const kw of required) {
      expect(KEYWORD_TO_FAMILIES[kw]).toBeDefined();
      expect(KEYWORD_TO_FAMILIES[kw]!.length).toBeGreaterThan(0);
    }
  });
});
