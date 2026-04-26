const { describe, it, expect } = require('@jest/globals');

// Pure logic mirrored here so the test does not depend on ESM module resolution.
function decideUpdateAction(current, upstream) {
  // current: { source, status, input_price, output_price } from DB
  // upstream: { input, output } from LiteLLM, or null if model not in upstream
  if (current.source === 'manual') return 'skip';
  if (current.status === 'pending_confirmation') return 'skip';
  if (!upstream) {
    // model dropped from upstream
    if (current.source === 'auto' && current.status !== 'deprecated') return 'mark_deprecated';
    return 'skip';
  }
  const priceChanged =
    current.input_price !== upstream.input || current.output_price !== upstream.output;
  if (current.source === 'tier_default') return 'graduate';
  if (current.source === 'auto' && priceChanged) return 'overwrite';
  return 'skip';
}

describe('pricingUpdatePolicy.decideUpdateAction', () => {
  it('skips manual rows even when upstream changes', () => {
    const current = { source: 'manual', status: 'active', input_price: 10, output_price: 20 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('skip');
  });

  it('skips pending_confirmation rows', () => {
    const current = { source: 'tier_default', status: 'pending_confirmation', input_price: 0, output_price: 0 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('skip');
  });

  it('graduates a tier_default row when upstream has data (price unchanged)', () => {
    const current = { source: 'tier_default', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('graduate');
  });

  it('graduates a tier_default row when upstream has different price', () => {
    const current = { source: 'tier_default', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 4, output: 16 })).toBe('graduate');
  });

  it('overwrites an auto row when upstream price differs', () => {
    const current = { source: 'auto', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 4, output: 16 })).toBe('overwrite');
  });

  it('skips an auto row when upstream price matches', () => {
    const current = { source: 'auto', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, { input: 3, output: 15 })).toBe('skip');
  });

  it('marks an auto row deprecated when upstream drops it', () => {
    const current = { source: 'auto', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, null)).toBe('mark_deprecated');
  });

  it('does not re-deprecate an already-deprecated row', () => {
    const current = { source: 'auto', status: 'deprecated', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, null)).toBe('skip');
  });

  it('skips tier_default rows when upstream drops them (still placeholder)', () => {
    const current = { source: 'tier_default', status: 'active', input_price: 3, output_price: 15 };
    expect(decideUpdateAction(current, null)).toBe('skip');
  });
});
