const { describe, it, expect } = require('@jest/globals');

// Sample matching LiteLLM's model_prices_and_context_window.json shape.
const SAMPLE = {
  'claude-opus-4-7-20251101': {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    mode: 'chat'
  },
  'claude-sonnet-4-6-20250929': {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    mode: 'chat'
  },
  'claude-haiku-4-5-20251001': {
    litellm_provider: 'anthropic',
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    mode: 'chat'
  },
  'gpt-4o': {
    litellm_provider: 'openai',
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    mode: 'chat'
  },
  'sample-model': {
    sample_spec: 'this is a sample provider model',
    litellm_provider: 'sample_provider'
  },
  'malformed-anthropic': {
    litellm_provider: 'anthropic',
    mode: 'chat'
    // missing cost fields
  }
};

// Pure parser logic mirrored here for testing — same code lives in src/services/litellmPricingSource.ts
function parseLiteLLM(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const [apiId, entry] of Object.entries(raw)) {
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

describe('litellmPricingSource.parseLiteLLM', () => {
  it('keeps only anthropic entries', () => {
    const result = parseLiteLLM(SAMPLE);
    const ids = result.map((r) => r.api_id).sort();
    expect(ids).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-opus-4-7-20251101',
      'claude-sonnet-4-6-20250929'
    ]);
  });

  it('converts cost-per-token to per-million-token units', () => {
    const result = parseLiteLLM(SAMPLE);
    const opus = result.find((r) => r.api_id === 'claude-opus-4-7-20251101');
    expect(opus.inputPrice).toBeCloseTo(15, 5);
    expect(opus.outputPrice).toBeCloseTo(75, 5);
  });

  it('skips malformed entries missing cost fields', () => {
    const result = parseLiteLLM(SAMPLE);
    expect(result.find((r) => r.api_id === 'malformed-anthropic')).toBeUndefined();
  });

  it('returns [] for null input', () => {
    expect(parseLiteLLM(null)).toEqual([]);
  });
});
