// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HF Hub API client with in-memory cache + status-match heuristic.
// 30-min TTL, stale-fallback on HF errors.

export interface ModelCard {
  repo: string;
  size_b: number | null;
  quant_count: number;
  downloads: number;
  source_label: string;
  description: string;
  default_quant: string;
  ollama_command: string;
  // Curated meta (only on curated models, not on search results):
  pros?: string[];
  cons?: string[];
  setup_note?: string;
  stale?: boolean;
  // B.3: LLM-generated pros/cons (only on auto-generated, not on curated).
  // ISO-8601 timestamp; used by the 04:00 cron to detect stale (> 30d) entries.
  auto_pros_generated_at?: string;
}

interface HfModelResponse {
  modelId?: string;
  downloads?: number;
  siblings?: Array<{ rfilename?: string }>;
  description?: string;
}

interface CacheEntry { data: ModelCard | ModelCard[]; fetched_at: number; }

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

const HF_TOKEN = process.env.HF_TOKEN;

function authHeaders(): Record<string, string> {
  return HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
}

function sourceLabelFromRepo(repo: string): string {
  const user = repo.split('/')[0]?.toLowerCase() ?? '';
  if (user === 'bartowski') return 'Bartowski';
  if (user === 'maziyarpanahi') return 'MaziyarPanahi';
  return 'community';
}

function sizeFromRepo(repo: string): number | null {
  // Heuristic: pick the last "<n>B" pattern. Examples:
  // "Qwen2.5-Coder-7B-Instruct" → 7; "Llama-3.2-3B-Instruct" → 3.
  const matches = [...repo.matchAll(/(\d+(?:\.\d+)?)B/gi)];
  const last = matches[matches.length - 1];
  const captured = last?.[1];
  if (!captured) return null;
  const n = parseFloat(captured);
  return Number.isFinite(n) ? n : null;
}

export function ollamaCommandFor(repo: string, defaultQuant: string): string {
  return `ollama run hf.co/${repo}:${defaultQuant}`;
}

function mapToCard(
  data: HfModelResponse,
  defaultQuant: string,
  fallbackRepo: string,
): ModelCard {
  const repo = data.modelId ?? fallbackRepo;
  const ggufCount = (data.siblings ?? []).filter(
    (s) => typeof s.rfilename === 'string' && s.rfilename.toLowerCase().endsWith('.gguf'),
  ).length;
  const desc = (data.description ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
  return {
    repo,
    size_b: sizeFromRepo(repo),
    quant_count: ggufCount,
    downloads: data.downloads ?? 0,
    source_label: sourceLabelFromRepo(repo),
    description: desc.slice(0, 200),
    default_quant: defaultQuant,
    ollama_command: ollamaCommandFor(repo, defaultQuant),
  };
}

export async function fetchModelMetadata(
  repo: string, defaultQuant: string,
): Promise<ModelCard | null> {
  const key = `model:${repo}:${defaultQuant}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.fetched_at < TTL_MS) {
    return hit.data as ModelCard;
  }
  try {
    // HF expects the slash between user/repo unencoded; encode each side.
    const parts = repo.split('/', 2);
    const user = parts[0] ?? repo;
    const name = parts[1];
    const encodedRepo = name
      ? `${encodeURIComponent(user)}/${encodeURIComponent(name)}`
      : encodeURIComponent(user);
    const res = await fetch(
      `https://huggingface.co/api/models/${encodedRepo}`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`HF ${res.status}`);
    }
    const data = (await res.json()) as HfModelResponse;
    const card = mapToCard(data, defaultQuant, repo);
    cache.set(key, { data: card, fetched_at: now });
    return card;
  } catch (e) {
    if (hit) {
      return { ...(hit.data as ModelCard), stale: true };
    }
    throw e;
  }
}

export interface SearchResult {
  results: ModelCard[];
  stale?: boolean;
}

export async function searchModels(q: string, limit: number = 50): Promise<SearchResult> {
  const key = `search:${q}:${limit}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.fetched_at < TTL_MS) {
    return { results: hit.data as ModelCard[] };
  }
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('library', 'gguf');
  url.searchParams.set('search', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'downloads');
  url.searchParams.set('direction', '-1');
  try {
    const res = await fetch(url.toString(), { headers: authHeaders() });
    if (!res.ok) throw new Error(`HF ${res.status}`);
    const arr = (await res.json()) as HfModelResponse[];
    const cards = arr.map((d) => mapToCard(d, 'Q4_K_M', d.modelId ?? ''));
    cache.set(key, { data: cards, fetched_at: now });
    return { results: cards };
  } catch (e) {
    if (hit) {
      return { results: hit.data as ModelCard[], stale: true };
    }
    throw e;
  }
}

export function isInstalled(installedNames: string[], repo: string): boolean {
  const repoTail = repo.split('/').pop() ?? '';
  const needle = repoTail.replace(/-GGUF$/i, '').toLowerCase();
  const repoLower = repo.toLowerCase();
  return installedNames.some((n) => {
    const ln = n.toLowerCase();
    return ln.startsWith(needle) || ln.includes(`hf.co/${repoLower}`);
  });
}

// Test-only: reset the cache between unit tests.
export function __clearCacheForTest(opts?: { keepStale?: boolean }): void {
  if (opts?.keepStale) {
    for (const [k, v] of cache) {
      cache.set(k, { ...v, fetched_at: Date.now() - TTL_MS - 1000 });
    }
    return;
  }
  cache.clear();
}

// ---------------------------------------------------------------------------
// Sub-B.2: Latest uploads by author (Bartowski / MaziyarPanahi)
// ---------------------------------------------------------------------------

export interface HfModelDto {
  id?: string;            // e.g. "bartowski/X-GGUF"
  modelId?: string;       // sometimes used instead of id
  lastModified?: string;  // ISO 8601
}

export async function fetchLatestUploads(
  author: string, limit: number = 15,
): Promise<HfModelDto[]> {
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('author', author);
  url.searchParams.set('library', 'gguf');
  url.searchParams.set('sort', 'lastModified');
  url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`HF ${res.status}`);
  return (await res.json()) as HfModelDto[];
}
