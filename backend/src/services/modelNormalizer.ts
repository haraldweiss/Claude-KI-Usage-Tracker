export type Tier = 'haiku' | 'sonnet' | 'opus' | 'other';

export interface PricingRow {
  model: string;
  api_id?: string | null;
  tier?: string | null;
  input_price: number;
  output_price: number;
  last_updated?: string | null;
  source?: string;
  status?: string;
}

const TIER_KEYWORDS: Tier[] = ['haiku', 'sonnet', 'opus'];
const VALID_TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'other'];

function coerceTier(raw: unknown, fallbackName: string): Tier {
  if (typeof raw === 'string' && (VALID_TIERS as readonly string[]).includes(raw)) {
    return raw as Tier;
  }
  return inferTier(fallbackName);
}

export function inferTier(name: string | null | undefined): Tier {
  if (!name || typeof name !== 'string') return 'other';
  const lower = name.toLowerCase();
  for (const t of TIER_KEYWORDS) {
    if (lower.includes(t)) return t;
  }
  return 'other';
}

export function deriveDisplayName(apiId: string | null | undefined): string | null {
  if (!apiId || typeof apiId !== 'string') return null;
  const match = apiId.match(/^claude-([a-z0-9-]+?)(?:-\d{8})?$/i);
  if (!match || !match[1]) return null;
  const tail = match[1];
  const tier = TIER_KEYWORDS.find((t) => tail.toLowerCase().includes(t));
  if (!tier) return null;
  const parts = tail.split('-');
  const tierIdx = parts.findIndex((p) => p.toLowerCase() === tier);
  if (tierIdx === -1) return null;
  const versionParts = parts.slice(0, tierIdx).concat(parts.slice(tierIdx + 1));
  const version = versionParts.join('.').replace(/^\.+|\.+$/g, '');
  const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
  const versionFirst = tierIdx > 0 && /^\d/.test(parts[0] ?? '');
  const formatted = versionFirst ? `Claude ${version} ${cap}` : `Claude ${cap} ${version}`;
  return formatted.replace(/\s+/g, ' ').trim();
}

export function tierDefaultPrice(
  tier: Tier,
  knownRows: PricingRow[]
): { input: number; output: number } | null {
  if (!tier || tier === 'other') return null;
  const candidates = knownRows.filter((r) => r.tier === tier);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''));
  const top = candidates[0]!;
  return { input: top.input_price, output: top.output_price };
}

export interface NormalizedModel {
  displayName: string;
  apiId: string | null;
  tier: Tier;
}

/**
 * Resolve an incoming model identifier (display name OR API ID) to a canonical
 * record. Looks for a matching pricing row first; falls back to deriving a name
 * from the API ID; otherwise echoes the raw string back as the display name.
 */
export function normalizeIncomingModel(
  raw: string,
  knownRows: PricingRow[]
): NormalizedModel {
  const trimmed = (raw || '').trim();
  // 1. Exact display-name match in DB
  const byName = knownRows.find((r) => r.model === trimmed);
  if (byName) {
    return {
      displayName: byName.model,
      apiId: byName.api_id ?? null,
      tier: coerceTier(byName.tier, byName.model)
    };
  }
  // 2. API ID match in DB
  const byId = knownRows.find((r) => r.api_id && r.api_id === trimmed);
  if (byId) {
    return {
      displayName: byId.model,
      apiId: byId.api_id ?? null,
      tier: coerceTier(byId.tier, byId.model)
    };
  }
  // 3. Looks like an API ID — derive display name
  if (/^claude-/i.test(trimmed)) {
    const derived = deriveDisplayName(trimmed);
    if (derived) {
      return { displayName: derived, apiId: trimmed, tier: inferTier(derived) };
    }
  }
  // 4. Fallback — echo back as display name, no API ID
  return { displayName: trimmed, apiId: null, tier: inferTier(trimmed) };
}
