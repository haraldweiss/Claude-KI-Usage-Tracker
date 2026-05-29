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

export interface CombinedSpendBreakdown {
  claude_ai: ClaudeAiSpend | null;
  anthropic_api: {
    cost_usd: number;
    cost_eur_equivalent?: number;
    by_workspace: ApiWorkspaceSpend[];
  };
  opencode_go?: OpenCodeGoSpend | null;
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
