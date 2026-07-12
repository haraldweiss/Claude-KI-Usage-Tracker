// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Request, Response } from 'express';
import { runQuery, getQuery, allQuery } from '../database/sqlite.js';
import type { UsageTrackRequest, UsageTrackResponse, UsageRecord } from '../types/index.js';
import { normalizeIncomingModel, tierDefaultPrice, type PricingRow as KnownRow } from '../services/modelNormalizer.js';
import { upsertPricing } from '../services/pricingService.js';
import { getPlanPrice, updatePlanPrice } from '../services/planPricingService.js';
import { convertUsdToEur } from '../services/exchangeRateService.js';
import logger from '../utils/logger.js';

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
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    // Dedupe: at most one snapshot per day per source — delete today's stale
    // rows for this source before inserting fresh ones.
    const SYNC_SOURCES = ['claude_official_sync', 'opencode_go_sync', 'anthropic_console_sync', 'zai_sync', 'opencode_api_sync', 'anthropic_console_cost_day', 'anthropic_console_cost_month', 'codex_sync', 'openai_api_sync', 'cline_sync'] as const;
    if ((SYNC_SOURCES as readonly string[]).includes(source)) {
      await runQuery(
        `DELETE FROM usage_records
         WHERE source = ?
           AND date(timestamp) = date('now')
           AND user_id = ?`,
        [source, req.user!.id]
      );
    }

    // OpenCode Go sync: same dedupe pattern as claude_official_sync — keep
    // at most one snapshot per day.
    if (source === 'opencode_go_sync') {
      await runQuery(
        `DELETE FROM usage_records
         WHERE source = 'opencode_go_sync'
           AND date(timestamp) = date('now')
           AND user_id = ?`,
        [req.user!.id]
      );
    }

    // Console scraping: DELETE old rows for today before inserting fresh ones.
    // Each sync replaces the entire day's snapshot per user.
    if (source === 'anthropic_console_sync') {
      await runQuery(
        `DELETE FROM usage_records
         WHERE source = 'anthropic_console_sync'
           AND date(timestamp) = date('now')
           AND user_id = ?`,
        [req.user!.id]
      );
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
        logger.info(`Auto-created tier_default pricing for new model: ${model}`);
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
        logger.info(`Auto-created pending_confirmation pricing for unknown model: ${model}`);
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
        workspace, key_name, key_id_suffix, cost_usd, user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        cost_usd,
        req.user!.id
      ]
    );

    // z.ai GLM Coding Plan: the scraper reports the live subscription price in
    // USD alongside the usage quotas. Keep the plan_pricing row in sync so the
    // dashboard grand total auto-adjusts when the user upgrades (Lite→Pro→Max).
    // Cost math is user-trust-critical — only upsert a finite, positive price,
    // and mark the row 'auto' so a manual user edit is never overwritten.
    if (source === 'zai_sync' && response_metadata && typeof response_metadata === 'object') {
      const meta = response_metadata as Record<string, unknown>;
      // Handle both flat (server scraper) and nested {plan:{...}} (extension sync) formats
      const planInfo = meta.plan as Record<string, unknown> | undefined;
      const planName = typeof meta.plan_name === 'string' ? meta.plan_name.trim()
                     : typeof planInfo?.plan_name === 'string' ? (planInfo.plan_name as string).trim()
                     : null;
      const priceUsd = typeof meta.price_usd === 'number' ? meta.price_usd
                     : typeof planInfo?.price_usd === 'number' ? (planInfo.price_usd as number)
                     : typeof planInfo?.price_usd === 'string' ? parseFloat(planInfo.price_usd as string)
                     : null;
      if (planName && priceUsd != null && isFinite(priceUsd) && priceUsd > 0) {
        try {
          // Never clobber a price the user edited by hand in the pricing table.
          const existing = await getQuery<{ source: string }>(
            'SELECT source FROM plan_pricing WHERE plan_name = ?',
            [planName]
          );
          if (existing?.source !== 'manual') {
            const fx = await convertUsdToEur(priceUsd);
            await updatePlanPrice(planName, fx.eur, 'auto');
          }
        } catch (err) {
          logger.error({ err }, '[zai_sync] plan price upsert failed');
        }
      }
    }

    res.status(201).json({
      success: true,
      id: result.lastID as number,
      cost: cost.toFixed(4)
    });
  } catch (error) {
logger.error({ err: error }, 'Error tracking usage:');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

interface ClaudeAiMeta {
  plan_name?: string | null;
  session_pct?: number | null;
  session_reset_in?: string | null;
  session_limit_hours?: number | null;
  weekly_all_models_pct?: number | null;
  weekly_all_models_reset_in?: string | null;
  weekly_sonnet_pct?: number | null;
  weekly_sonnet_reset_in?: string | null;
  spent_eur?: number | null;
  spent_pct?: number | null;
  monthly_limit_eur?: number | null;
  balance_eur?: number | null;
  reset_date?: string | null;
  scraped_at?: string;
}

interface ClaudeAiSyncRow {
  cost_eur: number;
  plan_eur: number;
  total_eur: number;
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
       WHERE ${dateFilter}
         AND user_id = ?`,
      [req.user!.id]
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
         AND user_id = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [req.user!.id]
    );

    let parsedMeta: ClaudeAiMeta | null = null;
    if (claudeAiRow?.response_metadata) {
      try {
        parsedMeta = JSON.parse(claudeAiRow.response_metadata) as ClaudeAiMeta;
      } catch {
        parsedMeta = null;
      }
    }

    // -------- OpenCode Go subscription data ---------
    const opencodeGoRow = await getQuery<{
      timestamp: string;
      response_metadata: string | null;
    }>(
      `SELECT timestamp, response_metadata
       FROM usage_records
       WHERE source = 'opencode_go_sync'
         AND user_id = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [req.user!.id]
    );

    interface OpenCodeGoMeta {
      plan_name?: string | null;
      continuous_pct?: number | null;
      continuous_reset_in?: string | null;
      weekly_pct?: number | null;
      weekly_reset_in?: string | null;
      monthly_pct?: number | null;
      monthly_reset_in?: string | null;
      scraped_at?: string;
    }

    let opencodeGoMeta: OpenCodeGoMeta | null = null;
    if (opencodeGoRow?.response_metadata) {
      try {
        opencodeGoMeta = JSON.parse(opencodeGoRow.response_metadata) as OpenCodeGoMeta;
      } catch {
        opencodeGoMeta = null;
      }
    }

    const opencodeGo = opencodeGoRow
      ? {
          plan_name: opencodeGoMeta?.plan_name ?? null,
          continuous_pct: opencodeGoMeta?.continuous_pct ?? null,
          continuous_reset_in: opencodeGoMeta?.continuous_reset_in ?? null,
          weekly_pct: opencodeGoMeta?.weekly_pct ?? null,
          weekly_reset_in: opencodeGoMeta?.weekly_reset_in ?? null,
          monthly_pct: opencodeGoMeta?.monthly_pct ?? null,
          monthly_reset_in: opencodeGoMeta?.monthly_reset_in ?? null,
          last_synced: opencodeGoRow.timestamp
        }
      : null;

    // -------- z.ai GLM Coding Plan subscription data ---------
    const zaiRow = await getQuery<{
      timestamp: string;
      response_metadata: string | null;
    }>(
      `SELECT timestamp, response_metadata
       FROM usage_records
       WHERE source = 'zai_sync'
         AND user_id = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [req.user!.id]
    );

    interface ZaiMeta {
      plan_name?: string | null;
      price_usd?: number | null;
      auto_renew_date?: string | null;
      five_hour_pct?: number | null;
      weekly_pct?: number | null;
      weekly_reset?: string | null;
      monthly_pct?: number | null;
      monthly_reset?: string | null;
      scraped_at?: string;
    }

    let zaiMeta: ZaiMeta | null = null;
    if (zaiRow?.response_metadata) {
      try {
        zaiMeta = JSON.parse(zaiRow.response_metadata) as ZaiMeta;
      } catch {
        zaiMeta = null;
      }
    }

    // Handle both flat (old server-scraper) and nested (extension sync) formats
    const planInfo = (zaiMeta as Record<string, unknown>)?.plan as Record<string, unknown> | undefined;
    const usageInfo = (zaiMeta as Record<string, unknown>)?.usage as Record<string, unknown> | undefined;

    const zai = zaiRow
      ? {
          plan_name: zaiMeta?.plan_name ?? (planInfo?.plan_name as string) ?? null,
          price_usd: typeof zaiMeta?.price_usd === 'number' ? zaiMeta.price_usd
                     : typeof planInfo?.price_usd === 'number' ? planInfo.price_usd
                     : typeof planInfo?.price_usd === 'string' ? parseFloat(planInfo.price_usd as string) || null
                     : null,
          auto_renew_date: zaiMeta?.auto_renew_date ?? (planInfo?.auto_renew_date as string) ?? null,
          five_hour_pct: zaiMeta?.five_hour_pct ?? (usageInfo?.five_hour_pct as number) ?? null,
          weekly_pct: zaiMeta?.weekly_pct ?? (usageInfo?.weekly_pct as number) ?? null,
          weekly_reset: zaiMeta?.weekly_reset ?? (usageInfo?.weekly_reset as string) ?? null,
          monthly_pct: zaiMeta?.monthly_pct ?? (usageInfo?.monthly_pct as number) ?? null,
          monthly_reset: zaiMeta?.monthly_reset ?? (usageInfo?.monthly_reset as string) ?? null,
          last_synced: zaiRow.timestamp
        }
      : null;

    // Stale-carryover guard for the in-progress cycle: claude.ai's dashboard
    // can keep displaying the previous cycle's spent_eur for a while after
    // reset before refreshing. Detect this by comparing against the latest
    // sync that had a different reset_date — if the values match exactly,
    // the current reading is cached carryover and effective spend is 0.
    let staleCarryover = false;
    if (
      parsedMeta?.spent_eur != null &&
      parsedMeta.spent_eur > 0 &&
      parsedMeta.reset_date
    ) {
      const prevCycleRow = await getQuery<{ response_metadata: string | null }>(
        `SELECT response_metadata FROM usage_records
         WHERE source = 'claude_official_sync'
           AND user_id = ?
           AND json_extract(response_metadata, '$.reset_date') IS NOT NULL
           AND json_extract(response_metadata, '$.reset_date') != ?
         ORDER BY timestamp DESC
         LIMIT 1`,
        [req.user!.id, parsedMeta.reset_date]
      );
      if (prevCycleRow?.response_metadata) {
        try {
          const prevMeta = JSON.parse(prevCycleRow.response_metadata) as ClaudeAiMeta;
          if (
            typeof prevMeta?.spent_eur === 'number' &&
            Math.abs(prevMeta.spent_eur - parsedMeta.spent_eur) < 0.01
          ) {
            staleCarryover = true;
          }
        } catch {
          /* ignore */
        }
      }
    }

    const rawSpentEur =
      parsedMeta?.spent_eur ?? (claudeAiRow ? claudeAiRow.input_tokens / 1000 : 0);
    const effectiveSpentEur = staleCarryover ? 0 : rawSpentEur;

    // Resolve the plan subscription EUR so simple consumers (e.g. the
    // extension popup) can render a complete claude.ai monthly figure
    // without needing a separate /pricing/plans request.
    let planEur = 0;
    if (parsedMeta?.plan_name) {
      planEur = (await getPlanPrice(parsedMeta.plan_name)) ?? 0;
    }

    const claudeAi: ClaudeAiSyncRow | null = claudeAiRow
      ? {
          cost_eur: effectiveSpentEur,
          plan_eur: planEur,
          total_eur: planEur + effectiveSpentEur,
          weekly_used_pct:
            parsedMeta?.weekly_all_models_pct ?? claudeAiRow.output_tokens,
          last_synced: claudeAiRow.timestamp,
          meta: parsedMeta
            ? staleCarryover
              ? { ...parsedMeta, spent_eur: 0, spent_pct: 0 }
              : parsedMeta
            : parsedMeta
        }
      : null;

    // Anthropic Console reports cumulative-since-key-creation cost per key,
    // so a single snapshot is meaningless for "this month" — we compute the
    // delta between the latest snapshot inside the period window and the
    // latest snapshot that existed before the window started. That difference
    // is what was actually spent during the period.
    //
    // Two sources contribute:
    //   - anthropic_console_sync: regular API keys from console/settings/keys
    //   - claude_code_sync: Claude Code keys (different page, different
    //     billing surface, but conceptually still "Anthropic API" spend)
    //
    // The 'Claude Code' workspace from anthropic_console_sync is excluded
    // because billing flows through the Claude Code page (rows show $0 there
    // and would double-count with claude_code_sync entries otherwise).
    let windowStartExpr: string;
    if (period === 'day') {
      windowStartExpr = "date('now')";
    } else if (period === 'week') {
      windowStartExpr = "datetime('now', '-7 days')";
    } else {
      windowStartExpr = "date('now', 'start of month')";
    }

    const apiSourceFilter = `((source = 'anthropic_console_sync' AND COALESCE(workspace, '') != 'Claude Code') OR source = 'claude_code_sync')`;

    const apiByWorkspace = await allQuery<ApiWorkspaceRow>(
      `WITH latest_in_window AS (
         SELECT workspace, key_id_suffix, cost_usd
         FROM (
           SELECT workspace, key_id_suffix, cost_usd,
                  ROW_NUMBER() OVER (PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC) as rn
           FROM usage_records
           WHERE ${apiSourceFilter}
             AND user_id = ?
             AND datetime(timestamp) >= datetime(${windowStartExpr})
         )
         WHERE rn = 1
       ),
       baseline AS (
         SELECT workspace, key_id_suffix, cost_usd
         FROM (
           SELECT workspace, key_id_suffix, cost_usd,
                  ROW_NUMBER() OVER (PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC) as rn
           FROM usage_records
           WHERE ${apiSourceFilter}
             AND user_id = ?
             AND datetime(timestamp) < datetime(${windowStartExpr})
         )
         WHERE rn = 1
       )
       SELECT workspace, cost_usd FROM (
         SELECT l.workspace,
                SUM(CASE
                      WHEN l.cost_usd > COALESCE(b.cost_usd, 0)
                      THEN l.cost_usd - COALESCE(b.cost_usd, 0)
                      ELSE 0
                    END) as cost_usd
         FROM latest_in_window l
         LEFT JOIN baseline b
           ON l.workspace IS b.workspace AND l.key_id_suffix IS b.key_id_suffix
         GROUP BY l.workspace
       )
       WHERE cost_usd > 0
       ORDER BY cost_usd DESC`,
      [req.user!.id, req.user!.id]
    );

    const apiTotalUsd = apiByWorkspace.reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    // EUR equivalent of the API spend, for the combined hero number.
    const fx = await convertUsdToEur(apiTotalUsd);

    // -------- OpenCode API usage data (from /usage page) ---------
    // Individual rows + per-key aggregates are stored as usage_records with
    // source='opencode_api_sync'. Aggregate them here.
    interface OpenCodeApiKeyRow {
      key_name: string | null;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }

    const opencodeApiByKey = await allQuery<OpenCodeApiKeyRow>(
      `SELECT key_name, SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens, SUM(cost_usd) as cost_usd
       FROM usage_records
       WHERE source = 'opencode_api_sync'
         AND user_id = ?
         AND datetime(timestamp) >= datetime(${windowStartExpr})
         AND response_metadata LIKE '%per_key_aggregate%'
       GROUP BY key_name
       ORDER BY cost_usd DESC`,
      [req.user!.id]
    );

    const opencodeApiTotalInput = opencodeApiByKey.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const opencodeApiTotalOutput = opencodeApiByKey.reduce((s, r) => s + (r.output_tokens || 0), 0);
    const opencodeApiTotalCost = opencodeApiByKey.reduce((s, r) => s + (r.cost_usd || 0), 0);

    const opencodeApi = opencodeApiByKey.length > 0 ? {
      total_input_tokens: opencodeApiTotalInput,
      total_output_tokens: opencodeApiTotalOutput,
      total_cost_usd: opencodeApiTotalCost,
      row_count: opencodeApiByKey.length,
      by_key: opencodeApiByKey.map((r) => ({
        key_name: r.key_name || 'unknown',
        input_tokens: r.input_tokens || 0,
        output_tokens: r.output_tokens || 0,
        cost_usd: r.cost_usd || 0
      }))
    } : null;

    // -------- Codex subscription usage (from chatgpt.com) ---------
    const codexRow = await allQuery<{ response_metadata: string | null; timestamp: string }>(
      `SELECT response_metadata, timestamp
       FROM usage_records
       WHERE source = 'codex_sync' AND user_id = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user!.id]
    );
    let codexData: Record<string, unknown> | null = null;
    if (codexRow?.[0]?.response_metadata) {
      try { codexData = JSON.parse(codexRow[0].response_metadata) as Record<string, unknown>; } catch { codexData = null; }
    }

    interface CodexSummary {
      plan_name: string | null;
      plan_cost_eur: number;
      five_hour_remaining_pct: number | null;
      five_hour_reset_at: string | null;
      weekly_remaining_pct: number | null;
      weekly_reset_at: string | null;
      monthly_remaining_pct: number | null;
      monthly_reset_at: string | null;
      credits_remaining: number | null;
      interactions: number;
      plugin_calls: number;
      skills_used: number;
      last_synced: string | null;
    }

    let codexPlanName = (codexData?.plan_name as string) ?? null;
    // Fallback: old syncs may have stored "Unknown" — resolve to a known plan
    if (!codexPlanName || codexPlanName === 'Unknown') codexPlanName = 'ChatGPT Plus';
    let codexPlanCost = codexPlanName ? (await getPlanPrice(codexPlanName)) ?? 0 : 0;
    // Second fallback: if ChatGPT Plus isn't in plan_pricing, try others
    if (codexPlanCost === 0) codexPlanCost = (await getPlanPrice('ChatGPT Pro')) ?? 0;
    const codex: CodexSummary | null = codexRow?.[0] ? {
      plan_name: codexPlanName,
      plan_cost_eur: codexPlanCost,
      five_hour_remaining_pct: (codexData?.five_hour_remaining_pct as number) ?? null,
      five_hour_reset_at: (codexData?.five_hour_reset_at as string) ?? null,
      weekly_remaining_pct: (codexData?.weekly_remaining_pct as number) ?? null,
      weekly_reset_at: (codexData?.weekly_reset_at as string) ?? null,
      monthly_remaining_pct: (codexData?.monthly_remaining_pct as number) ?? null,
      monthly_reset_at: (codexData?.monthly_reset_at as string) ?? null,
      credits_remaining: (codexData?.credits_remaining as number) ?? null,
      interactions: (codexData?.interactions as number) ?? 0,
      plugin_calls: (codexData?.plugin_calls as number) ?? 0,
      skills_used: (codexData?.skills_used as number) ?? 0,
      last_synced: codexRow[0].timestamp
    } : null;

    // -------- OpenAI API month-to-date usage (from platform.openai.com) ---------
    const openaiApiRow = await allQuery<{ cost_usd: number; response_metadata: string | null; timestamp: string }>(
      `SELECT cost_usd, response_metadata, timestamp
       FROM usage_records
       WHERE source = 'openai_api_sync' AND user_id = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user!.id]
    );
    let openaiApiMeta: Record<string, unknown> | null = null;
    if (openaiApiRow?.[0]?.response_metadata) {
      try { openaiApiMeta = JSON.parse(openaiApiRow[0].response_metadata) as Record<string, unknown>; } catch { openaiApiMeta = null; }
    }

    interface OpenAiApiSummary {
      organization_name: string;
      period_start: string;
      period_end: string;
      cost_usd: number;
      total_input_tokens: number;
      total_output_tokens: number;
      requests: number;
      last_synced: string | null;
    }

    const openaiApi: OpenAiApiSummary | null = openaiApiRow?.[0] ? {
      organization_name: (openaiApiMeta?.organization_name as string) || '',
      period_start: (openaiApiMeta?.period_start as string) || '',
      period_end: (openaiApiMeta?.period_end as string) || '',
      cost_usd: openaiApiRow[0].cost_usd || 0,
      total_input_tokens: (openaiApiMeta?.input_tokens as number) ?? (openaiApiMeta?.total_input_tokens as number) ?? 0,
      total_output_tokens: (openaiApiMeta?.output_tokens as number) ?? (openaiApiMeta?.total_output_tokens as number) ?? 0,
      requests: (openaiApiMeta?.requests as number) ?? 0,
      last_synced: openaiApiRow[0].timestamp
    } : null;

    // -------- Cline subscription data (scraper from app.cline.bot) ---------
    const clineRow = await getQuery<{
      timestamp: string;
      response_metadata: string | null;
    }>(
      `SELECT timestamp, response_metadata
       FROM usage_records
       WHERE source = 'cline_sync'
         AND user_id = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user!.id]
    );

    // Also load the user's explicit plan selection from provider_config
    const clineConfig = await getQuery<{ plan_name: string | null }>(
      `SELECT plan_name FROM provider_config
       WHERE user_id = ? AND provider_name = 'cline'`,
      [req.user!.id]
    );

    interface ClineMeta {
      plan_name?: string | null;
      plan_tier?: string | null;
      billing_end?: string | null;
      five_hour_pct?: number | null;
      five_hour_reset_in?: string | null;
      weekly_pct?: number | null;
      weekly_reset_in?: string | null;
      monthly_pct?: number | null;
      monthly_reset_in?: string | null;
      scraped_at?: string;
    }

    let clineMeta: ClineMeta | null = null;
    if (clineRow?.response_metadata) {
      try {
        clineMeta = JSON.parse(clineRow.response_metadata) as ClineMeta;
      } catch {
        clineMeta = null;
      }
    }

    // Prefer user's explicit selection in provider_config over scraper's plan_name
    const clinePlanName = clineConfig?.plan_name ?? clineMeta?.plan_name ?? null;
    const clinePlanCost = clinePlanName ? (await getPlanPrice(clinePlanName)) ?? 0 : 0;

    const consoleModelDay = await allQuery<{ model: string; input_tokens: number; output_tokens: number; cost_usd: number }>(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cost_usd) as cost_usd
       FROM usage_records
       WHERE source = 'anthropic_console_cost_day'
         AND date(timestamp) = date('now')
         AND user_id = ?
       GROUP BY model
       ORDER BY cost_usd DESC`,
      [req.user!.id]
    );

    const consoleModelMonth = await allQuery<{ model: string; input_tokens: number; output_tokens: number; cost_usd: number }>(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cost_usd) as cost_usd
       FROM usage_records
       WHERE source = 'anthropic_console_cost_month'
         AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
         AND user_id = ?
       GROUP BY model
       ORDER BY cost_usd DESC`,
      [req.user!.id]
    );

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
        opencode_go: opencodeGo,
        zai,
        opencode_api: opencodeApi,
        codex,
        openai_api: openaiApi,
        cline: clineRow ? {
          plan_name: clineMeta?.plan_name ?? null,
          plan_tier: clineMeta?.plan_tier ?? null,
          billing_end: clineMeta?.billing_end ?? null,
          plan_cost_eur: clinePlanCost,
          five_hour_pct: clineMeta?.five_hour_pct ?? null,
          five_hour_reset_in: clineMeta?.five_hour_reset_in ?? null,
          weekly_pct: clineMeta?.weekly_pct ?? null,
          weekly_reset_in: clineMeta?.weekly_reset_in ?? null,
          monthly_pct: clineMeta?.monthly_pct ?? null,
          monthly_reset_in: clineMeta?.monthly_reset_in ?? null,
          last_synced: clineRow.timestamp,
        } : null,
        console_model_breakdown: {
          day: consoleModelDay,
          month: consoleModelMonth
        },
        exchange_rate: {
          usd_to_eur: fx.rate,
          rate_date: fx.rate_date
        }
      }
    });
  } catch (error) {
logger.error({ err: error }, 'Error getting summary:');
    res.status(500).json({ error: 'Internal server error' });
  }
}

interface ModelBreakdownRow {
  model: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_cost: number;
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
    const breakdown = await allQuery<ModelBreakdownRow>(
      `SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(cost) as total_cost
       FROM usage_records
       WHERE ${dateFilter}
         AND user_id = ?
          AND COALESCE(source, '') NOT IN (
            'claude_official_sync',
            'anthropic_console_sync',
            'claude_code_sync',
            'opencode_go_sync',
            'zai_sync'
          )
       GROUP BY model
       ORDER BY total_tokens DESC`,
      [req.user!.id]
    );

    // Per-model category breakdown — used by the "Model × Category" matrix.
    const modelCategoryRows = await allQuery<ModelByCategoryRow>(
      `SELECT
        model,
        category,
        COUNT(*) as count,
        SUM(cost) as cost
       FROM usage_records
       WHERE ${dateFilter}
         AND user_id = ?
         AND category IS NOT NULL AND category != 'Pending'
       GROUP BY model, category
       ORDER BY model, count DESC`,
      [req.user!.id]
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
      models: breakdown || [],
      by_model_category: byModelCategory
    });
  } catch (error) {
logger.error({ err: error }, 'Error getting model breakdown:');
    res.status(500).json({ error: 'Internal server error' });
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
  // Cycle-end ISO date (YYYY-MM-DD) — the date the user's billing/limit
  // cycle resets. Field is named `month` for backwards compatibility with
  // the frontend, but the value is now a per-cycle identifier rather than
  // a calendar month, so a single billing period that straddles a calendar
  // month boundary is counted exactly once.
  month: string;
  plan_name: string | null;
  additional_eur: number;
  subscription_eur: number;
  total_eur: number;
}

const SHORT_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  // German month names (additive — English abbreviations above stay)
  'Jan.': 0, 'Jän.': 0, Jän: 0, Jänner: 0, Januar: 0,
  Feber: 1, Februar: 1,
  Mär: 2, März: 2,
  April: 3,
  Mai: 4,
  Juni: 5,
  Juli: 6,
  August: 7,
  Sept: 8, September: 8,
  Okt: 9, Oktober: 9,
  November: 10,
  Dez: 11, Dezember: 11
};

/**
 * Convert claude.ai's short reset_date string (e.g. "Jun 1") into a full
 * ISO date by inferring the year from the record's timestamp. If the reset
 * month is earlier than the record month (or same month but earlier day),
 * the reset belongs to next year.
 */
function parseResetDate(resetStr: string | null | undefined, recordTs: string): string | null {
  if (!resetStr) return null;
  const s = resetStr.trim();

  let monthStr: string;
  let day: number;

  // Try English "May 1" format
  let m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (m && m[1] && m[2]) {
    monthStr = m[1];
    day = parseInt(m[2], 10);
  } else {
    // Try German "1. Mai" format
    m = s.match(/^(\d{1,2})\.?\s+([A-Za-z]{3,9})$/);
    if (!m || !m[1] || !m[2]) return null;
    monthStr = m[2];
    day = parseInt(m[1], 10);
  }

  const monthIdx = SHORT_MONTHS[monthStr.slice(0, 3)];
  if (monthIdx === undefined) return null;
  if (isNaN(day) || day < 1 || day > 31) return null;

  const ts = new Date(recordTs.includes('T') ? recordTs : recordTs.replace(' ', 'T') + 'Z');
  let year = ts.getUTCFullYear();
  const tsMonth = ts.getUTCMonth();
  const tsDay = ts.getUTCDate();
  if (monthIdx < tsMonth || (monthIdx === tsMonth && day < tsDay)) {
    year++;
  }
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Return all-time spending grouped by billing cycle. Each unique reset_date
 * (cycle end) yields one row, using the latest snapshot in that cycle for
 * the cumulative additional spend. Plan subscription cost is looked up from
 * plan_pricing per the snapshot's plan_name and counted once per cycle.
 */
export async function getSpendingTotal(req: Request, res: Response): Promise<void> {
  try {
    // Fetch all claude.ai sync rows; cycle bucketing happens in JS because
    // SQLite doesn't easily handle the "Jun 1" -> ISO conversion with year
    // inference from the record timestamp.
    const allRows = await allQuery<{
      cost_eur: number;
      input_tokens: number;
      response_metadata: string | null;
      timestamp: string;
    }>(
      `SELECT cost as cost_eur, input_tokens, response_metadata, timestamp
       FROM usage_records
       WHERE source = 'claude_official_sync'
         AND user_id = ?
       ORDER BY timestamp DESC`,
      [req.user!.id]
    );

    interface CycleAccumulator {
      cycleEnd: string;
      plan_name: string | null;
      additional_eur: number;
      latestTs: string;
    }
    const byCycle = new Map<string, CycleAccumulator>();

    for (const row of allRows) {
      let meta: { plan_name?: string | null; reset_date?: string | null; spent_eur?: number } | null = null;
      try {
        meta = row.response_metadata ? JSON.parse(row.response_metadata) : null;
      } catch {
        meta = null;
      }
      const cycleEnd = parseResetDate(meta?.reset_date, row.timestamp);
      if (!cycleEnd) continue; // skip rows with no parseable reset_date

      const spent = typeof meta?.spent_eur === 'number'
        ? meta.spent_eur
        : (row.cost_eur ?? row.input_tokens / 1000);
      const planName = meta?.plan_name ?? null;

      const existing = byCycle.get(cycleEnd);
      if (!existing || row.timestamp > existing.latestTs) {
        byCycle.set(cycleEnd, {
          cycleEnd,
          plan_name: planName,
          additional_eur: spent,
          latestTs: row.timestamp
        });
      }
    }

    const cycles = Array.from(byCycle.values()).sort((a, b) =>
      b.cycleEnd.localeCompare(a.cycleEnd)
    );

    // Stale-carryover guard: right after a cycle resets, claude.ai's dashboard
    // can keep displaying the previous cycle's final spent_eur for a while
    // before refreshing to the new cycle's actual value. If the in-progress
    // cycle's spent_eur matches the previous cycle's exactly, treat it as
    // cached carryover and reset to 0 — real new spending will diverge from
    // the old value and the next sync will pick it up correctly.
    const STALE_EPS = 0.01;
    if (cycles.length >= 2) {
      const current = cycles[0];
      const prev = cycles[1];
      if (
        current && prev &&
        current.additional_eur > 0 &&
        Math.abs(current.additional_eur - prev.additional_eur) < STALE_EPS
      ) {
        current.additional_eur = 0;
      }
    }

    const months: MonthSpendRow[] = [];
    for (const c of cycles) {
      const subscription_eur = c.plan_name ? (await getPlanPrice(c.plan_name)) ?? 0 : 0;
      months.push({
        month: c.cycleEnd,
        plan_name: c.plan_name,
        additional_eur: c.additional_eur,
        subscription_eur,
        total_eur: subscription_eur + c.additional_eur
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
         WHERE user_id = ?
           AND ((source = 'anthropic_console_sync' AND COALESCE(workspace, '') != 'Claude Code')
            OR source = 'claude_code_sync')
       )
       WHERE rn = 1`,
      [req.user!.id]
    );

    // `since` reflects when tracking actually began across ALL claude.ai
    // sources, not just claude_official_sync. The official sync started
    // later (it scrapes the Claude.ai dashboard), but per-message claude_ai
    // rows often go back further — those count as real tracking history.
    const earliestOverall = await getQuery<{ first_ts: string | null }>(
      `SELECT MIN(timestamp) as first_ts
         FROM usage_records
        WHERE user_id = ?
          AND source IN ('claude_official_sync', 'claude_ai', 'anthropic_console_sync', 'claude_code_sync', 'opencode_go_sync', 'zai_sync')`,
      [req.user!.id]
    );
    const since = earliestOverall?.first_ts ? earliestOverall.first_ts.slice(0, 10) : null;
    const apiTotalUsd = apiTotalRow?.total_usd ?? 0;

    // Convert API USD to EUR using the latest stored exchange rate so the
    // dashboard can display a single combined total. The rate metadata is
    // included alongside so the UI can render a transparency line.
    const fx = await convertUsdToEur(apiTotalUsd);

    // ChatGPT Pro subscription cost (from codex_sync plan_name)
    const codexPlanRow = await getQuery<{ response_metadata: string | null }>(
      `SELECT response_metadata FROM usage_records
       WHERE source = 'codex_sync' AND user_id = ? AND response_metadata IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user!.id]
    );
    let codexPlanName: string | null = null;
    let codexMonthlyEur = 0;
    if (codexPlanRow?.response_metadata) {
      try {
        const md = JSON.parse(codexPlanRow.response_metadata) as { plan_name?: string };
        codexPlanName = md?.plan_name ?? null;
        if (codexPlanName) codexMonthlyEur = (await getPlanPrice(codexPlanName)) ?? 0;
      } catch { /* ignore */ }
    }

    // OpenCode Go subscription cost — fixed monthly fee added to totals.
    const opencodeGoRow = await getQuery<{ monthly_eur: number }>(
      `SELECT monthly_eur FROM plan_pricing WHERE plan_name = 'OpenCode Go'`
    );
    const opencodeGoMonthlyEur = opencodeGoRow?.monthly_eur ?? 0;
    const opencodeGoTotalEur = opencodeGoMonthlyEur > 0 ? opencodeGoMonthlyEur * Math.max(1, months.length) : 0;

    // z.ai GLM Coding Plan subscription cost — fixed monthly fee. The plan name
    // is dynamic (Lite/Pro/Max), so resolve it from the latest zai_sync snapshot
    // and look its price up in plan_pricing (kept current by the sync upsert).
    const zaiSyncRow = await getQuery<{ response_metadata: string | null }>(
      `SELECT response_metadata FROM usage_records
       WHERE source = 'zai_sync' AND user_id = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user!.id]
    );
    let zaiPlanName: string | null = null;
    if (zaiSyncRow?.response_metadata) {
      try {
        const m = JSON.parse(zaiSyncRow.response_metadata) as { plan_name?: string | null };
        zaiPlanName = typeof m.plan_name === 'string' ? m.plan_name : null;
      } catch {
        zaiPlanName = null;
      }
    }
    const zaiMonthlyEur = zaiPlanName ? (await getPlanPrice(zaiPlanName)) ?? 0 : 0;
    const zaiTotalEur = zaiMonthlyEur > 0 ? zaiMonthlyEur * Math.max(1, months.length) : 0;

    // OpenCode API key usage — cumulative cost_usd from per-key aggregates.
    const opencodeApiCostRow = await getQuery<{ total_usd: number }>(
      `SELECT SUM(cost_usd) as total_usd
       FROM usage_records
       WHERE source = 'opencode_api_sync'
         AND user_id = ?
         AND response_metadata LIKE '%per_key_aggregate%'`,
      [req.user!.id]
    );
    const opencodeApiTotalUsd = opencodeApiCostRow?.total_usd ?? 0;
    const opencodeApiFx = await convertUsdToEur(opencodeApiTotalUsd);

    // Cline subscription cost — plan-based, no scraper. Resolve from
    // provider_config (user-set plan name) → plan_pricing lookup.
    const clineConfig = await getQuery<{ plan_name: string | null }>(
      `SELECT plan_name FROM provider_config
       WHERE user_id = ? AND provider_name = 'cline'`,
      [req.user!.id]
    );
    const clinePlanName = clineConfig?.plan_name ?? null;
    const clineMonthlyEur = clinePlanName ? (await getPlanPrice(clinePlanName)) ?? 0 : 0;
    const clineTotalEur = clineMonthlyEur > 0 ? clineMonthlyEur * Math.max(1, months.length) : 0;

    // OpenAI API month-to-date cost
    const openaiApiCostRow = await getQuery<{ total_usd: number }>(
      `SELECT SUM(cost_usd) as total_usd
       FROM usage_records
       WHERE source = 'openai_api_sync' AND user_id = ?`,
      [req.user!.id]
    );
    const openaiApiTotalUsd = openaiApiCostRow?.total_usd ?? 0;
    const openaiApiFx = await convertUsdToEur(openaiApiTotalUsd);

    // Add all new sources to the earliest-overall source list
    const earliestOverall2 = await getQuery<{ first_ts: string | null }>(
      `SELECT MIN(timestamp) as first_ts
         FROM usage_records
        WHERE user_id = ?
          AND source IN ('claude_official_sync', 'claude_ai', 'anthropic_console_sync', 'claude_code_sync', 'opencode_go_sync', 'zai_sync', 'opencode_api_sync', 'codex_sync', 'openai_api_sync', 'cline_sync')`,
      [req.user!.id]
    );
    const since2 = earliestOverall2?.first_ts ? earliestOverall2.first_ts.slice(0, 10) : since;

    res.json({
      since: since2,
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
      opencode_go: {
        monthly_eur: opencodeGoMonthlyEur,
        total_eur: opencodeGoTotalEur
      },
      zai: {
        monthly_eur: zaiMonthlyEur,
        total_eur: zaiTotalEur
      },
      codex: {
        plan_name: codexPlanName,
        monthly_eur: codexMonthlyEur,
        total_eur: codexMonthlyEur > 0 ? codexMonthlyEur * Math.max(1, months.length) : 0
      },
      opencode_api: {
        total_usd: opencodeApiTotalUsd,
        total_eur: opencodeApiFx.eur
      },
      openai_api: {
        total_usd: openaiApiTotalUsd,
        total_eur: openaiApiFx.eur
      },
      cline: {
        plan_name: clinePlanName,
        monthly_eur: clineMonthlyEur,
        total_eur: clineTotalEur
      },
      grand_total_eur: claudeAiTotalEur + fx.eur + opencodeGoTotalEur + zaiTotalEur + opencodeApiFx.eur + openaiApiFx.eur + (codexMonthlyEur > 0 ? codexMonthlyEur * Math.max(1, months.length) : 0) + clineTotalEur,
      exchange_rate: {
        usd_to_eur: fx.rate,
        rate_date: fx.rate_date
      }
    });
  } catch (error) {
logger.error({ err: error }, 'Error getting spending total:');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getConsoleKeys(req: Request, res: Response): Promise<void> {
  try {
    // Latest snapshot per (key_name, key_id_suffix) across both
    // anthropic_console_sync (regular API keys) and claude_code_sync
    // (Claude Code keys + team members). Keys that belong to multiple
    // workspaces (same key_id_suffix, different workspace columns) are
    // merged into a single row with combined workspace names and summed
    // cost, so the same physical key doesn't appear as a duplicate.
    const keys = await allQuery<ConsoleKeyRowWithSource>(
      `SELECT
        key_name,
        group_concat(DISTINCT workspace ORDER BY workspace) as workspace,
        key_id_suffix,
        SUM(cost_usd) as cost_usd,
        MAX(timestamp) as last_synced,
        source,
        MAX(response_metadata) as response_metadata
       FROM (
         SELECT key_name, workspace, key_id_suffix, cost_usd, timestamp,
                source, response_metadata,
                ROW_NUMBER() OVER (
                  PARTITION BY workspace, key_id_suffix ORDER BY timestamp DESC
                ) as rn
         FROM usage_records
         WHERE user_id = ?
           AND ((source = 'anthropic_console_sync' AND COALESCE(workspace, '') != 'Claude Code')
            OR source = 'claude_code_sync')
       )
       WHERE rn = 1
       GROUP BY key_name, key_id_suffix
       HAVING key_id_suffix IS NOT NULL
       ORDER BY cost_usd DESC NULLS LAST`,
      [req.user!.id]
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
logger.error({ err: error }, 'Error getting console keys:');
    res.status(500).json({ error: 'Internal server error' });
  }
}

const SYNC_SOURCES_FILTER = `AND COALESCE(source, '') NOT IN (
  'claude_official_sync', 'anthropic_console_sync', 'claude_code_sync', 'opencode_go_sync', 'zai_sync'
)`;

interface HistoryQuery {
  limit?: string;
  offset?: string;
  days?: string;
}

export async function getHistory(
  req: Request<unknown, unknown, unknown, HistoryQuery>,
  res: Response
): Promise<void> {
  try {
    const { limit = '50', offset = '0', days } = req.query;

    if (days) {
      const daysNum = parseInt(days as string, 10);

      const dailyHistory = await allQuery(
        `SELECT
          date(timestamp) as date,
          SUM(input_tokens) as tokens_in,
          SUM(output_tokens) as tokens_out,
          SUM(cost) as cost_eur,
          COUNT(*) as request_count
         FROM usage_records
         WHERE user_id = ?
           AND date(timestamp) >= date('now', ?)
           ${SYNC_SOURCES_FILTER}
         GROUP BY date(timestamp)
         ORDER BY date ASC`,
        [req.user!.id, `-${daysNum} days`]
      );

      res.json({ days: dailyHistory || [] });
      return;
    }

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    const history = await allQuery(
      `SELECT
        id, model, input_tokens, output_tokens, total_tokens, cost,
        timestamp, conversation_id
       FROM usage_records
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [req.user!.id, limitNum, offsetNum]
    );

    res.json({
      records: (history as UsageRecord[]) || [],
      limit: limitNum,
      offset: offsetNum
    });
  } catch (error) {
logger.error({ err: error }, 'Error getting history:');
    res.status(500).json({ error: 'Internal server error' });
  }
}
