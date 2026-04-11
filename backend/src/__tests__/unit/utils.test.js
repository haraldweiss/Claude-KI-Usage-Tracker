const { describe, it, expect } = require('@jest/globals');

describe('Token Calculation Utilities', () => {
  // Mock implementation for testing
  const calculateCost = (inputTokens, outputTokens, inputPrice, outputPrice) => {
    if (inputTokens < 0 || outputTokens < 0) {
      throw new Error('Token counts cannot be negative');
    }
    const inputCost = (inputTokens * inputPrice) / 1_000_000;
    const outputCost = (outputTokens * outputPrice) / 1_000_000;
    return inputCost + outputCost;
  };

  const parsePeriodToDays = (period) => {
    const periods = { day: 1, week: 7, month: 30 };
    if (!periods[period]) {
      throw new Error(`Invalid period: ${period}`);
    }
    return periods[period];
  };

  describe('calculateCost', () => {
    it('should calculate cost from tokens and prices', () => {
      const cost = calculateCost(1000, 500, 3, 15);
      expect(cost).toBeCloseTo(0.0105, 5);
    });

    it('should handle zero tokens', () => {
      const cost = calculateCost(0, 0, 3, 15);
      expect(cost).toBe(0);
    });

    it('should throw error on negative input tokens', () => {
      expect(() => calculateCost(-100, 500, 3, 15)).toThrow();
    });

    it('should throw error on negative output tokens', () => {
      expect(() => calculateCost(1000, -500, 3, 15)).toThrow();
    });

    it('should handle large numbers', () => {
      const cost = calculateCost(1000000, 500000, 3, 15);
      expect(cost).toBeCloseTo(10.5, 1);
    });
  });

  describe('parsePeriodToDays', () => {
    it('should convert day to 1', () => {
      expect(parsePeriodToDays('day')).toBe(1);
    });

    it('should convert week to 7', () => {
      expect(parsePeriodToDays('week')).toBe(7);
    });

    it('should convert month to 30', () => {
      expect(parsePeriodToDays('month')).toBe(30);
    });

    it('should throw error on invalid period', () => {
      expect(() => parsePeriodToDays('invalid')).toThrow();
    });

    it('should throw error on empty period', () => {
      expect(() => parsePeriodToDays('')).toThrow();
    });

    it('should throw error on null period', () => {
      expect(() => parsePeriodToDays(null)).toThrow();
    });
  });
});