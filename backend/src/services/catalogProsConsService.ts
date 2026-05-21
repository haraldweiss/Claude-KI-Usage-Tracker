// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Generiert Pros/Cons für Modell-Karten über mistral-nemo (Primary) oder
// Claude Haiku 4.5 (Fallback). Wird vom 04:00-Cron für Latest-Uploads und
// vom /search-Endpoint asynchron aufgerufen. Failure ist nicht fatal —
// Karten ohne Pros/Cons werden vom Frontend einfach ohne diese Felder gerendert.
import type { ModelCard } from './catalogService.js';
import { upsertCardCache, recordCacheError } from '../data/catalogCacheRepo.js';
import type { LocalModelFamily } from '../data/curatedLocalModels.js';
import { upsertLocalProsCons } from '../data/localProsConsRepo.js';

export interface ProsCons {
  pros: string[];
  cons: string[];
}

const SYSTEM_PROMPT =
  'Du bist ein Experte für lokale Open-Source-LLMs. Du bewertest Modelle für ' +
  'deutschsprachige Entwickler:innen und gibst kompakte Pro/Contra-Listen aus. ' +
  'Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach.';

const STRICT_RETRY_PROMPT =
  SYSTEM_PROMPT +
  ' WICHTIG: Deine vorherige Antwort enthielt kein gültiges JSON. Antworte JETZT ' +
  'nur mit reinem JSON, ohne Markdown-Codeblöcke, ohne Vor-/Nachwort.';

const REQUEST_TIMEOUT_MS = 30_000;

async function callOpenAICompat(
  url: string,
  token: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 500,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response content');
  return content;
}

export async function callPrimaryLLM(card: ModelCard): Promise<ProsCons> {
  const url = process.env.CATALOG_LLM_URL?.trim();
  const token = process.env.CATALOG_LLM_TOKEN?.trim();
  const model = process.env.CATALOG_LLM_MODEL?.trim() || 'mistral-nemo:latest';
  if (!url || !token) throw new Error('Primary LLM not configured');

  const userPrompt = buildPrompt(card);
  let content = await callOpenAICompat(url, token, model, SYSTEM_PROMPT, userPrompt);
  try {
    return parseProsCons(content);
  } catch {
    // Retry once with stricter system prompt
    content = await callOpenAICompat(url, token, model, STRICT_RETRY_PROMPT, userPrompt);
    return parseProsCons(content);
  }
}

async function callAnthropicNative(
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = json.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Empty Anthropic response');
  return text;
}

export async function callFallbackLLM(card: ModelCard): Promise<ProsCons> {
  const key = process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();
  const model = process.env.CATALOG_LLM_FALLBACK_MODEL?.trim() || 'claude-haiku-4-5';
  if (!key) throw new Error('Fallback LLM not configured');

  const userPrompt = buildPrompt(card);
  let content = await callAnthropicNative(key, model, SYSTEM_PROMPT, userPrompt);
  try {
    return parseProsCons(content);
  } catch {
    content = await callAnthropicNative(key, model, STRICT_RETRY_PROMPT, userPrompt);
    return parseProsCons(content);
  }
}

function primaryConfigured(): boolean {
  return !!(process.env.CATALOG_LLM_URL?.trim() && process.env.CATALOG_LLM_TOKEN?.trim());
}

function fallbackConfigured(): boolean {
  return !!process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();
}

export function isProsConsEnabled(): boolean {
  return primaryConfigured() || fallbackConfigured();
}

// Versucht Pros/Cons für ein Modell zu generieren und in den Cache zu schreiben.
// Probiert primär mistral-nemo via eigene Pool, fällt bei Failure auf
// Claude Haiku 4.5 zurück (falls Fallback konfiguriert). Returns true bei
// Erfolg, false bei Skip/Failure. Wirft NICHT — Failure-Modes werden via
// last_error stamping in catalog_hf_cache geloggt.
export async function generateAndCacheProsCons(card: ModelCard): Promise<boolean> {
  if (!isProsConsEnabled()) return false;

  let result: ProsCons | null = null;
  let primaryErr: string | null = null;
  let fallbackErr: string | null = null;

  if (primaryConfigured()) {
    try {
      result = await callPrimaryLLM(card);
    } catch (e) {
      primaryErr = (e as Error).message;
    }
  }
  if (!result && fallbackConfigured()) {
    try {
      result = await callFallbackLLM(card);
    } catch (e) {
      fallbackErr = (e as Error).message;
    }
  }

  if (!result) {
    const parts = [
      primaryErr && `primary: ${primaryErr}`,
      fallbackErr && `fallback: ${fallbackErr}`,
    ].filter(Boolean) as string[];
    const msg = parts.join(' | ') || 'no provider configured';
    await recordCacheError(card.repo, msg);
    return false;
  }

  const updated: ModelCard = {
    ...card,
    pros: result.pros,
    cons: result.cons,
    auto_pros_generated_at: new Date().toISOString(),
  };
  await upsertCardCache(card.repo, updated, null);
  return true;
}

export interface BatchResult {
  generated: number;
  skipped: number;
  failed: number;
}

// Batch-Variante: ruft generateAndCacheProsCons() für jedes Card sequentiell auf.
// Pause zwischen Calls (Default 2000ms) verhindert, dass die eigene Pool
// gehämmert wird. Bei 6 Latest Uploads ≈ 12s zusätzlich.
export async function generateBatchProsCons(
  cards: ModelCard[],
  opts: { pauseMs?: number } = {},
): Promise<BatchResult> {
  const pauseMs = opts.pauseMs ?? 2000;
  const summary: BatchResult = { generated: 0, skipped: 0, failed: 0 };
  if (!isProsConsEnabled()) {
    summary.skipped = cards.length;
    return summary;
  }
  for (let i = 0; i < cards.length; i++) {
    const ok = await generateAndCacheProsCons(cards[i]!);
    if (ok) summary.generated++;
    else summary.failed++;
    if (i < cards.length - 1 && pauseMs > 0) {
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  return summary;
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

// Prompt-Template für lokale Ollama-Modelle, die NICHT aus HuggingFace kommen
// (z.B. Custom-Builds wie "mistral-nemo-cc"). Anders als buildPrompt() für
// HF-Cards kennen wir hier nur Name + Family-Hint, keine HF-Description.
export function buildLocalPrompt(modelName: string, family: LocalModelFamily): string {
  return [
    `Modell-Name (Ollama): ${modelName}`,
    `Kategorie: ${family}`,
    '',
    'Schreibe 3 Pros und 3 Cons, jeweils einen kurzen Satz (max. 80 Zeichen),',
    'konkret und praxisnah für deutschsprachige Entwickler:innen:',
    '- Pros: Anwendungsfälle, Stärken, was das Modell gut macht',
    '- Cons: Schwächen, Limitierungen, wofür es ungeeignet ist',
    '',
    'Wenn der Modell-Name auf eine bekannte Familie hinweist (z.B. "mistral-nemo-cc"',
    'als Custom-Variante von Mistral Nemo), nutze dein Wissen über die Familie.',
    '',
    'Antworte AUSSCHLIESSLICH mit gültigem JSON, keine Erklärungen davor oder danach:',
    '{"pros": ["...", "...", "..."], "cons": ["...", "...", "..."]}',
  ].join('\n');
}

// Generiert Pros/Cons für ein lokales Ollama-Modell via Primary-LLM (oder
// Fallback). Cached das Ergebnis in catalog_local_pros_cons. Failure ist
// nicht fatal — der nächste Page-Load triggert einen Retry. Returns true
// bei Erfolg, false bei Skip/Failure.
export async function generateLocalProsCons(
  modelName: string,
  family: LocalModelFamily,
): Promise<boolean> {
  if (!isProsConsEnabled()) return false;

  const userPrompt = buildLocalPrompt(modelName, family);
  let result: ProsCons | null = null;

  const primaryUrl = process.env.CATALOG_LLM_URL?.trim();
  const primaryToken = process.env.CATALOG_LLM_TOKEN?.trim();
  const primaryModel =
    process.env.CATALOG_LLM_MODEL?.trim() || 'mistral-nemo:latest';
  if (primaryUrl && primaryToken) {
    try {
      let content = await callOpenAICompat(
        primaryUrl, primaryToken, primaryModel, SYSTEM_PROMPT, userPrompt,
      );
      try {
        result = parseProsCons(content);
      } catch {
        content = await callOpenAICompat(
          primaryUrl, primaryToken, primaryModel, STRICT_RETRY_PROMPT, userPrompt,
        );
        result = parseProsCons(content);
      }
    } catch {
      result = null;
    }
  }

  if (!result) {
    const fallbackKey = process.env.CATALOG_LLM_FALLBACK_ANTHROPIC_KEY?.trim();
    const fallbackModel =
      process.env.CATALOG_LLM_FALLBACK_MODEL?.trim() || 'claude-haiku-4-5';
    if (fallbackKey) {
      try {
        let content = await callAnthropicNative(
          fallbackKey, fallbackModel, SYSTEM_PROMPT, userPrompt,
        );
        try {
          result = parseProsCons(content);
        } catch {
          content = await callAnthropicNative(
            fallbackKey, fallbackModel, STRICT_RETRY_PROMPT, userPrompt,
          );
          result = parseProsCons(content);
        }
      } catch {
        result = null;
      }
    }
  }

  if (!result) return false;
  await upsertLocalProsCons(modelName, result.pros, result.cons, family);
  return true;
}
