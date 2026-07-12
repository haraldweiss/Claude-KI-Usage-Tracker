// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
/**
 * API Response Type Definitions
 * Defines all TypeScript types for API responses and data structures
 */

export interface UsageSummaryData {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  request_count: number;
  combined?: CombinedSpendBreakdown;
}

// Plan B: combined claude.ai + Anthropic Console API spend breakdown.
// Returned by GET /api/usage/summary alongside the existing aggregates.
export interface OpenCodeGoSpend {
  plan_name: string | null;
  continuous_pct: number | null;
  continuous_reset_in: string | null;
  weekly_pct: number | null;
  weekly_reset_in: string | null;
  monthly_pct: number | null;
  monthly_reset_in: string | null;
  last_synced: string;
}

// z.ai GLM Coding Plan subscription. Unlike OpenCode Go's relative reset
// strings, z.ai reports absolute reset timestamps (e.g. "2026-06-21 08:58").
export interface ZaiSpend {
  plan_name: string | null;
  price_usd: number | null;
  auto_renew_date: string | null;
  five_hour_pct: number | null;
  weekly_pct: number | null;
  weekly_reset: string | null;
  monthly_pct: number | null;
  monthly_reset: string | null;
  last_synced: string;
}

// Cline coding assistant — plan-only, no scraper data.
export interface ClineSpend {
  plan_name: string | null;
  plan_cost_eur: number;
  last_synced: string | null;
}

export interface CombinedSpendBreakdown {
  claude_ai: ClaudeAiSpend | null;
  anthropic_api: {
    cost_usd: number;
    cost_eur_equivalent?: number;
    by_workspace: ApiWorkspaceSpend[];
  };
  opencode_go?: OpenCodeGoSpend | null;
  zai?: ZaiSpend | null;
  codex?: {
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
  } | null;
  opencode_api?: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    row_count: number;
    by_key: Array<{
      key_name: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }>;
    total_eur?: number;
  } | null;
  openai_api?: {
    organization_name: string;
    period_start: string;
    period_end: string;
    cost_usd: number;
    total_input_tokens: number;
    total_output_tokens: number;
    requests: number;
    last_synced: string | null;
  } | null;
  cline?: ClineSpend | null;
  exchange_rate?: {
    usd_to_eur: number;
    rate_date: string | null;
  };
}

export interface ClaudeAiSpend {
  cost_eur: number;
  weekly_used_pct: number;
  last_synced: string;
  meta?: ClaudeAiUsageMeta | null;
}

export interface ClaudeAiUsageMeta {
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

export interface ApiWorkspaceSpend {
  workspace: string;
  cost_usd: number;
}

export interface ConsoleKeyRecord {
  key_name: string | null;
  workspace: string | null;
  key_id_suffix: string | null;
  cost_usd: number | null;
  last_synced: string;
  source: 'anthropic_console_sync' | 'claude_code_sync';
  lines_accepted?: number | null;
}

export interface PlanPricingRow {
  plan_name: string;
  monthly_eur: number;
  min_seats?: number;
  source: 'manual' | 'auto' | 'tier_default';
  last_updated: string;
}

export interface SpendingTotal {
  since: string | null;
  claude_ai: {
    total_eur: number;
    subscription_eur: number;
    additional_eur: number;
    months: Array<{
      month: string;
      plan_name: string | null;
      additional_eur: number;
      subscription_eur: number;
      total_eur: number;
    }>;
  };
  anthropic_api: {
    total_usd: number;
    total_eur_equivalent?: number;
  };
  opencode_go?: {
    monthly_eur: number;
    total_eur: number;
  };
  zai?: {
    monthly_eur: number;
    total_eur: number;
  };
  cline?: {
    plan_name: string | null;
    monthly_eur: number;
    total_eur: number;
  };
  grand_total_eur?: number;
  exchange_rate?: {
    usd_to_eur: number;
    rate_date: string | null;
  };
}

export interface UsageHistoryRecord {
  id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: string;
  conversation_id: string | null;
  source: string | null;
  task_description?: string | null;
  success_status?: 'success' | 'error' | null;
  response_metadata?: Record<string, unknown> | null;
}

export interface DailyUsageRecord {
  date: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  request_count: number;
}

export interface ModelBreakdown {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
  request_count: number;
  total_cost: number;
}

export interface PricingData {
  model: string;
  input_price: number;
  output_price: number;
  last_updated: string;
  source?: 'manual' | 'auto' | 'tier_default';
  status?: 'active' | 'pending_confirmation' | 'deprecated';
  tier?: 'haiku' | 'sonnet' | 'opus' | 'other' | null;
  api_id?: string | null;
}

export type Period = 'day' | 'week' | 'month';

export interface AlertInfo {
  low_balance: boolean;
  rate_alert: boolean;
  balance_usd: number | null;
  last_topup_usd: number | null;
  today_cost_usd: number;
  avg_daily_cost_usd: number;
  config: {
    low_balance_threshold: number;
    rate_multiplier: number;
  };
}

export interface APIError {
  error: string;
  status: number;
  timestamp: string;
}

// Smart Model Recommendation Types
export interface ModelRecommendation {
  recommended_model: string;
  reasoning: string;
  estimated_cost: number;
  safety_score: number;
  alternatives?: {
    model: string;
    cost_benefit_score: number;
  }[];
}

export interface ModelAnalysis {
  period: string;
  models: {
    model: string;
    success_rate: number;
    avg_cost: number;
    usage_count: number;
  }[];
}

export interface OptimizationOpportunity {
  id: string;
  title: string;
  description: string;
  potential_savings: number;
  recommendation: string;
}

export interface CurrentUser {
  id: number;
  email: string;
  display_name: string | null;
  plan_name: string | null;
  monthly_limit_eur: number | null;
  is_admin: boolean;
}

export interface ApiTokenInfo {
  id: number;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AdminUserRow {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: 0 | 1;
  plan_name: string | null;
  created_at: string;
  last_login_at: string | null;
  record_count: number;
}

export interface AdminStats {
  total_users: number;
  active_last_7d: number;
  total_records: number;
}

export interface PlanHistoryRow {
  id: number;
  user_id: number;
  plan_name: string;
  effective_from: string;
  created_at: string;
  source: 'manual' | 'seed' | 'scheduled';
  note: string | null;
}

export interface PendingPlanChange {
  id: number;
  plan_name: string;
  effective_from: string;
  note: string | null;
}

export interface AlertState {
  low_balance: boolean;
  rate_alert: boolean;
  balance_usd: number | null;
  last_topup_usd: number | null;
  today_cost_usd?: number;
  avg_daily_cost_usd?: number;
  config: {
    low_balance_threshold: number;
    rate_multiplier: number;
  };
}

/**
 * Provider status info from GET /settings/providers
 */
export interface ProviderInfo {
  key: string;
  display_name: string;
  icon: string;
  status_label: string | null;
  plan_name: string | null;
  derived_status: 'active' | 'no_data' | 'no_plan';
  last_sync: string | null;
  scrape_summary: Record<string, unknown> | null;
}

/**
 * Provider config update body for PATCH /settings/providers/:name
 */
export interface ProviderConfigUpdate {
  status_label?: string;
  plan_name?: string | null;
}
