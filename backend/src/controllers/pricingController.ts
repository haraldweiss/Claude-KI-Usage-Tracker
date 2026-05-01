import { Request, Response } from 'express';
import { runQuery, allQuery, getQuery } from '../database/sqlite.js';
import { upsertPricing, recalculateCosts } from '../services/pricingService.js';
import {
  getAllPlans,
  updatePlanPrice,
  refreshPlanPricingFromUpstream
} from '../services/planPricingService.js';
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
    // Exclude synthetic "models" that the sync sources (claude.ai dashboard,
    // Claude Code page, Anthropic Console) auto-insert as placeholders for
    // workspaces, API keys, and team members. They have no per-token price
    // (they carry cost in cost_usd, not input_price/output_price), so showing
    // them in the pricing UI just produces a long list of $0.00 "Needs review"
    // rows the user can never sensibly fill in.
    const pricing = await allQuery(
      `SELECT * FROM pricing
       WHERE model != 'Claude (Official Sync)'
         AND model NOT LIKE 'Anthropic API (%'
         AND model NOT LIKE 'Claude Code (%'
         AND model NOT LIKE 'Claude Code · %'
       ORDER BY model ASC`
    );
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

// ---------------------------------------------------------------------------
// Plan subscription pricing (Pro, Max 5x, etc.) — flat monthly fees per plan.
// Separate from per-model token pricing; used by the dashboard to add the
// fixed claude.ai subscription cost to the variable pay-as-you-go spend.
// ---------------------------------------------------------------------------

export async function getPlans(_req: Request, res: Response): Promise<void> {
  try {
    const plans = await getAllPlans();
    res.json({ plans });
  } catch (error) {
    console.error('Error getting plan pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updatePlan(
  req: Request<{ name: string }, unknown, { monthly_eur: number }>,
  res: Response
): Promise<void> {
  try {
    const planName = decodeURIComponent(req.params.name);
    const { monthly_eur } = req.body;

    if (typeof monthly_eur !== 'number' || !isFinite(monthly_eur) || monthly_eur < 0) {
      res.status(400).json({ error: 'monthly_eur must be a non-negative number' });
      return;
    }

    await updatePlanPrice(planName, monthly_eur, 'manual');
    res.json({ success: true, plan_name: planName, monthly_eur, source: 'manual' });
  } catch (error) {
    console.error('Error updating plan pricing:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function triggerPlanRefresh(_req: Request, res: Response): Promise<void> {
  try {
    const result = await refreshPlanPricingFromUpstream();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error refreshing plan pricing:', error);
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

    try {
      await recalculateCosts(model);
    } catch (recalcErr) {
      console.error(`Failed to recalculate costs for ${model}:`, (recalcErr as Error).message);
    }

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
