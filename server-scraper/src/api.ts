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
