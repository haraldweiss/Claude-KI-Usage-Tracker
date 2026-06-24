// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import { getQuery, runQuery, allQuery } from '../database/sqlite.js';
import logger from '../utils/logger.js';

const KNOWN_PROVIDERS = [
  { key: 'claude_ai',       display_name: 'Claude.ai',          source: 'claude_official_sync',     icon: '🤖' },
  { key: 'anthropic_api',   display_name: 'Anthropic API',      source: 'anthropic_console_sync',   icon: '🔑' },
  { key: 'claude_code',     display_name: 'Claude Code',         source: 'claude_code_sync',         icon: '💻' },
  { key: 'opencode_go',     display_name: 'OpenCode Go',         source: 'opencode_go_sync',         icon: '⚡' },
  { key: 'opencode_api',    display_name: 'OpenCode API',        source: 'opencode_api_sync',        icon: '🔌' },
  { key: 'zai',             display_name: 'z.ai GLM',            source: 'zai_sync',                 icon: '🧪' },
  { key: 'codex',           display_name: 'ChatGPT Codex',       source: 'codex_sync',               icon: '📝' },
  { key: 'openai_api',      display_name: 'OpenAI API',          source: 'openai_api_sync',          icon: '🟢' },
] as const;

interface ProviderConfigRow {
  provider_name: string;
  status_label: string | null;
  plan_name: string | null;
}

interface UsageRow {
  timestamp: string;
  response_metadata: string | null;
  cost: number | null;
}

interface ProviderResponse {
  key: string;
  display_name: string;
  icon: string;
  status_label: string | null;      // user-set label from provider_config
  plan_name: string | null;         // user-set plan from provider_config
  derived_status: 'active' | 'no_data' | 'no_plan';
  last_sync: string | null;
  scrape_summary: Record<string, unknown> | null;
}

/**
 * GET /settings/providers
 * Returns all known providers with config + latest scrape data per user.
 */
export async function getProviders(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    // 1. Load user's provider configs
    const configRows = await allQuery<ProviderConfigRow>(
      `SELECT provider_name, status_label, plan_name FROM provider_config
       WHERE user_id = ?`,
      [userId]
    );
    const configByProvider = new Map<string, ProviderConfigRow>();
    for (const row of configRows) {
      configByProvider.set(row.provider_name, row);
    }

    // 2. Load latest usage row per known source
    const result: ProviderResponse[] = [];

    for (const prov of KNOWN_PROVIDERS) {
      const config = configByProvider.get(prov.key);

      const usageRow = await getQuery<UsageRow>(
        `SELECT timestamp, response_metadata, cost FROM usage_records
         WHERE source = ? AND user_id = ?
         ORDER BY timestamp DESC LIMIT 1`,
        [prov.source, userId]
      );

      let scrapeSummary: Record<string, unknown> | null = null;
      if (usageRow?.response_metadata) {
        try {
          const parsed = JSON.parse(usageRow.response_metadata) as Record<string, unknown>;
          // Extract readable summary fields per provider
          scrapeSummary = summarizeScrape(prov.key, parsed, usageRow);
        } catch {
          scrapeSummary = { raw: usageRow.response_metadata?.slice(0, 200) };
        }
      } else if (usageRow?.cost != null) {
        // Some providers only have cost data (e.g. anthropic_console_sync aggregates)
        const costUsd = usageRow.cost as number;
        scrapeSummary = { total_cost_usd: costUsd };
      }

      const derived_status: 'active' | 'no_data' | 'no_plan' =
        usageRow
          ? (scrapeSummary?.plan_name || scrapeSummary?.total_cost_usd != null
              ? 'active'
              : 'no_plan')
          : 'no_data';

      result.push({
        key: prov.key,
        display_name: prov.display_name,
        icon: prov.icon,
        status_label: config?.status_label ?? null,
        plan_name: config?.plan_name ?? null,
        derived_status,
        last_sync: usageRow?.timestamp ?? null,
        scrape_summary: scrapeSummary,
      });
    }

    res.json({ providers: result });
  } catch (err) {
    logger.error({ err }, 'getProviders error');
    res.status(500).json({ error: 'Failed to load providers' });
  }
}

/**
 * PATCH /settings/providers/:name
 * Update user-set config for a specific provider.
 * Body: { status_label?: string, plan_name?: string }
 */
export async function updateProvider(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const providerName = req.params.name;

    // Validate provider exists
    const known = KNOWN_PROVIDERS.find(p => p.key === providerName);
    if (!known) {
      res.status(404).json({ error: `Unknown provider: ${providerName}` });
      return;
    }

    const { status_label, plan_name } = req.body as {
      status_label?: string;
      plan_name?: string | null;
    };

    // Validate status_label
    if (status_label !== undefined && typeof status_label !== 'string') {
      res.status(400).json({ error: 'status_label must be a string' });
      return;
    }

    // Upsert provider_config
    await runQuery(
      `INSERT INTO provider_config (user_id, provider_name, status_label, plan_name)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, provider_name) DO UPDATE SET
         status_label = COALESCE(excluded.status_label, provider_config.status_label),
         plan_name = COALESCE(excluded.plan_name, provider_config.plan_name)`,
      [
        userId,
        providerName,
        status_label ?? null,
        plan_name ?? null,
      ]
    );

    // Also update plan_pricing if a plan_name is provided
    if (plan_name) {
      await runQuery(
        `UPDATE users SET plan_name = ? WHERE id = ?`,
        [plan_name, userId]
      ).catch((err: Error) => {
        logger.warn({ err }, 'updateProvider: failed to update user.plan_name (non-fatal)');
      });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'updateProvider error');
    res.status(500).json({ error: 'Failed to update provider' });
  }
}

/**
 * Extract a readable summary from the raw response_metadata per provider type.
 */
function summarizeScrape(
  providerKey: string,
  meta: Record<string, unknown>,
  row: UsageRow
): Record<string, unknown> {
  switch (providerKey) {
    case 'claude_ai': {
      const plan = meta.plan_name as string | undefined;
      const spent = meta.spent_eur as number | undefined;
      const session = meta.session_pct as number | undefined;
      return {
        plan_name: plan ?? null,
        spent_eur: spent ?? null,
        session_pct: session ?? null,
        session_limit_hours: meta.session_limit_hours ?? null,
        reset_date: meta.reset_date ?? null,
      };
    }
    case 'anthropic_api': {
      const totalCost = row.cost as number | null;
      const byWorkspace = meta.by_workspace as Array<{ workspace: string; cost_usd: number }> | undefined;
      return {
        total_cost_usd: totalCost ?? null,
        workspace_count: byWorkspace?.length ?? null,
      };
    }
    case 'claude_code': {
      return {
        keys_count: (meta.keys as unknown[])?.length ?? null,
        total_cost_usd: meta.total_cost_usd ?? row.cost ?? null,
      };
    }
    case 'opencode_go': {
      return {
        plan_name: meta.plan_name ?? null,
        continuous_pct: meta.continuous_pct ?? null,
        weekly_pct: meta.weekly_pct ?? null,
        monthly_pct: meta.monthly_pct ?? null,
      };
    }
    case 'opencode_api': {
      return {
        total_cost_usd: meta.total_cost_usd ?? row.cost ?? null,
        total_requests: meta.total_requests ?? null,
      };
    }
    case 'zai': {
      const planInfo = (meta as Record<string, unknown>)?.plan as Record<string, unknown> | undefined;
      return {
        plan_name: meta.plan_name ?? (planInfo?.plan_name as string) ?? null,
        five_hour_pct: meta.five_hour_pct ?? null,
        weekly_pct: meta.weekly_pct ?? null,
        price_usd: meta.price_usd ?? planInfo?.price_usd ?? null,
      };
    }
    case 'codex': {
      return {
        plan_name: meta.plan_name ?? null,
        five_hour_remaining_pct: meta.five_hour_remaining_pct ?? null,
        weekly_remaining_pct: meta.weekly_remaining_pct ?? null,
        credits_remaining: meta.credits_remaining ?? null,
      };
    }
    case 'openai_api': {
      return {
        total_cost_usd: meta.cost_usd ?? row.cost ?? null,
        organization: meta.organization_name ?? null,
        period: meta.period_start ? `${meta.period_start}–${meta.period_end}` : null,
      };
    }
    default:
      return { raw: meta };
  }
}
