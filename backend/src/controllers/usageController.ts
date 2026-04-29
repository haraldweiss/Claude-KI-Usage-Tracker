import { Request, Response } from 'express';
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import type { UsageTrackRequest, UsageTrackResponse, UsageRecord } from '../types/index.js';
import { normalizeIncomingModel, tierDefaultPrice, type PricingRow as KnownRow } from '../services/modelNormalizer.js';
import { upsertPricing } from '../services/pricingService.js';
import { categorize } from '../services/categorizationService.js';

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
      response_metadata = null,
      raw_prompt,
      raw_response
    } = req.body;

    if (!rawModel || input_tokens === undefined || output_tokens === undefined) {
      res.status(400).json({ success: false, error: 'Missing required fields' } as any);
      return;
    }

    // The "Sync from Claude" popup button POSTs the cumulative totals from
    // Claude's official settings page. Each click would otherwise append a
    // brand-new row with the same totals — inflating the displayed token
    // count by the full cumulative amount on every sync. Treat this source
    // as a singleton: drop any prior sync row before inserting the fresh one.
    if (source === 'claude_official_sync') {
      await runQuery("DELETE FROM usage_records WHERE source = 'claude_official_sync'");
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

    const recordId = result.lastID as number;

    // Fire-and-forget categorization. Errors leave the record in 'Pending'.
    if (raw_prompt && raw_response) {
      categorize(raw_prompt, raw_response)
        .then(async (cat) => {
          await runQuery(
            `UPDATE usage_records
             SET category = ?, effectiveness_score = ?, haiku_reasoning = ?
             WHERE id = ?`,
            [cat.category, cat.effectiveness_score, cat.reasoning, recordId]
          );
          console.log(
            `[Categorization] record ${recordId}: ${cat.category} (score=${cat.effectiveness_score.toFixed(2)})`
          );
        })
        .catch((catErr: Error) => {
          console.error(`[Categorization] record ${recordId} failed:`, catErr.message);
        });
    }

    res.status(201).json({
      success: true,
      id: recordId,
      cost: cost.toFixed(4)
    });
  } catch (error) {
    console.error('Error tracking usage:', error);
    res.status(500).json({ success: false, error: 'Internal server error' } as any);
  }
}

interface CategoryBreakdownRow {
  category: string;
  count: number;
  cost: number;
  effectiveness_avg: number | null;
}

export async function getSummary(
  req: Request<unknown, unknown, unknown, { period?: string }>,
  res: Response
): Promise<void> {
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

    const byCategory = await allQuery<CategoryBreakdownRow>(
      `SELECT
        category,
        COUNT(*) as count,
        SUM(cost) as cost,
        AVG(effectiveness_score) as effectiveness_avg
       FROM usage_records
       WHERE ${dateFilter} AND category IS NOT NULL AND category != 'Pending'
       GROUP BY category
       ORDER BY count DESC`
    );

    res.json({
      period: (period as 'day' | 'week' | 'month') || 'day',
      request_count: (summary?.request_count as number) || 0,
      total_input_tokens: (summary?.total_input_tokens as number) || 0,
      total_output_tokens: (summary?.total_output_tokens as number) || 0,
      total_tokens: (summary?.total_tokens as number) || 0,
      total_cost: (summary?.total_cost as number) || 0,
      by_category: byCategory
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({ error: 'Internal server error' } as any);
  }
}

interface ModelByCategoryRow {
  model: string;
  category: string;
  count: number;
  cost: number;
}

export async function getModelBreakdown(
  req: Request<unknown, unknown, unknown, { period?: string }>,
  res: Response
): Promise<void> {
  try {
    const { period = 'month' } = req.query;

    let dateFilter = "datetime(timestamp) >= datetime('now', '-30 days')";
    if (period === 'day') {
      dateFilter = "date(timestamp) = date('now')";
    } else if (period === 'week') {
      dateFilter = "datetime(timestamp) >= datetime('now', '-7 days')";
    }

    const breakdown = await allQuery(
      `SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE ${dateFilter}
       GROUP BY model
       ORDER BY total_tokens DESC`
    );

    // Per-model category breakdown — used by the "Model × Category" matrix.
    const modelCategoryRows = await allQuery<ModelByCategoryRow>(
      `SELECT
        model,
        category,
        COUNT(*) as count,
        SUM(cost) as cost
       FROM usage_records
       WHERE ${dateFilter} AND category IS NOT NULL AND category != 'Pending'
       GROUP BY model, category
       ORDER BY model, count DESC`
    );

    const byModelCategory: Record<string, Array<{ category: string; count: number; cost: number }>> = {};
    for (const row of modelCategoryRows) {
      if (!byModelCategory[row.model]) byModelCategory[row.model] = [];
      byModelCategory[row.model]!.push({
        category: row.category,
        count: row.count,
        cost: row.cost
      });
    }

    res.json({
      models: (breakdown as any[]) || [],
      by_model_category: byModelCategory
    });
  } catch (error) {
    console.error('Error getting model breakdown:', error);
    res.status(500).json({ error: 'Internal server error' } as any);
  }
}

interface ConfirmEffectivenessBody {
  effectiveness_confirmed?: boolean;
  user_category_override?: string;
}

export async function confirmEffectiveness(
  req: Request<{ id: string }, unknown, ConfirmEffectivenessBody>,
  res: Response
): Promise<void> {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ success: false, error: 'Invalid id' });
      return;
    }

    const { effectiveness_confirmed, user_category_override } = req.body;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (effectiveness_confirmed !== undefined) {
      updates.push('effectiveness_confirmed = ?');
      params.push(effectiveness_confirmed ? 1 : 0);
    }

    if (user_category_override) {
      updates.push('category = ?', 'user_category_override = ?');
      params.push(user_category_override, user_category_override);
    }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'No updates provided' });
      return;
    }

    params.push(id);

    const result = await runQuery(
      `UPDATE usage_records SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (result.changes === 0) {
      res.status(404).json({ success: false, error: 'Record not found' });
      return;
    }

    const updated = await getQuery<UsageRecord>(
      'SELECT * FROM usage_records WHERE id = ?',
      [id]
    );

    res.json({ success: true, record: updated });
  } catch (error) {
    console.error('Error confirming effectiveness:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

interface HistoryQuery {
  limit?: string;
  offset?: string;
  category?: string;
  confirmed?: string;
}

export async function getHistory(
  req: Request<unknown, unknown, unknown, HistoryQuery>,
  res: Response
): Promise<void> {
  try {
    const { limit = '50', offset = '0', category, confirmed } = req.query;

    const where: string[] = [];
    const params: unknown[] = [];

    if (category && category !== 'all') {
      where.push('category = ?');
      params.push(category);
    }

    if (confirmed === 'pending') {
      where.push('effectiveness_confirmed = 0');
    } else if (confirmed === 'confirmed') {
      where.push('effectiveness_confirmed = 1');
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    const history = await allQuery(
      `SELECT
        id, model, input_tokens, output_tokens, total_tokens, cost,
        timestamp, conversation_id, category, effectiveness_score,
        effectiveness_confirmed, user_category_override, haiku_reasoning
       FROM usage_records
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offsetNum]
    );

    res.json({
      records: (history as UsageRecord[]) || [],
      limit: limitNum,
      offset: offsetNum
    });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
