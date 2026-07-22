import type { UsageTrackPayload } from './types.js';

const DEFAULT_API_BASE = 'http://localhost:3001/api';

function getApiBase(): string {
  return process.env.API_BASE || DEFAULT_API_BASE;
}

function getApiToken(): string | undefined {
  return process.env.API_TOKEN || undefined;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Post a single usage record to the backend.
 */
export async function postUsage(payload: UsageTrackPayload): Promise<Response> {
  const apiBase = getApiBase();
  const auth = await getAuthHeaders();
  const url = `${apiBase}/usage/track`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'no body');
    throw new Error(`POST ${url} ${response.status}: ${text}`);
  }

  return response;
}

/**
 * Fetch the provider configuration and return the set of provider keys whose
 * plan is assigned and not expired (plan_valid_until not reached).
 * Returns null when the config cannot be loaded OR no providers are
 * configured at all — callers should fail open and run everything in that
 * case (keeps fresh installations scraping).
 */
export async function getActiveProviderKeys(): Promise<Set<string> | null> {
  const apiBase = getApiBase();
  const auth = await getAuthHeaders();
  try {
    const response = await fetch(`${apiBase}/settings/providers`, { headers: auth });
    if (!response.ok) {
      console.warn(`[api] provider config request failed (${response.status}) — running all scrapers`);
      return null;
    }
    const data = await response.json() as {
      providers?: Array<{ key?: string; plan_name?: string | null; plan_valid_until?: string | null }>;
    };
    if (!Array.isArray(data.providers) || data.providers.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const active = new Set<string>();
    for (const p of data.providers) {
      if (typeof p?.key !== 'string') continue;
      if (typeof p?.plan_name !== 'string' || p.plan_name.trim() === '') continue;
      if (p.plan_valid_until && p.plan_valid_until <= today) continue; // expired
      active.add(p.key);
    }
    return active;
  } catch (err) {
    console.warn('[api] provider config request error — running all scrapers:', err);
    return null;
  }
}
