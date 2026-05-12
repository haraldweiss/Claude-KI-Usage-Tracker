// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect } from 'vitest';
import { getConfidenceLevel } from '../InsightsBlock';

describe('getConfidenceLevel', () => {
  describe('returns "early" for days 0-6', () => {
    it.each([0, 1, 2, 3, 4, 5, 6])('returns "early" for day %i', (day) => {
      expect(getConfidenceLevel(day)).toBe('early');
    });
  });

  describe('returns "actionable" for days 7-13', () => {
    it.each([7, 8, 10, 13])('returns "actionable" for day %i', (day) => {
      expect(getConfidenceLevel(day)).toBe('actionable');
    });
  });

  describe('returns "confident" for days 14+', () => {
    it.each([14, 15, 20, 100])('returns "confident" for day %i', (day) => {
      expect(getConfidenceLevel(day)).toBe('confident');
    });
  });

  describe('throws error for invalid inputs', () => {
    it.each([-1, -100])('throws error for negative number %i', (value) => {
      expect(() => getConfidenceLevel(value)).toThrow();
    });

    it.each([NaN])('throws error for NaN', () => {
      expect(() => getConfidenceLevel(NaN)).toThrow();
    });

    it.each([Infinity, -Infinity])('throws error for Infinity (%i)', (value) => {
      expect(() => getConfidenceLevel(value)).toThrow();
    });

    it.each([3.5, 7.1])('throws error for non-integer %f', (value) => {
      expect(() => getConfidenceLevel(value)).toThrow();
    });
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
