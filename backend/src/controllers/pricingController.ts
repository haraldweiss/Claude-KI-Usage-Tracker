import { Request, Response } from 'express';
import { runQuery, allQuery, getQuery } from '../database/sqlite.js';
import { upsertPricing } from '../services/pricingService.js';
import type { PricingRecord, UpdatePricingRequest } from '../types/index.js';

interface PricingRow {
  id?: number;
  model: string;
  input_price: number;
  output_price: number;
  last_updated?: string;
  source?: string;
}

export async function getPricing(_req: Request, res: Response): Promise<void> {
  try {
    const pricing = await allQuery('SELECT * FROM pricing ORDER BY model ASC');
    res.json({
      pricing: (pricing as PricingRecord[]) || []
    });
  } catch (error) {
    console.error('Error getting pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updatePricing(
  req: Request<{ model: string }, unknown, UpdatePricingRequest>,
  res: Response
): Promise<void> {
  try {
    const { model } = req.params;
    const { input_price, output_price } = req.body;

    if (!model || input_price === undefined || output_price === undefined) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Check if pricing exists for this model
    const existing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]) as PricingRow | undefined;

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

export async function confirmPricing(
  req: Request<{ model: string }, unknown, { inputPrice?: number; outputPrice?: number }>,
  res: Response
): Promise<void> {
  try {
    const model = req.params.model as string;
    const { inputPrice, outputPrice } = req.body;

    const existing = (await getQuery(
      'SELECT * FROM pricing WHERE model = ?',
      [model]
    )) as
      | { input_price: number; output_price: number; tier: string | null; api_id: string | null }
      | undefined;

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

    res.json({
      success: true,
      model,
      pricing: { input_price: finalInput, output_price: finalOutput, source: 'manual', status: 'active' }
    });
  } catch (error) {
    console.error('Error confirming pricing:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function recalculateCosts(model: string): Promise<void> {
  try {
    const records = await allQuery(
      `SELECT id, input_tokens, output_tokens FROM usage_records
       WHERE model = ? AND datetime(timestamp) >= datetime('now', '-30 days')`,
      [model]
    );

    const pricing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]) as PricingRow | undefined;

    if (pricing && (records as any[]).length > 0) {
      for (const record of records as any[]) {
        const cost = (record.input_tokens * pricing.input_price + record.output_tokens * pricing.output_price) / 1000000;
        await runQuery('UPDATE usage_records SET cost = ? WHERE id = ?', [cost, record.id]);
      }
    }
  } catch (error) {
    console.error('Error recalculating costs:', error);
  }
}

export async function initializePricing(): Promise<void> {
  // Seeding is now handled by seedFromFallbackIfEmpty() in pricingService.
  // This function is kept for API compatibility and is a no-op.
}
