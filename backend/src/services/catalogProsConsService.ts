// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Generiert Pros/Cons für Modell-Karten über mistral-nemo (Primary) oder
// Claude Haiku 4.5 (Fallback). Wird vom 04:00-Cron für Latest-Uploads und
// vom /search-Endpoint asynchron aufgerufen. Failure ist nicht fatal —
// Karten ohne Pros/Cons werden vom Frontend einfach ohne diese Felder gerendert.
import type { ModelCard } from './catalogService.js';
import { upsertCardCache, recordCacheError } from '../data/catalogCacheRepo.js';

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
