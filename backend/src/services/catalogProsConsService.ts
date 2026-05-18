// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Generiert Pros/Cons für Modell-Karten über mistral-nemo (Primary) oder
// Claude Haiku 4.5 (Fallback). Wird vom 04:00-Cron für Latest-Uploads und
// vom /search-Endpoint asynchron aufgerufen. Failure ist nicht fatal —
// Karten ohne Pros/Cons werden vom Frontend einfach ohne diese Felder gerendert.
import type { ModelCard } from './catalogService.js';

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
