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
      raw_response,
      workspace = null,
      key_name = null,
      key_id_suffix = null,
      cost_usd = null
    } = req.body as UsageTrackRequest & {
      workspace?: string | null;
      key_name?: string | null;
      key_id_suffix?: string | null;
      cost_usd?: number | null;
    };

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

    // Console scraping appends a fresh row per key per sync. The dashboard
    // takes the latest snapshot per (workspace, key_id_suffix) for current
    // totals and diffs consecutive snapshots for trends. No dedupe here.

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
        task_description, success_status, response_metadata,
        workspace, key_name, key_id_suffix, cost_usd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        metadataJson,
        workspace,
        key_name,
        key_id_suffix,
        cost_usd
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

interface ClaudeAiMeta {
  plan_name?: string | null;
  session_pct?: number | null;
  weekly_all_models_pct?: number | null;
  weekly_sonnet_pct?: number | null;
  spent_eur?: number | null;
  spent_pct?: number | null;
  monthly_limit_eur?: number | null;
  balance_eur?: number | null;
  reset_date?: string | null;
  scraped_at?: string;
}

interface ClaudeAiSyncRow {
  cost_eur: number;
  weekly_used_pct: number;
  last_synced: string;
  meta: ClaudeAiMeta | null;
}

interface ApiWorkspaceRow {
  workspace: string;
  cost_usd: number;
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

    // -------- Plan B: combined claude.ai + Console API breakdown ---------
    // claude.ai sync rows are singletons (delete-then-insert), so the latest
    // row IS the cumulative monthly figure. cost is stored in cost (EUR);
    // input_tokens encodes monthly_spent*1000 and output_tokens encodes
    // weekly_used%. We translate back here for the dashboard.
    const claudeAiRow = await getQuery<{
      cost_eur: number;
      input_tokens: number;
      output_tokens: number;
      timestamp: string;
      response_metadata: string | null;
    }>(
      `SELECT cost as cost_eur, input_tokens, output_tokens, timestamp, response_metadata
       FROM usage_records
       WHERE source = 'claude_official_sync'
       ORDER BY timestamp DESC
       LIMIT 1`
    );

    let parsedMeta: ClaudeAiMeta | null = null;
    if (claudeAiRow?.response_metadata) {
      try {
        parsedMeta = JSON.parse(claudeAiRow.response_metadata) as ClaudeAiMeta;
      } catch {
        // Older rows may have stored metadata as a non-JSON string. Treat as missing.
        parsedMeta = null;
      }
    }

    const claudeAi: ClaudeAiSyncRow | null = claudeAiRow
      ? {
          // Prefer the rich metadata when present, fall back to the legacy
          // input_tokens/1000 encoding used before the scraper expansion.
          cost_eur: parsedMeta?.spent_eur ?? claudeAiRow.input_tokens / 1000,
          weekly_used_pct:
            parsedMeta?.weekly_all_models_pct ?? claudeAiRow.output_tokens,
          last_synced: claudeAiRow.timestamp,
          meta: parsedMeta
        }
      : null;

    // For each (workspace, key_id_suffix), pick the latest snapshot in the
    // requested window — that's the cumulative cost as of last sync.
    // Two sources contribute here:
    //   - anthropic_console_sync: regular API keys from console/settings/keys
    //   - claude_code_sync: Claude Code keys (different page, different
    //     billing surface, but conceptually still "Anthropic API" spend)
    const apiByWorkspace = await allQuery<ApiWorkspaceRow>(
      `SELECT workspace, SUM(cost_usd) as cost_usd
       FROM (
         SELECT workspace, key_id_suffix, cost_usd,
                ROW_NUMBER() OVER (PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC) as rn
         FROM usage_records
         WHERE source IN ('anthropic_console_sync', 'claude_code_sync')
       )
       WHERE rn = 1
       GROUP BY workspace
       ORDER BY cost_usd DESC`
    );

    const apiTotalUsd = apiByWorkspace.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    res.json({
      period: (period as 'day' | 'week' | 'month') || 'day',
      request_count: (summary?.request_count as number) || 0,
      total_input_tokens: (summary?.total_input_tokens as number) || 0,
      total_output_tokens: (summary?.total_output_tokens as number) || 0,
      total_tokens: (summary?.total_tokens as number) || 0,
      total_cost: (summary?.total_cost as number) || 0,
      by_category: byCategory,
      combined: {
        claude_ai: claudeAi,
        anthropic_api: {
          cost_usd: apiTotalUsd,
          by_workspace: apiByWorkspace
        }
      }
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

interface ConsoleKeyRow {
  key_name: string | null;
  workspace: string | null;
  key_id_suffix: string | null;
  cost_usd: number | null;
  last_synced: string;
}

interface ConsoleKeyRowWithSource extends ConsoleKeyRow {
  source: string;
  lines_accepted: number | null;
}

export async function getConsoleKeys(_req: Request, res: Response): Promise<void> {
  try {
    // Latest snapshot per (workspace, key_id_suffix) across both
    // anthropic_console_sync (regular API keys) and claude_code_sync
    // (Claude Code keys + team members). The dashboard merges them into one
    // table with a 'source' column so the user can tell which surface a row
    // came from.
    const keys = await allQuery<ConsoleKeyRowWithSource>(
      `SELECT key_name, workspace, key_id_suffix, cost_usd,
              timestamp as last_synced, source, response_metadata
       FROM (
         SELECT key_name, workspace, key_id_suffix, cost_usd, timestamp,
                source, response_metadata,
                ROW_NUMBER() OVER (
                  PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC
                ) as rn
         FROM usage_records
         WHERE source IN ('anthropic_console_sync', 'claude_code_sync')
       )
       WHERE rn = 1
       ORDER BY cost_usd DESC NULLS LAST`
    );

    // Pull lines_accepted out of the JSON metadata for claude_code_sync rows.
    const enriched = keys.map((k) => {
      let lines_accepted: number | null = null;
      const meta = (k as unknown as { response_metadata?: string }).response_metadata;
      if (meta) {
        try {
          const parsed = JSON.parse(meta) as { lines_accepted?: number };
          if (typeof parsed.lines_accepted === 'number') lines_accepted = parsed.lines_accepted;
        } catch {
          // Non-JSON metadata, leave lines_accepted as null.
        }
      }
      return {
        key_name: k.key_name,
        workspace: k.workspace,
        key_id_suffix: k.key_id_suffix,
        cost_usd: k.cost_usd,
        last_synced: k.last_synced,
        source: k.source,
        lines_accepted
      };
    });

    res.json({ keys: enriched });
  } catch (error) {
    console.error('Error getting console keys:', error);
    res.status(500).json({ error: 'Internal server error' });
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
