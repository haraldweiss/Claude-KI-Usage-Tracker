// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from 'vitest';

// Helper function to test (matches implementation)
const INSIGHT_CONFIDENCE_TIERS = {
  early: 3,
  actionable: 7,
  confident: 14
} as const;

type ConfidenceLevel = keyof typeof INSIGHT_CONFIDENCE_TIERS;

function getConfidenceLevel(daysTracked: number): ConfidenceLevel {
  if (!Number.isFinite(daysTracked) || daysTracked < 0 || !Number.isInteger(daysTracked)) {
    throw new Error(`Invalid daysTracked value: ${daysTracked}. Must be a non-negative integer.`);
  }
  if (daysTracked >= INSIGHT_CONFIDENCE_TIERS.confident) {
    return 'confident';
  }
  if (daysTracked >= INSIGHT_CONFIDENCE_TIERS.actionable) {
    return 'actionable';
  }
  return 'early';
}

describe('getConfidenceLevel', () => {
  it('returns "early" for day 0', () => {
    expect(getConfidenceLevel(0)).toBe('early');
  });

  it('returns "early" for day 1', () => {
    expect(getConfidenceLevel(1)).toBe('early');
  });

  it('returns "early" for day 2', () => {
    expect(getConfidenceLevel(2)).toBe('early');
  });

  it('returns "early" for day 3 (boundary case)', () => {
    expect(getConfidenceLevel(3)).toBe('early');
  });

  it('returns "early" for days 4-6', () => {
    expect(getConfidenceLevel(4)).toBe('early');
    expect(getConfidenceLevel(5)).toBe('early');
    expect(getConfidenceLevel(6)).toBe('early');
  });

  it('returns "actionable" for day 7 (boundary case)', () => {
    expect(getConfidenceLevel(7)).toBe('actionable');
  });

  it('returns "actionable" for days 8-13', () => {
    expect(getConfidenceLevel(8)).toBe('actionable');
    expect(getConfidenceLevel(10)).toBe('actionable');
    expect(getConfidenceLevel(13)).toBe('actionable');
  });

  it('returns "confident" for day 14 (boundary case)', () => {
    expect(getConfidenceLevel(14)).toBe('confident');
  });

  it('returns "confident" for days 15+', () => {
    expect(getConfidenceLevel(15)).toBe('confident');
    expect(getConfidenceLevel(20)).toBe('confident');
    expect(getConfidenceLevel(100)).toBe('confident');
  });

  it('throws error for negative numbers', () => {
    expect(() => getConfidenceLevel(-1)).toThrow();
    expect(() => getConfidenceLevel(-100)).toThrow();
  });

  it('throws error for NaN', () => {
    expect(() => getConfidenceLevel(NaN)).toThrow();
  });

  it('throws error for Infinity', () => {
    expect(() => getConfidenceLevel(Infinity)).toThrow();
    expect(() => getConfidenceLevel(-Infinity)).toThrow();
  });

  it('throws error for non-integer values', () => {
    expect(() => getConfidenceLevel(3.5)).toThrow();
    expect(() => getConfidenceLevel(7.1)).toThrow();
  });

  it('handles exact boundary cases correctly', () => {
    // Day before each threshold
    expect(getConfidenceLevel(2)).toBe('early');
    expect(getConfidenceLevel(6)).toBe('early');
    expect(getConfidenceLevel(13)).toBe('actionable');

    // Exact threshold
    expect(getConfidenceLevel(3)).toBe('early');
    expect(getConfidenceLevel(7)).toBe('actionable');
    expect(getConfidenceLevel(14)).toBe('confident');

    // Day after each threshold
    expect(getConfidenceLevel(4)).toBe('early');
    expect(getConfidenceLevel(8)).toBe('actionable');
    expect(getConfidenceLevel(15)).toBe('confident');
  });
});
