import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import { normalizeIncomingModel, tierDefaultPrice } from '../services/modelNormalizer.js';
import { upsertPricing } from '../services/pricingService.js';
export async function trackUsage(req, res) {
    try {
        const { model: rawModel, input_tokens, output_tokens, conversation_id, source = 'claude_ai', task_description = null, success_status = 'unknown', response_metadata = null } = req.body;
        if (!rawModel || input_tokens === undefined || output_tokens === undefined) {
            res.status(400).json({ success: false, error: 'Missing required fields' });
            return;
        }
        // Normalize the incoming model id/name against existing pricing rows
        const allRows = (await allQuery('SELECT * FROM pricing'));
        const normalized = normalizeIncomingModel(rawModel, allRows);
        const model = normalized.displayName;
        let pricing = (await getQuery('SELECT * FROM pricing WHERE model = ?', [model]));
        // Auto-create on first sighting
        if (!pricing) {
            const tierPrice = tierDefaultPrice(normalized.tier, allRows);
            if (tierPrice) {
                await upsertPricing({
                    model,
                    inputPrice: tierPrice.input,
                    outputPrice: tierPrice.output,
                    source: 'tier_default',
                    status: 'active',
                    tier: normalized.tier,
                    apiId: normalized.apiId
                });
                console.log(`Auto-created tier_default pricing for new model: ${model}`);
            }
            else {
                await upsertPricing({
                    model,
                    inputPrice: 0,
                    outputPrice: 0,
                    source: 'tier_default',
                    status: 'pending_confirmation',
                    tier: normalized.tier,
                    apiId: normalized.apiId
                });
                console.log(`Auto-created pending_confirmation pricing for unknown model: ${model}`);
            }
            pricing = (await getQuery('SELECT * FROM pricing WHERE model = ?', [model]));
        }
        const total_tokens = input_tokens + output_tokens;
        let cost = 0;
        if (pricing) {
            cost =
                (input_tokens * pricing.input_price + output_tokens * pricing.output_price) / 1000000;
        }
        const metadataJson = response_metadata
            ? typeof response_metadata === 'string'
                ? response_metadata
                : JSON.stringify(response_metadata)
            : null;
        const result = await runQuery(`INSERT INTO usage_records (
        model, input_tokens, output_tokens, total_tokens, cost, conversation_id, source,
        task_description, success_status, response_metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            model,
            input_tokens,
            output_tokens,
            total_tokens,
            cost,
            conversation_id,
            source,
            task_description,
            success_status,
            metadataJson
        ]);
        res.status(201).json({
            success: true,
            id: result.lastID,
            cost: cost.toFixed(4)
        });
    }
    catch (error) {
        console.error('Error tracking usage:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}
export async function getSummary(req, res) {
    try {
        const { period = 'day' } = req.query;
        let dateFilter = '';
        if (period === 'day') {
            dateFilter = 'date(timestamp) = date(\'now\')';
        }
        else if (period === 'week') {
            dateFilter = 'datetime(timestamp) >= datetime(\'now\', \'-7 days\')';
        }
        else if (period === 'month') {
            dateFilter = 'datetime(timestamp) >= datetime(\'now\', \'-30 days\')';
        }
        const summary = await getQuery(`SELECT
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE ${dateFilter}`);
        res.json({
            period: period || 'day',
            request_count: summary?.request_count || 0,
            total_input_tokens: summary?.total_input_tokens || 0,
            total_output_tokens: summary?.total_output_tokens || 0,
            total_tokens: summary?.total_tokens || 0,
            total_cost: summary?.total_cost || 0
        });
    }
    catch (error) {
        console.error('Error getting summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export async function getModelBreakdown(_req, res) {
    try {
        const breakdown = await allQuery(`SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE datetime(timestamp) >= datetime('now', '-30 days')
       GROUP BY model
       ORDER BY total_tokens DESC`);
        res.json({
            models: breakdown || []
        });
    }
    catch (error) {
        console.error('Error getting model breakdown:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export async function getHistory(req, res) {
    try {
        const { limit = '50', offset = '0' } = req.query;
        const history = await allQuery(`SELECT
        id, model, input_tokens, output_tokens, total_tokens, cost,
        timestamp, conversation_id
       FROM usage_records
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`, [parseInt(limit, 10), parseInt(offset, 10)]);
        res.json({
            records: history || [],
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10)
        });
    }
    catch (error) {
        console.error('Error getting history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
//# sourceMappingURL=usageController.js.map