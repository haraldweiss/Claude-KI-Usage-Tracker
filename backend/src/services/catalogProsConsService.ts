// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Generiert Pros/Cons für Modell-Karten über mistral-nemo (Primary) oder
// Claude Haiku 4.5 (Fallback). Wird vom 04:00-Cron für Latest-Uploads und
// vom /search-Endpoint asynchron aufgerufen. Failure ist nicht fatal —
// Karten ohne Pros/Cons werden vom Frontend einfach ohne diese Felder gerendert.
import type { ModelCard } from './catalogService.js';

export interface ProsCons {
  pros: string[];
  cons: string[];
}

// Tolerant gegenüber LLM-Output: probiert direkten JSON.parse, fällt
// dann auf RegEx-Extraktion (z.B. wenn der LLM Markdown-Codeblöcke um das
// JSON wrappt). Normalisiert auf exakt 3 Bullets je Liste (pad mit ""
// oder truncate), trimmt Strings auf 80 Zeichen. Wirft bei strukturellen
// Fehlern oder leerem Array.
export function parseProsCons(content: string): ProsCons {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    try {
      json = JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`JSON parse failed: ${(e as Error).message}`);
    }
  }
  const obj = json as { pros?: unknown; cons?: unknown };
  if (!Array.isArray(obj.pros) || !Array.isArray(obj.cons)) {
    throw new Error('Response missing pros[] or cons[] arrays');
  }
  const normalize = (arr: unknown[]): string[] => {
    const strings = arr
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim().slice(0, 80));
    if (strings.length === 0) throw new Error('Empty bullet array');
    while (strings.length < 3) strings.push('');
    return strings.slice(0, 3);
  };
  return { pros: normalize(obj.pros), cons: normalize(obj.cons) };
}

export function buildPrompt(card: ModelCard): string {
  const desc = card.description?.trim() || '—';
  return [
    `Modell: ${card.repo}`,
    `Größe: ${card.size_b ?? '?'}B Parameter, ${card.quant_count} Quantisierungen verfügbar`,
    `Veröffentlicht von: ${card.source_label}`,
    `Beschreibung (HuggingFace): ${desc}`,
    '',
    'Schreibe 3 Pros und 3 Cons, jeweils einen kurzen Satz (max. 80 Zeichen),',
    'konkret und praxisnah:',
    '- Pros: Anwendungsfälle, Stärken, was das Modell gut macht',
    '- Cons: Schwächen, Limitierungen, wofür es ungeeignet ist',
    '',
    'Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach:',
    '{"pros": ["...", "...", "..."], "cons": ["...", "...", "..."]}',
  ].join('\n');
}
