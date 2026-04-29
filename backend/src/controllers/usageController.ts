import { Request, Response } from 'express';
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import type { UsageTrackRequest, UsageTrackResponse, UsageRecord } from '../types/index.js';
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
      response_metadata = null,
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

    // The claude.ai usage page POSTs cumulative monthly totals. We used to
    // delete every prior row to avoid inflating the displayed token count,
    // but that destroyed historical data — making all-time spending
    // impossible to compute. Now we keep one snapshot per UTC day instead:
    // the latest sync of *today* replaces the previous one of today, but
    // older days survive. This caps the row count at ~30/month while
    // preserving enough history for monthly diffs and all-time totals.
    if (source === 'claude_official_sync') {
      await runQuery(
        `DELETE FROM usage_records
         WHERE source = 'claude_official_sync'
           AND date(timestamp) = date('now')`
      );
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
    //
    // Filter: console/settings/keys reports 0 USD for the 'Claude Code'
    // workspace because billing flows through the Claude Code page instead.
    // We exclude those rows to avoid double-counting (and to avoid showing
    // the same key twice with different key_id_suffix values).
    const apiByWorkspace = await allQuery<ApiWorkspaceRow>(
      `SELECT workspace, SUM(cost_usd) as cost_usd
       FROM (
         SELECT workspace, key_id_suffix, cost_usd,
                ROW_NUMBER() OVER (PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC) as rn
         FROM usage_records
         WHERE (source = 'anthropic_console_sync' AND COALESCE(workspace, '') != 'Claude Code')
            OR source = 'claude_code_sync'
       )
       WHERE rn = 1
       GROUP BY workspace
       ORDER BY cost_usd DESC`
    );

    const apiTotalUsd = apiByWorkspace.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    // EUR equivalent of the API spend, for the combined hero number.
    const { convertUsdToEur } = await import('../services/exchangeRateService.js');
    const fx = await convertUsdToEur(apiTotalUsd);

    res.json({
      period: (period as 'day' | 'week' | 'month') || 'day',
      request_count: (summary?.request_count as number) || 0,
      total_input_tokens: (summary?.total_input_tokens as number) || 0,
      total_output_tokens: (summary?.total_output_tokens as number) || 0,
      total_tokens: (summary?.total_tokens as number) || 0,
      total_cost: (summary?.total_cost as number) || 0,
      combined: {
        claude_ai: claudeAi,
        anthropic_api: {
          cost_usd: apiTotalUsd,
          cost_eur_equivalent: fx.eur,
          by_workspace: apiByWorkspace
        },
        exchange_rate: {
          usd_to_eur: fx.rate,
          rate_date: fx.rate_date
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

    // Exclude rows from the three sync sources — they're aggregate snapshots
    // (cumulative cost in cost_usd, not per-message token usage), so showing
    // them in a "tokens per model" table just produces misleading 0,00 rows.
    // The Combined Cost tab has the proper per-source visualization for them.
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
         AND COALESCE(source, '') NOT IN (
           'claude_official_sync',
           'anthropic_console_sync',
           'claude_code_sync'
         )
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

interface MonthSpendRow {
  month: string;
  plan_name: string | null;
  additional_eur: number;
  subscription_eur: number;
  total_eur: number;
}

/**
 * Return all-time spending: every month with at least one claude.ai sync
 * gets one row (using the latest snapshot of that month). Plan subscription
 * cost is looked up from plan_pricing per the snapshot's plan_name.
 */
export async function getSpendingTotal(_req: Request, res: Response): Promise<void> {
  try {
    // Latest claude.ai snapshot per UTC month — the cumulative figure as of
    // the last sync that month, which is also the final value because the
    // page resets on the 1st.
    const monthRows = await allQuery<{
      month: string;
      cost_eur: number;
      input_tokens: number;
      response_metadata: string | null;
      timestamp: string;
    }>(
      `SELECT month, cost_eur, input_tokens, response_metadata, timestamp
       FROM (
         SELECT strftime('%Y-%m', timestamp) as month,
                cost as cost_eur,
                input_tokens,
                response_metadata,
                timestamp,
                ROW_NUMBER() OVER (
                  PARTITION BY strftime('%Y-%m', timestamp)
                  ORDER BY timestamp DESC
                ) as rn
         FROM usage_records
         WHERE source = 'claude_official_sync'
       )
       WHERE rn = 1
       ORDER BY month DESC`
    );

    // Lookup plan_pricing once and reuse across months.
    const { getPlanPrice } = await import('../services/planPricingService.js');

    const months: MonthSpendRow[] = [];
    for (const row of monthRows) {
      let plan_name: string | null = null;
      let additional_eur = 0;
      try {
        const meta = row.response_metadata ? JSON.parse(row.response_metadata) : null;
        plan_name = meta?.plan_name ?? null;
        additional_eur = typeof meta?.spent_eur === 'number' ? meta.spent_eur : (row.cost_eur ?? row.input_tokens / 1000);
      } catch {
        additional_eur = row.cost_eur ?? row.input_tokens / 1000;
      }
      const subscription_eur = plan_name ? (await getPlanPrice(plan_name)) ?? 0 : 0;
      months.push({
        month: row.month,
        plan_name,
        additional_eur,
        subscription_eur,
        total_eur: subscription_eur + additional_eur
      });
    }

    const claudeAiTotalEur = months.reduce((sum, m) => sum + m.total_eur, 0);
    const claudeAiSubscriptionEur = months.reduce((sum, m) => sum + m.subscription_eur, 0);
    const claudeAiAdditionalEur = months.reduce((sum, m) => sum + m.additional_eur, 0);

    // For Anthropic API costs, the console reports cumulative cost since key
    // creation, so the latest snapshot per (workspace, key_id_suffix) IS the
    // all-time figure for that key. Sum across keys to get the all-time total.
    const apiTotalRow = await getQuery<{ total_usd: number }>(
      `SELECT SUM(cost_usd) as total_usd
       FROM (
         SELECT cost_usd,
                ROW_NUMBER() OVER (
                  PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC
                ) as rn
         FROM usage_records
         WHERE (source = 'anthropic_console_sync' AND COALESCE(workspace, '') != 'Claude Code')
            OR source = 'claude_code_sync'
       )
       WHERE rn = 1`
    );

    const since = months.length > 0 ? months[months.length - 1]?.month ?? null : null;
    const apiTotalUsd = apiTotalRow?.total_usd ?? 0;

    // Convert API USD to EUR using the latest stored exchange rate so the
    // dashboard can display a single combined total. The rate metadata is
    // included alongside so the UI can render a transparency line.
    const { convertUsdToEur } = await import('../services/exchangeRateService.js');
    const fx = await convertUsdToEur(apiTotalUsd);

    res.json({
      since,
      claude_ai: {
        total_eur: claudeAiTotalEur,
        subscription_eur: claudeAiSubscriptionEur,
        additional_eur: claudeAiAdditionalEur,
        months
      },
      anthropic_api: {
        total_usd: apiTotalUsd,
        total_eur_equivalent: fx.eur
      },
      grand_total_eur: claudeAiTotalEur + fx.eur,
      exchange_rate: {
        usd_to_eur: fx.rate,
        rate_date: fx.rate_date
      }
    });
  } catch (error) {
    console.error('Error getting spending total:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
         WHERE (source = 'anthropic_console_sync' AND COALESCE(workspace, '') != 'Claude Code')
            OR source = 'claude_code_sync'
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

interface HistoryQuery {
  limit?: string;
  offset?: string;
}

export async function getHistory(
  req: Request<unknown, unknown, unknown, HistoryQuery>,
  res: Response
): Promise<void> {
  try {
    const { limit = '50', offset = '0' } = req.query;

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    const history = await allQuery(
      `SELECT
        id, model, input_tokens, output_tokens, total_tokens, cost,
        timestamp, conversation_id
       FROM usage_records
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [limitNum, offsetNum]
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
