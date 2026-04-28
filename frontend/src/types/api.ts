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
  cost: number;
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
