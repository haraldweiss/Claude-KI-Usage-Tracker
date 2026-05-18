// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { apiCall } from './api';

export interface ModelCard {
  repo: string;
  size_b: number | null;
  quant_count: number;
  downloads: number;
  source_label: string;
  description: string;
  default_quant: string;
  ollama_command: string;
  // Curated meta — only present for curated models, not search results
  pros?: string[];
  cons?: string[];
  setup_note?: string;
  stale?: boolean;
}

export interface CuratedSection {
  key: string;
  label: string;
  default_quant: string;
  models: ModelCard[];
}

export interface CuratedResponse {
  sections: CuratedSection[];
}

export interface SearchResponse {
  results: ModelCard[];
  stale?: boolean;
}

export interface InstalledResponse {
  models: string[];
}

export function getCurated(): Promise<CuratedResponse> {
  return apiCall<CuratedResponse>('/catalog/curated');
}

export function searchCatalog(
  q: string, limit: number = 50, signal?: AbortSignal,
): Promise<SearchResponse> {
  const url = `/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  return apiCall<SearchResponse>(url, { signal });
}

export function getInstalled(): Promise<InstalledResponse> {
  return apiCall<InstalledResponse>('/catalog/installed');
}

// Mirrors the backend heuristic; used by ModelCard rendering to decide on the badge.
export function isInstalled(installedNames: string[], repo: string): boolean {
  const repoTail = repo.split('/').pop() ?? '';
  const needle = repoTail.replace(/-GGUF$/i, '').toLowerCase();
  const repoLower = repo.toLowerCase();
  return installedNames.some((n) => {
    const ln = n.toLowerCase();
    return ln.startsWith(needle) || ln.includes(`hf.co/${repoLower}`);
  });
}
