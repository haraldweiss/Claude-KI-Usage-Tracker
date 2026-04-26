import { runQuery, allQuery, getQuery } from '../database/sqlite.js';
import { upsertPricing, recalculateCosts } from '../services/pricingService.js';
export async function getPricing(_req, res) {
    try {
        const pricing = await allQuery('SELECT * FROM pricing ORDER BY model ASC');
        res.json({
            pricing: pricing || []
        });
    }
    catch (error) {
        console.error('Error getting pricing:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export async function updatePricing(req, res) {
    try {
        const { model } = req.params;
        const { input_price, output_price } = req.body;
        if (!model || input_price === undefined || output_price === undefined) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }
        // Check if pricing exists for this model
        const existing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);
        if (existing) {
            await runQuery('UPDATE pricing SET input_price = ?, output_price = ?, source = ?, last_updated = CURRENT_TIMESTAMP WHERE model = ?', [input_price, output_price, 'manual', model]);
        }
        else {
            await runQuery('INSERT INTO pricing (model, input_price, output_price, source) VALUES (?, ?, ?, ?)', [model, input_price, output_price, 'manual']);
        }
        // Recalculate costs for records from last 30 days
        await recalculateCosts(model);
        res.json({
            success: true,
            message: 'Pricing updated successfully'
        });
    }
    catch (error) {
        console.error('Error updating pricing:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
export async function confirmPricing(req, res) {
    try {
        const model = req.params.model;
        const { inputPrice, outputPrice } = req.body;
        const existing = (await getQuery('SELECT * FROM pricing WHERE model = ?', [model]));
        if (!existing) {
            res.status(404).json({ success: false, error: 'Model not found' });
            return;
        }
        const finalInput = typeof inputPrice === 'number' ? inputPrice : existing.input_price;
        const finalOutput = typeof outputPrice === 'number' ? outputPrice : existing.output_price;
        await upsertPricing({
            model,
            inputPrice: finalInput,
            outputPrice: finalOutput,
            source: 'manual',
            status: 'active',
            tier: existing.tier,
            apiId: existing.api_id
        });
        try {
            await recalculateCosts(model);
        }
        catch (recalcErr) {
            console.error(`Failed to recalculate costs for ${model}:`, recalcErr.message);
        }
        res.json({
            success: true,
            model,
            pricing: { input_price: finalInput, output_price: finalOutput, source: 'manual', status: 'active' }
        });
    }
    catch (error) {
        console.error('Error confirming pricing:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}
//# sourceMappingURL=pricingController.js.map