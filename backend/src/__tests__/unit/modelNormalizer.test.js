const { describe, it, expect } = require('@jest/globals');

// Pure-function helpers — these will live in src/services/modelNormalizer.ts
// and the test exercises the same logic to keep imports out of the ESM/Jest dance.

const TIER_KEYWORDS = ['haiku', 'sonnet', 'opus'];

function inferTier(name) {
  if (!name || typeof name !== 'string') return 'other';
  const lower = name.toLowerCase();
  for (const t of TIER_KEYWORDS) {
    if (lower.includes(t)) return t;
  }
  return 'other';
}

function deriveDisplayName(apiId) {
  if (!apiId || typeof apiId !== 'string') return null;
  // claude-opus-4-7-20251101 → Claude Opus 4.7
  // claude-3-5-sonnet-20240620 → Claude 3.5 Sonnet
  const match = apiId.match(/^claude-([a-z0-9-]+?)(?:-\d{8})?$/i);
  if (!match) return null;
  const tail = match[1];
  const tier = TIER_KEYWORDS.find((t) => tail.toLowerCase().includes(t));
  if (!tier) return null;
  // Find the version segment around the tier name
  const parts = tail.split('-');
  const tierIdx = parts.findIndex((p) => p.toLowerCase() === tier);
  if (tierIdx === -1) return null;
  const versionParts = parts.slice(0, tierIdx).concat(parts.slice(tierIdx + 1));
  // Group runs of digits into version like "4-7" → "4.7", "3-5" → "3.5"
  const version = versionParts.join('.').replace(/^\.+|\.+$/g, '');
  const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
  // claude-3-5-sonnet → "3.5 Sonnet" → "Claude 3.5 Sonnet"
  // claude-opus-4-7  → "Opus 4.7"   → "Claude Opus 4.7"
  // Heuristic: if version comes BEFORE tier in original, render "Claude {ver} {Tier}";
  // if AFTER, render "Claude {Tier} {ver}".
  const versionFirst = tierIdx > 0 && /^\d/.test(parts[0]);
  const formatted = versionFirst ? `Claude ${version} ${cap}` : `Claude ${cap} ${version}`;
  return formatted.replace(/\s+/g, ' ').trim();
}

function tierDefaultPrice(tier, knownRows) {
  if (!tier || tier === 'other') return null;
  const candidates = knownRows.filter((r) => r.tier === tier);
  if (candidates.length === 0) return null;
  // pick most recent by last_updated (string comparison works for ISO timestamps)
  candidates.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
  const top = candidates[0];
  return { input: top.input_price, output: top.output_price };
}

describe('modelNormalizer', () => {
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
    it('returns other for empty input', () => {
      expect(inferTier('')).toBe('other');
      expect(inferTier(null)).toBe('other');
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
    });
  });

  describe('tierDefaultPrice', () => {
    const rows = [
      { model: 'Claude 3.5 Sonnet', tier: 'sonnet', input_price: 3, output_price: 15, last_updated: '2026-01-01T00:00:00Z' },
      { model: 'Claude Sonnet 4.6', tier: 'sonnet', input_price: 3, output_price: 15, last_updated: '2026-04-01T00:00:00Z' },
      { model: 'Claude 3.5 Haiku', tier: 'haiku', input_price: 0.8, output_price: 4, last_updated: '2026-02-01T00:00:00Z' }
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
});
