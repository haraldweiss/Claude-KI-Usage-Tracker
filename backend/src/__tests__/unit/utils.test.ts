import { describe, it, expect } from '@jest/globals';
import { calculateCost, parsePeriodToDays } from '../../utils/calculations.js';

describe('calculateCost', () => {
  it('computes cost for typical request', () => {
    expect(calculateCost(1000, 500, 3, 15)).toBeCloseTo(0.0105, 6);
  });

  it('returns 0 when both token counts are zero', () => {
    expect(calculateCost(0, 0, 3, 15)).toBe(0);
  });

  it('throws on negative input tokens', () => {
    expect(() => calculateCost(-1, 0, 3, 15)).toThrow(/negative/);
  });

  it('throws on negative output tokens', () => {
    expect(() => calculateCost(0, -1, 3, 15)).toThrow(/negative/);
  });
});

describe('parsePeriodToDays', () => {
  it('returns 1 for day', () => {
    expect(parsePeriodToDays('day')).toBe(1);
  });

  it('returns 7 for week', () => {
    expect(parsePeriodToDays('week')).toBe(7);
  });

  it('returns 30 for month', () => {
    expect(parsePeriodToDays('month')).toBe(30);
  });

  it('throws on unknown period', () => {
    expect(() => parsePeriodToDays('year')).toThrow(/Invalid period/);
  });
});
