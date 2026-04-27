import { describe, it, expect } from '@jest/globals';
import { decideUpdateAction, type CurrentRow } from '../../services/pricingUpdatePolicy.js';

const row = (overrides: Partial<CurrentRow>): CurrentRow => ({
  source: 'auto',
  status: 'active',
  input_price: 3,
  output_price: 15,
  ...overrides
});

describe('decideUpdateAction', () => {
  it('skips manual rows even when upstream changes', () => {
    expect(decideUpdateAction(row({ source: 'manual' }), { input: 99, output: 99 })).toBe('skip');
  });

  it('skips pending_confirmation rows regardless of source', () => {
    expect(
      decideUpdateAction(row({ source: 'tier_default', status: 'pending_confirmation' }), { input: 3, output: 15 })
    ).toBe('skip');
  });

  it('graduates a tier_default row when upstream has data (price unchanged)', () => {
    expect(decideUpdateAction(row({ source: 'tier_default' }), { input: 3, output: 15 })).toBe('graduate');
  });

  it('graduates a tier_default row when upstream has different price', () => {
    expect(decideUpdateAction(row({ source: 'tier_default' }), { input: 4, output: 16 })).toBe('graduate');
  });

  it('overwrites an auto row when upstream price differs', () => {
    expect(decideUpdateAction(row({ source: 'auto' }), { input: 4, output: 16 })).toBe('overwrite');
  });

  it('skips an auto row when upstream price matches', () => {
    expect(decideUpdateAction(row({ source: 'auto' }), { input: 3, output: 15 })).toBe('skip');
  });

  it('marks an auto row deprecated when upstream drops it', () => {
    expect(decideUpdateAction(row({ source: 'auto' }), null)).toBe('mark_deprecated');
  });

  it('does not re-deprecate an already-deprecated row', () => {
    expect(decideUpdateAction(row({ source: 'auto', status: 'deprecated' }), null)).toBe('skip');
  });

  it('skips tier_default rows when upstream drops them (still placeholder)', () => {
    expect(decideUpdateAction(row({ source: 'tier_default' }), null)).toBe('skip');
  });
});
