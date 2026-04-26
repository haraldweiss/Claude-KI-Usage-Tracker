import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getQuery, allQuery, runQuery } from '../database/sqlite.js';
import { fetchLiteLLMPricing, type UpstreamModel } from './litellmPricingSource.js';
import { decideUpdateAction } from './pricingUpdatePolicy.js';
import { inferTier } from './modelNormalizer.js';
import type { PricingUpdateResult, RecalculateCostsResult } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = join(__dirname, '../data/pricing-fallback.json');

interface PricingRecord {
  model: string;
  input_price: number;
  output_price: number;
  source: string;
  status: string;
  tier: string | null;
  api_id: string | null;
  last_updated?: string;
}

interface PricingInput {
  model: string;
  inputPrice: number;
  outputPrice: number;
}

interface FormattedPricing {
  [key: string]: {
    inputPrice: number;
    outputPrice: number;
    source: string;
    status: string;
    tier: string | null;
    apiId: string | null;
    lastUpdated: string | null;
  };
}

interface UsageRecord {
  id: number;
  input_tokens: number;
  output_tokens: number;
}

export function validatePricing(pricing: PricingInput): boolean {
  if (!pricing || typeof pricing !== 'object') {
    throw new Error('Pricing must be an object');
  }
  const { model, inputPrice, outputPrice } = pricing;
  if (!model || typeof model !== 'string') {
    throw new Error('Model must be a non-empty string');
  }
  const dangerousPatterns = ['<', '>', '"', '\'', '&', ';', '\\', '/*', '*/'];
  if (dangerousPatterns.some((p) => model.includes(p))) {
    throw new Error('Model name contains invalid characters');
  }
  if (typeof inputPrice !== 'number' || inputPrice < 0) {
    throw new Error('Input price must be a non-negative number');
  }
  if (typeof outputPrice !== 'number' || outputPrice < 0) {
    throw new Error('Output price must be a non-negative number');
  }
  if (inputPrice > 1000 || outputPrice > 1000) {
    throw new Error('Price values seem unreasonably high (max 1000)');
  }
  return true;
}

export function formatPricingResponse(pricingRecords: PricingRecord[]): FormattedPricing {
  if (!Array.isArray(pricingRecords)) throw new Error('Pricing records must be an array');
  const formatted: FormattedPricing = {};
  for (const record of pricingRecords) {
    if (!record || typeof record !== 'object' || !record.model) continue;
    formatted[record.model] = {
      inputPrice: parseFloat(String(record.input_price)) || 0,
      outputPrice: parseFloat(String(record.output_price)) || 0,
      source: record.source || 'unknown',
      status: record.status || 'active',
      tier: record.tier ?? null,
      apiId: record.api_id ?? null,
      lastUpdated: record.last_updated || null
    };
  }
  return formatted;
}

/**
 * Insert or update a pricing row. Used by manual edits, the LiteLLM fetch,
 * and the extension auto-detect path. Caller decides `source`/`status`.
 */
export async function upsertPricing(args: {
  model: string;
  inputPrice: number;
  outputPrice: number;
  source: string;
  status?: string;
  tier?: string | null;
  apiId?: string | null;
}): Promise<PricingUpdateResult> {
  const { model, inputPrice, outputPrice, source } = args;
  const status = args.status ?? 'active';
  const tier = args.tier ?? inferTier(model);
  const apiId = args.apiId ?? null;
  const existing = (await getQuery(
    'SELECT * FROM pricing WHERE model = ?',
    [model]
  )) as PricingRecord | undefined;

  if (existing) {
    await runQuery(
      `UPDATE pricing
         SET input_price = ?, output_price = ?, source = ?, status = ?, tier = ?,
             api_id = COALESCE(?, api_id), last_updated = CURRENT_TIMESTAMP
       WHERE model = ?`,
      [inputPrice, outputPrice, source, status, tier, apiId, model]
    );
  } else {
    await runQuery(
      `INSERT INTO pricing (model, input_price, output_price, source, status, tier, api_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [model, inputPrice, outputPrice, source, status, tier, apiId]
    );
  }
  return {
    success: true,
    model,
    newPricing: { input_price: inputPrice, output_price: outputPrice }
  };
}

/**
 * Backwards-compatible signature for the existing PUT /api/pricing/:model endpoint.
 * Marks the row as manually-set.
 */
export async function updatePricingInDB(
  model: string,
  inputPrice: number,
  outputPrice: number
): Promise<PricingUpdateResult> {
  return upsertPricing({
    model,
    inputPrice,
    outputPrice,
    source: 'manual',
    status: 'active'
  });
}

interface FallbackFile {
  models: Array<{
    api_id: string;
    displayName: string;
    tier: string;
    inputPrice: number;
    outputPrice: number;
  }>;
}

/**
 * Seed the pricing table from the bundled fallback JSON when the table is empty.
 * Called on server startup.
 */
export async function seedFromFallbackIfEmpty(): Promise<void> {
  const countRow = (await getQuery('SELECT COUNT(*) as count FROM pricing')) as
    | { count: number }
    | undefined;
  if (countRow && countRow.count > 0) return;
  try {
    const raw = await readFile(FALLBACK_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as FallbackFile;
    for (const m of parsed.models) {
      await upsertPricing({
        model: m.displayName,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        source: 'auto',
        status: 'active',
        tier: m.tier,
        apiId: m.api_id
      });
    }
    console.log(`Seeded ${parsed.models.length} pricing rows from fallback`);
  } catch (err) {
    console.error('Failed to seed pricing from fallback:', (err as Error).message);
  }
}

export async function checkAndUpdatePricing(): Promise<boolean> {
  const upstream = await fetchLiteLLMPricing();
  if (!upstream) {
    console.log('LiteLLM fetch returned null — skipping update cycle');
    return false;
  }

  // Index upstream by display name (canonical key in our DB)
  const upstreamByName = new Map<string, UpstreamModel>();
  for (const m of upstream) upstreamByName.set(m.displayName, m);

  const current = (await allQuery('SELECT * FROM pricing')) as PricingRecord[];
  const currentByName = new Map(current.map((r) => [r.model, r]));

  let changed = false;

  // 1. Apply updates to existing rows
  for (const row of current) {
    const up = upstreamByName.get(row.model) ?? null;
    const action = decideUpdateAction(row, up ? { input: up.inputPrice, output: up.outputPrice } : null);
    if (action === 'skip') continue;
    if (action === 'mark_deprecated') {
      await runQuery(
        "UPDATE pricing SET status = 'deprecated', last_updated = CURRENT_TIMESTAMP WHERE model = ?",
        [row.model]
      );
      console.log(`Marked deprecated: ${row.model}`);
      changed = true;
      continue;
    }
    if (up && (action === 'overwrite' || action === 'graduate')) {
      await upsertPricing({
        model: row.model,
        inputPrice: up.inputPrice,
        outputPrice: up.outputPrice,
        source: 'auto',
        status: 'active',
        tier: up.tier,
        apiId: up.api_id
      });
      console.log(`${action} ${row.model}: ${up.inputPrice}/${up.outputPrice}`);
      await recalculateCosts(row.model);
      changed = true;
    }
  }

  // 2. Insert new upstream models that aren't in our DB yet
  for (const m of upstream) {
    if (currentByName.has(m.displayName)) continue;
    await upsertPricing({
      model: m.displayName,
      inputPrice: m.inputPrice,
      outputPrice: m.outputPrice,
      source: 'auto',
      status: 'active',
      tier: m.tier,
      apiId: m.api_id
    });
    console.log(`Added new model from upstream: ${m.displayName}`);
    changed = true;
  }

  return changed;
}

export async function recalculateCosts(model: string): Promise<RecalculateCostsResult> {
  try {
    const records = (await allQuery(
      `SELECT id, input_tokens, output_tokens FROM usage_records
       WHERE model = ? AND datetime(timestamp) >= datetime('now', '-30 days')`,
      [model]
    )) as UsageRecord[];
    const pricing = (await getQuery(
      'SELECT * FROM pricing WHERE model = ?',
      [model]
    )) as PricingRecord | undefined;
    if (pricing && records.length > 0) {
      for (const r of records) {
        const cost =
          (r.input_tokens * pricing.input_price + r.output_tokens * pricing.output_price) /
          1_000_000;
        await runQuery('UPDATE usage_records SET cost = ? WHERE id = ?', [cost, r.id]);
      }
      console.log(`Recalculated costs for ${records.length} records of ${model}`);
    }
    return {
      success: true,
      model,
      recordsUpdated: records.length,
      message: `Recalculated costs for ${records.length} records`
    };
  } catch (error) {
    console.error('Error recalculating costs:', error);
    throw error;
  }
}

export async function getAllPricing(): Promise<PricingRecord[]> {
  try {
    return (await allQuery('SELECT * FROM pricing ORDER BY model ASC')) as PricingRecord[];
  } catch (error) {
    console.error('Error getting pricing:', error);
    return [];
  }
}

export function schedulePricingCheck(cronJob: any): void {
  try {
    cronJob.schedule('0 2 * * *', async () => {
      console.log('Running scheduled pricing check...');
      const updated = await checkAndUpdatePricing();
      console.log(updated ? 'Pricing was updated' : 'No pricing changes detected');
    });
    console.log('Pricing check scheduled for daily at 2 AM');
  } catch (error) {
    console.error('Error scheduling pricing check:', error);
  }
}

// Exported for legacy callers; now delegates to the LiteLLM source.
export async function fetchLatestPricing(): Promise<UpstreamModel[] | null> {
  return fetchLiteLLMPricing();
}
