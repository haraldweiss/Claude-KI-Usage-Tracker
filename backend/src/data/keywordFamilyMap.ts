// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Mapping von Task-Keywords (aus modelRecommendationService.analyzeTaskComplexity)
// auf LocalModelFamily-Werte. Wird genutzt, um zu entscheiden, welche
// lokal installierten Ollama-Modelle als "Lokale Alternative" für eine
// bestimmte Task vorgeschlagen werden.
import type { LocalModelFamily } from './curatedLocalModels.js';

export const KEYWORD_TO_FAMILIES: Record<string, LocalModelFamily[]> = {
  // simple
  summarize: ['chat'],
  list: ['chat'],
  format: ['chat'],
  extract: ['chat'],
  simple: ['chat'],
  search: ['chat'],
  translate: ['chat'],
  rewrite: ['chat'],
  capitalize: ['chat'],
  // medium
  debug: ['code'],
  review: ['chat', 'code'],
  explain: ['chat'],
  refactor: ['code'],
  analyze: ['chat', 'code'],
  'code review': ['code'],
  fix: ['code'],
  improve: ['chat', 'code'],
  optimize: ['code'],
  // complex
  architecture: ['code'],
  design: ['code'],
  reasoning: ['chat'],
  'system design': ['code'],
  ctf: ['custom', 'code'],
  exploit: ['custom', 'code'],
  research: ['chat'],
  'multi-step': ['chat', 'code'],
  novel: ['chat'],
  challenging: ['chat'],
};

// Wandelt eine Liste von matched Keywords in die deduplizierte Menge der
// passenden LocalModelFamily-Werte um. Leere Eingabe oder ausschließlich
// unbekannte Keywords → ['chat'] (sicherer Default für generische Tasks).
export function resolveTargetFamilies(matchedKeywords: string[]): LocalModelFamily[] {
  if (matchedKeywords.length === 0) return ['chat'];
  const set = new Set<LocalModelFamily>();
  let anyMatched = false;
  for (const kw of matchedKeywords) {
    const families = KEYWORD_TO_FAMILIES[kw];
    if (families) {
      anyMatched = true;
      for (const f of families) set.add(f);
    }
  }
  if (!anyMatched) return ['chat'];
  return Array.from(set);
}
