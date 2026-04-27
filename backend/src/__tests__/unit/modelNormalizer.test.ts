import { describe, it, expect } from '@jest/globals';
import {
  inferTier,
  deriveDisplayName,
  tierDefaultPrice,
  normalizeIncomingModel,
  type PricingRow
} from '../../services/modelNormalizer.js';

describe('inferTier', () => {
  it('returns haiku for Claude 3.5 Haiku', () => {
    expect(inferTier('Claude 3.5 Haiku')).toBe('haiku');
  });
  it('returns sonnet for Claude Sonnet 4.6', () => {
    expect(inferTier('Claude Sonnet 4.6')).toBe('sonnet');
  });
  it('returns opus for claude-opus-4-7-20251101', () => {
    expect(inferTier('claude-opus-4-7-20251101')).toBe('opus');
  });
  it('returns other for unknown name', () => {
    expect(inferTier('gpt-4')).toBe('other');
  });
  it('returns other for empty/null input', () => {
    expect(inferTier('')).toBe('other');
    expect(inferTier(null)).toBe('other');
    expect(inferTier(undefined)).toBe('other');
  });
});

describe('deriveDisplayName', () => {
  it('formats claude-opus-4-7-20251101 as Claude Opus 4.7', () => {
    expect(deriveDisplayName('claude-opus-4-7-20251101')).toBe('Claude Opus 4.7');
  });
  it('formats claude-3-5-sonnet-20240620 as Claude 3.5 Sonnet', () => {
    expect(deriveDisplayName('claude-3-5-sonnet-20240620')).toBe('Claude 3.5 Sonnet');
  });
  it('formats claude-haiku-4-5 as Claude Haiku 4.5', () => {
    expect(deriveDisplayName('claude-haiku-4-5')).toBe('Claude Haiku 4.5');
  });
  it('returns null for non-claude id', () => {
    expect(deriveDisplayName('gpt-4-turbo')).toBeNull();
  });
  it('returns null for empty input', () => {
    expect(deriveDisplayName('')).toBeNull();
    expect(deriveDisplayName(null)).toBeNull();
  });
});

describe('tierDefaultPrice', () => {
  const rows: PricingRow[] = [
    {
      model: 'Claude 3.5 Sonnet',
      tier: 'sonnet',
      input_price: 3,
      output_price: 15,
      last_updated: '2026-01-01T00:00:00Z'
    },
    {
      model: 'Claude Sonnet 4.6',
      tier: 'sonnet',
      input_price: 3,
      output_price: 15,
      last_updated: '2026-04-01T00:00:00Z'
    },
    {
      model: 'Claude 3.5 Haiku',
      tier: 'haiku',
      input_price: 0.8,
      output_price: 4,
      last_updated: '2026-02-01T00:00:00Z'
    }
  ];

  it('returns most recent sonnet pricing', () => {
    expect(tierDefaultPrice('sonnet', rows)).toEqual({ input: 3, output: 15 });
  });
  it('returns haiku pricing', () => {
    expect(tierDefaultPrice('haiku', rows)).toEqual({ input: 0.8, output: 4 });
  });
  it('returns null when no candidates', () => {
    expect(tierDefaultPrice('opus', rows)).toBeNull();
  });
  it('returns null for tier=other', () => {
    expect(tierDefaultPrice('other', rows)).toBeNull();
  });
});

describe('normalizeIncomingModel', () => {
  const knownRows: PricingRow[] = [
    {
      model: 'Claude 3.5 Sonnet',
      api_id: 'claude-3-5-sonnet-20240620',
      tier: 'sonnet',
      input_price: 3,
      output_price: 15,
      last_updated: '2026-01-01T00:00:00Z'
    }
  ];

  it('matches by exact display name', () => {
    const result = normalizeIncomingModel('Claude 3.5 Sonnet', knownRows);
    expect(result.displayName).toBe('Claude 3.5 Sonnet');
    expect(result.apiId).toBe('claude-3-5-sonnet-20240620');
    expect(result.tier).toBe('sonnet');
  });

  it('matches by api_id', () => {
    const result = normalizeIncomingModel('claude-3-5-sonnet-20240620', knownRows);
    expect(result.displayName).toBe('Claude 3.5 Sonnet');
    expect(result.apiId).toBe('claude-3-5-sonnet-20240620');
    expect(result.tier).toBe('sonnet');
  });

  it('derives display name from unknown claude API id', () => {
    const result = normalizeIncomingModel('claude-opus-4-7-20251101', knownRows);
    expect(result.displayName).toBe('Claude Opus 4.7');
    expect(result.apiId).toBe('claude-opus-4-7-20251101');
    expect(result.tier).toBe('opus');
  });

  it('falls back to echoing the raw string when nothing matches', () => {
    const result = normalizeIncomingModel('some-random-thing', knownRows);
    expect(result.displayName).toBe('some-random-thing');
    expect(result.apiId).toBeNull();
    expect(result.tier).toBe('other');
  });

  it('falls back to inferTier when DB row has invalid tier value', () => {
    const dirtyRows: PricingRow[] = [
      {
        model: 'Custom Sonnet Variant',
        api_id: null,
        tier: 'bogus-tier',
        input_price: 1,
        output_price: 2,
        last_updated: '2026-01-01T00:00:00Z'
      }
    ];
    const result = normalizeIncomingModel('Custom Sonnet Variant', dirtyRows);
    expect(result.tier).toBe('sonnet');
  });
});
