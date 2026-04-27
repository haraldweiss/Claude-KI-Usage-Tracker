import { Request, Response } from 'express';
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import type { UsageTrackRequest, UsageTrackResponse, UsageSummary, UsageRecord, ModelBreakdown } from '../types/index.js';
import { normalizeIncomingModel, tierDefaultPrice, type PricingRow as KnownRow } from '../services/modelNormalizer.js';
import { upsertPricing } from '../services/pricingService.js';

interface PricingRow {
  model: string;
  input_price: number;
  output_price: number;
  source: string;
  status: string;
  tier: string | null;
  api_id: string | null;
}

interface SummaryRow {
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
}

export async function trackUsage(
  req: Request<unknown, unknown, UsageTrackRequest>,
  res: Response<UsageTrackResponse>
): Promise<void> {
  try {
    const {
      model: rawModel,
      input_tokens,
      output_tokens,
      conversation_id,
      source = 'claude_ai',
      task_description = null,
      success_status = 'unknown',
      response_metadata = null
    } = req.body;

    if (!rawModel || input_tokens === undefined || output_tokens === undefined) {
      res.status(400).json({ success: false, error: 'Missing required fields' } as any);
      return;
    }

    // Normalize the incoming model id/name against existing pricing rows
    const allRows = (await allQuery('SELECT * FROM pricing')) as KnownRow[];
    const normalized = normalizeIncomingModel(rawModel, allRows);
    const model = normalized.displayName;

    let pricing = (await getQuery(
      'SELECT * FROM pricing WHERE model = ?',
      [model]
    )) as PricingRow | undefined;

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
      } else {
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
      pricing = (await getQuery(
        'SELECT * FROM pricing WHERE model = ?',
        [model]
      )) as PricingRow | undefined;
    }

    const total_tokens = input_tokens + output_tokens;
    let cost = 0;
    if (pricing) {
      cost =
        (input_tokens * pricing.input_price + output_tokens * pricing.output_price) / 1_000_000;
    }

    const metadataJson = response_metadata
      ? typeof response_metadata === 'string'
        ? response_metadata
        : JSON.stringify(response_metadata)
      : null;

    const result = await runQuery(
      `INSERT INTO usage_records (
        model, input_tokens, output_tokens, total_tokens, cost, conversation_id, source,
        task_description, success_status, response_metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ]
    );

    res.status(201).json({
      success: true,
      id: result.lastID as number,
      cost: cost.toFixed(4)
    });
  } catch (error) {
    console.error('Error tracking usage:', error);
    res.status(500).json({ success: false, error: 'Internal server error' } as any);
  }
}

export async function getSummary(req: Request<unknown, unknown, unknown, { period?: string }>, res: Response<UsageSummary>): Promise<void> {
  try {
    const { period = 'day' } = req.query;

    let dateFilter = '';
    if (period === 'day') {
      dateFilter = 'date(timestamp) = date(\'now\')';
    } else if (period === 'week') {
      dateFilter = 'datetime(timestamp) >= datetime(\'now\', \'-7 days\')';
    } else if (period === 'month') {
      dateFilter = 'datetime(timestamp) >= datetime(\'now\', \'-30 days\')';
    }

    const summary = await getQuery(
      `SELECT
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE ${dateFilter}`
    ) as SummaryRow | undefined;

    res.json({
      period: (period as 'day' | 'week' | 'month') || 'day',
      request_count: (summary?.request_count as number) || 0,
      total_input_tokens: (summary?.total_input_tokens as number) || 0,
      total_output_tokens: (summary?.total_output_tokens as number) || 0,
      total_tokens: (summary?.total_tokens as number) || 0,
      total_cost: (summary?.total_cost as number) || 0
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ error: 'Internal server error' } as any);
  }
}

export async function getModelBreakdown(_req: Request, res: Response<ModelBreakdown>): Promise<void> {
  try {
    const breakdown = await allQuery(
      `SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE datetime(timestamp) >= datetime('now', '-30 days')
       GROUP BY model
       ORDER BY total_tokens DESC`
    );

    res.json({
      models: (breakdown as any[]) || []
    });
  } catch (error) {
    console.error('Error getting model breakdown:', error);
    res.status(500).json({ error: 'Internal server error' } as any);
  }
}

export async function getHistory(req: Request<unknown, unknown, unknown, { limit?: string; offset?: string }>, res: Response): Promise<void> {
  try {
    const { limit = '50', offset = '0' } = req.query;

    const history = await allQuery(
      `SELECT
        id, model, input_tokens, output_tokens, total_tokens, cost,
        timestamp, conversation_id
       FROM usage_records
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit as string, 10), parseInt(offset as string, 10)]
    );

    res.json({
      records: (history as UsageRecord[]) || [],
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10)
    });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
