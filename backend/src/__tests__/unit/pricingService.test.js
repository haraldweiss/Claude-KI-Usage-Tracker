const { describe, it, expect } = require('@jest/globals');

describe('Pricing Service Utilities', () => {
  const validatePricing = (pricing) => {
    if (pricing.input_price === undefined || pricing.input_price === null) {
      throw new Error('input_price is required');
    }
    if (pricing.output_price === undefined || pricing.output_price === null) {
      throw new Error('output_price is required');
    }
    if (typeof pricing.input_price !== 'number' || typeof pricing.output_price !== 'number') {
      throw new Error('Prices must be numbers');
    }
    if (pricing.input_price < 0 || pricing.output_price < 0) {
      throw new Error('Prices must be non-negative');
    }
  };

  const formatPricingResponse = (pricing) => {
    return {
      model: pricing.model,
      input_price: pricing.input_price,
      output_price: pricing.output_price,
      last_updated: pricing.last_updated,
      source: pricing.source
    };
  };

  describe('validatePricing', () => {
    it('should validate correct pricing object', () => {
      const pricing = { input_price: 3.0, output_price: 15.0 };
      expect(() => validatePricing(pricing)).not.toThrow();
    });

    it('should reject negative input price', () => {
      const pricing = { input_price: -3.0, output_price: 15.0 };
      expect(() => validatePricing(pricing)).toThrow('Prices must be non-negative');
    });

    it('should reject negative output price', () => {
      const pricing = { input_price: 3.0, output_price: -15.0 };
      expect(() => validatePricing(pricing)).toThrow('Prices must be non-negative');
    });

    it('should reject missing input_price', () => {
      const pricing = { input_price: undefined, output_price: 15.0 };
      expect(() => validatePricing(pricing)).toThrow('input_price is required');
    });

    it('should reject missing output_price', () => {
      const pricing = { input_price: 3.0 };
      expect(() => validatePricing(pricing)).toThrow('output_price is required');
    });

    it('should accept zero prices', () => {
      const pricing = { input_price: 0, output_price: 0 };
      expect(() => validatePricing(pricing)).not.toThrow();
    });

    it('should accept large prices', () => {
      const pricing = { input_price: 100.5, output_price: 500.75 };
      expect(() => validatePricing(pricing)).not.toThrow();
    });
  });

  describe('formatPricingResponse', () => {
    it('should format pricing with correct structure', () => {
      const pricing = {
        id: 1,
        model: 'claude-3-sonnet',
        input_price: 3.0,
        output_price: 15.0,
        last_updated: '2026-04-11T10:00:00Z',
        source: 'manual'
      };

      const formatted = formatPricingResponse(pricing);
      expect(formatted).toEqual({
        model: 'claude-3-sonnet',
        input_price: 3.0,
        output_price: 15.0,
        last_updated: '2026-04-11T10:00:00Z',
        source: 'manual'
      });
    });

    it('should exclude id from response', () => {
      const pricing = {
        id: 1,
        model: 'claude-3-haiku',
        input_price: 0.8,
        output_price: 4.0,
        last_updated: '2026-04-11T10:00:00Z',
        source: 'auto'
      };

      const formatted = formatPricingResponse(pricing);
      expect(formatted).not.toHaveProperty('id');
    });

    it('should handle missing optional fields', () => {
      const pricing = {
        model: 'claude-3-opus',
        input_price: 15.0,
        output_price: 75.0
      };

      const formatted = formatPricingResponse(pricing);
      expect(formatted).toHaveProperty('model');
      expect(formatted).toHaveProperty('input_price');
      expect(formatted).toHaveProperty('output_price');
    });
  });
});