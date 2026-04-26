import { deriveDisplayName, inferTier } from './modelNormalizer.js';
const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const FETCH_TIMEOUT_MS = 10000;
export function parseLiteLLM(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const out = [];
    for (const [apiId, entry] of Object.entries(raw)) {
        if (!entry || typeof entry !== 'object')
            continue;
        if (entry.litellm_provider !== 'anthropic')
            continue;
        const inputCpt = Number(entry.input_cost_per_token);
        const outputCpt = Number(entry.output_cost_per_token);
        if (!Number.isFinite(inputCpt) || !Number.isFinite(outputCpt))
            continue;
        out.push({
            api_id: apiId,
            inputPrice: inputCpt * 1000000,
            outputPrice: outputCpt * 1000000
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
export async function fetchLiteLLMPricing() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(LITELLM_URL, { signal: controller.signal });
        if (!response.ok) {
            console.warn(`LiteLLM fetch failed: HTTP ${response.status}`);
            return null;
        }
        const json = await response.json();
        const parsed = parseLiteLLM(json);
        return parsed.map((p) => {
            const displayName = deriveDisplayName(p.api_id) ?? p.api_id.replace(/-\d{8}$/, '');
            return {
                api_id: p.api_id,
                displayName,
                tier: inferTier(displayName),
                inputPrice: p.inputPrice,
                outputPrice: p.outputPrice
            };
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('LiteLLM fetch error:', msg);
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=litellmPricingSource.js.map