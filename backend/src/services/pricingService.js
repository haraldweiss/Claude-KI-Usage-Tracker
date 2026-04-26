import { getQuery, allQuery, runQuery } from '../database/sqlite.js';
import { fetchLiteLLMPricing } from './litellmPricingSource.js';
import { decideUpdateAction } from './pricingUpdatePolicy.js';
import { inferTier } from './modelNormalizer.js';
import { pricingFallback } from '../data/pricing-fallback.js';
export function validatePricing(pricing) {
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
export function formatPricingResponse(pricingRecords) {
    if (!Array.isArray(pricingRecords))
        throw new Error('Pricing records must be an array');
    const formatted = {};
    for (const record of pricingRecords) {
        if (!record || typeof record !== 'object' || !record.model)
            continue;
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
export async function upsertPricing(args) {
    const { model, inputPrice, outputPrice, source } = args;
    const status = args.status ?? 'active';
    const tier = args.tier ?? inferTier(model);
    const apiId = args.apiId ?? null;
    await runQuery(`INSERT INTO pricing (model, input_price, output_price, source, status, tier, api_id, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(model) DO UPDATE SET
       input_price = excluded.input_price,
       output_price = excluded.output_price,
       source = excluded.source,
       status = excluded.status,
       tier = excluded.tier,
       api_id = COALESCE(excluded.api_id, pricing.api_id),
       last_updated = CURRENT_TIMESTAMP`, [model, inputPrice, outputPrice, source, status, tier, apiId]);
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
export async function updatePricingInDB(model, inputPrice, outputPrice) {
    return upsertPricing({
        model,
        inputPrice,
        outputPrice,
        source: 'manual',
        status: 'active'
    });
}
/**
 * Seed the pricing table from the bundled fallback data when the table is empty.
 * Called on server startup. Uses a TypeScript module instead of filesystem reads,
 * ensuring the data is compiled into dist/ and available in production.
 */
export async function seedFromFallbackIfEmpty() {
    const countRow = (await getQuery('SELECT COUNT(*) as count FROM pricing'));
    if (countRow && countRow.count > 0)
        return;
    try {
        for (const m of pricingFallback.models) {
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
        console.log(`Seeded ${pricingFallback.models.length} pricing rows from fallback`);
    }
    catch (err) {
        console.error('Failed to seed pricing from fallback:', err.message);
    }
}
export async function checkAndUpdatePricing() {
    const upstream = await fetchLiteLLMPricing();
    if (!upstream) {
        console.log('LiteLLM fetch returned null — skipping update cycle');
        return false;
    }
    // Index upstream by display name (canonical key in our DB)
    const upstreamByName = new Map();
    for (const m of upstream)
        upstreamByName.set(m.displayName, m);
    const current = (await allQuery('SELECT * FROM pricing'));
    const currentByName = new Map(current.map((r) => [r.model, r]));
    let changed = false;
    // 1. Apply updates to existing rows
    for (const row of current) {
        try {
            const up = upstreamByName.get(row.model) ?? null;
            const action = decideUpdateAction(row, up ? { input: up.inputPrice, output: up.outputPrice } : null);
            if (action === 'skip')
                continue;
            if (action === 'mark_deprecated') {
                await runQuery("UPDATE pricing SET status = 'deprecated', last_updated = CURRENT_TIMESTAMP WHERE model = ?", [row.model]);
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
        catch (err) {
            console.error(`Failed to update pricing for ${row.model}:`, err.message);
        }
    }
    // 2. Insert new upstream models that aren't in our DB yet
    for (const m of upstream) {
        try {
            if (currentByName.has(m.displayName))
                continue;
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
        catch (err) {
            console.error(`Failed to insert new model ${m.displayName}:`, err.message);
        }
    }
    return changed;
}
export async function recalculateCosts(model) {
    try {
        const records = (await allQuery(`SELECT id, input_tokens, output_tokens FROM usage_records
       WHERE model = ? AND datetime(timestamp) >= datetime('now', '-30 days')`, [model]));
        const pricing = (await getQuery('SELECT * FROM pricing WHERE model = ?', [model]));
        if (pricing && records.length > 0) {
            for (const r of records) {
                const cost = (r.input_tokens * pricing.input_price + r.output_tokens * pricing.output_price) /
                    1000000;
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
    }
    catch (error) {
        console.error('Error recalculating costs:', error);
        throw error;
    }
}
export async function getAllPricing() {
    try {
        return (await allQuery('SELECT * FROM pricing ORDER BY model ASC'));
    }
    catch (error) {
        console.error('Error getting pricing:', error);
        return [];
    }
}
export function schedulePricingCheck(cronJob) {
    try {
        cronJob.schedule('0 2 * * *', async () => {
            console.log('Running scheduled pricing check...');
            const updated = await checkAndUpdatePricing();
            console.log(updated ? 'Pricing was updated' : 'No pricing changes detected');
        });
        console.log('Pricing check scheduled for daily at 2 AM');
    }
    catch (error) {
        console.error('Error scheduling pricing check:', error);
    }
}
// Exported for legacy callers; now delegates to the LiteLLM source.
export async function fetchLatestPricing() {
    return fetchLiteLLMPricing();
}
//# sourceMappingURL=pricingService.js.map