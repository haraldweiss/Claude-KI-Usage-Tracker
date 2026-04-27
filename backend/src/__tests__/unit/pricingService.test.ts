import { describe, it, expect } from '@jest/globals';
import { validatePricing, formatPricingResponse } from '../../services/pricingService.js';

describe('validatePricing', () => {
  it('accepts a valid pricing object', () => {
    expect(() =>
      validatePricing({ model: 'Claude 3.5 Sonnet', inputPrice: 3, outputPrice: 15 })
    ).not.toThrow();
  });

  it('rejects negative input price', () => {
    expect(() =>
      validatePricing({ model: 'Claude 3.5 Sonnet', inputPrice: -1, outputPrice: 15 })
    ).toThrow(/non-negative/);
  });

  it('rejects negative output price', () => {
    expect(() =>
      validatePricing({ model: 'Claude 3.5 Sonnet', inputPrice: 3, outputPrice: -1 })
    ).toThrow(/non-negative/);
  });

  it('rejects empty model name', () => {
    expect(() =>
      validatePricing({ model: '', inputPrice: 3, outputPrice: 15 })
    ).toThrow(/non-empty string/);
  });

  it('rejects model name with dangerous characters', () => {
    expect(() =>
      validatePricing({ model: 'foo<script>', inputPrice: 3, outputPrice: 15 })
    ).toThrow(/invalid characters/);
  });

  it('rejects unreasonably high prices', () => {
    expect(() =>
      validatePricing({ model: 'X', inputPrice: 10000, outputPrice: 15 })
    ).toThrow(/unreasonably high/);
  });

  it('rejects non-number prices', () => {
    expect(() =>
      validatePricing({ model: 'X', inputPrice: 'three' as unknown as number, outputPrice: 15 })
    ).toThrow();
  });
});

describe('formatPricingResponse', () => {
  it('formats a single record with all new fields', () => {
    const formatted = formatPricingResponse([
      {
        model: 'Claude Opus 4.7',
        input_price: 15,
        output_price: 75,
        source: 'auto',
        status: 'active',
        tier: 'opus',
        api_id: 'claude-opus-4-7-20251101',
        last_updated: '2026-04-01T00:00:00Z'
      }
    ]);
    expect(formatted['Claude Opus 4.7']).toEqual({
      inputPrice: 15,
      outputPrice: 75,
      source: 'auto',
      status: 'active',
      tier: 'opus',
      apiId: 'claude-opus-4-7-20251101',
      lastUpdated: '2026-04-01T00:00:00Z'
    });
  });

  it('skips records with no model field', () => {
    const formatted = formatPricingResponse([
      // @ts-expect-error: testing runtime guard against missing model
      { input_price: 1, output_price: 2 }
    ]);
    expect(formatted).toEqual({});
  });

  it('handles missing optional fields with defaults', () => {
    const formatted = formatPricingResponse([
      // @ts-expect-error: testing runtime defaults
      { model: 'X', input_price: 1, output_price: 2 }
    ]);
    expect(formatted.X.source).toBe('unknown');
    expect(formatted.X.status).toBe('active');
    expect(formatted.X.tier).toBeNull();
    expect(formatted.X.apiId).toBeNull();
    expect(formatted.X.lastUpdated).toBeNull();
  });

  it('throws when given non-array', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => formatPricingResponse(null)).toThrow(/must be an array/);
  });
});
