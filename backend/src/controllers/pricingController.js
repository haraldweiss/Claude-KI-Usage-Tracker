import { runQuery, allQuery, getQuery } from '../database/sqlite.js';

export async function getPricing(req, res) {
  try {
    const pricing = await allQuery('SELECT * FROM pricing ORDER BY model ASC');
    res.json({
      pricing: pricing || []
    });
  } catch (error) {
    console.error('Error getting pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updatePricing(req, res) {
  try {
    const { model } = req.params;
    const { input_price, output_price } = req.body;

    if (!model || input_price === undefined || output_price === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if pricing exists for this model
    const existing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);

    if (existing) {
      await runQuery(
        'UPDATE pricing SET input_price = ?, output_price = ?, source = ?, last_updated = CURRENT_TIMESTAMP WHERE model = ?',
        [input_price, output_price, 'manual', model]
      );
    } else {
      await runQuery(
        'INSERT INTO pricing (model, input_price, output_price, source) VALUES (?, ?, ?, ?)',
        [model, input_price, output_price, 'manual']
      );
    }

    // Recalculate costs for records from last 30 days
    await recalculateCosts(model);

    res.json({
      success: true,
      message: 'Pricing updated successfully'
    });
  } catch (error) {
    console.error('Error updating pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function recalculateCosts(model) {
  try {
    const records = await allQuery(
      `SELECT id, input_tokens, output_tokens FROM usage_records
       WHERE model = ? AND datetime(timestamp) >= datetime('now', '-30 days')`,
      [model]
    );

    const pricing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);

    if (pricing && records.length > 0) {
      for (const record of records) {
        const cost = (record.input_tokens * pricing.input_price + record.output_tokens * pricing.output_price) / 1000000;
        await runQuery('UPDATE usage_records SET cost = ? WHERE id = ?', [cost, record.id]);
      }
    }
  } catch (error) {
    console.error('Error recalculating costs:', error);
  }
}

export async function initializePricing() {
  try {
    const existing = await getQuery('SELECT COUNT(*) as count FROM pricing');

    if (existing.count === 0) {
      // Default Anthropic pricing (as of March 2024)
      const defaultPricing = [
        { model: 'Claude 3.5 Sonnet', input_price: 3, output_price: 15 },
        { model: 'Claude 3.5 Haiku', input_price: 0.8, output_price: 4 },
        { model: 'Claude 3 Opus', input_price: 15, output_price: 75 }
      ];

      for (const price of defaultPricing) {
        await runQuery(
          'INSERT INTO pricing (model, input_price, output_price, source) VALUES (?, ?, ?, ?)',
          [price.model, price.input_price, price.output_price, 'anthropic']
        );
      }

      console.log('Default pricing initialized');
    }
  } catch (error) {
    console.error('Error initializing pricing:', error);
  }
}
