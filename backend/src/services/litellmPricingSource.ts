import { deriveDisplayName, inferTier, type Tier } from './modelNormalizer.js';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const FETCH_TIMEOUT_MS = 10_000;

export interface UpstreamModel {
  api_id: string;
  displayName: string;
  tier: Tier;
  inputPrice: number;
  outputPrice: number;
}

interface RawEntry {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  mode?: string;
}

export function parseLiteLLM(raw: unknown): Array<{
  api_id: string;
  inputPrice: number;
  outputPrice: number;
}> {
  if (!raw || typeof raw !== 'object') return [];
  const out: Array<{ api_id: string; inputPrice: number; outputPrice: number }> = [];
  for (const [apiId, entry] of Object.entries(raw as Record<string, RawEntry>)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.litellm_provider !== 'anthropic') continue;
    const inputCpt = Number(entry.input_cost_per_token);
    const outputCpt = Number(entry.output_cost_per_token);
    if (!Number.isFinite(inputCpt) || !Number.isFinite(outputCpt)) continue;
    out.push({
      api_id: apiId,
      inputPrice: inputCpt * 1_000_000,
      outputPrice: outputCpt * 1_000_000
    });
  }
  return out;
}

/**
 * Fetch the LiteLLM model-prices JSON and return the Anthropic models in our
 * canonical UpstreamModel shape.
 *
 * Returns null on any failure (network error, timeout, HTTP non-OK, malformed
 * JSON). Returns an empty array on a successful fetch that yielded no
 * applicable Anthropic entries — callers should treat the two cases
 * differently (null = keep existing rows untouched; [] = trust upstream
 * really has no entries today).
 */
export async function fetchLiteLLMPricing(): Promise<UpstreamModel[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(LITELLM_URL, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`LiteLLM fetch failed: HTTP ${response.status}`);
      return null;
    }
    const json: unknown = await response.json();
    const parsed = parseLiteLLM(json);
    return parsed.map((p) => {
      const displayName =
        deriveDisplayName(p.api_id) ?? p.api_id.replace(/-\d{8}$/, '');
      return {
        api_id: p.api_id,
        displayName,
        tier: inferTier(displayName),
        inputPrice: p.inputPrice,
        outputPrice: p.outputPrice
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('LiteLLM fetch error:', msg);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
