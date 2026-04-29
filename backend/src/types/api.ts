/**
 * API Request/Response Type Definitions
 * Defines all request bodies and response shapes for the Claude Usage Tracker API
 */

import { SuccessStatus, SourceType, PricingSource, Period } from './models';

// ============================================================================
// USAGE TRACKING API TYPES
// ============================================================================

export interface UsageTrackRequest {
  model: string;
  input_tokens: number;
  output_tokens: number;
  conversation_id?: string;
  source?: SourceType;
  task_description?: string;
  success_status?: SuccessStatus;
  response_metadata?: Record<string, unknown> | string | null;
  raw_prompt?: string;
  raw_response?: string;
}

export type CategoryName = 'Code' | 'Research' | 'Analysis' | 'Writing' | 'Support' | 'Other' | 'Pending';

export interface UsageTrackResponse {
  success: boolean;
  id: number;
  cost: string;
}

export interface UsageRecord {
  id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: string;
  conversation_id?: string | null;
  source?: string | null;
  task_description?: string | null;
  success_status?: string | null;
  response_metadata?: string | null;
  category?: CategoryName | null;
  effectiveness_score?: number | null;
  effectiveness_confirmed?: number | null;
  user_category_override?: string | null;
  haiku_reasoning?: string | null;
}

export interface UsageSummary {
  period: Period;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
}

export interface UsageHistory {
  records: UsageRecord[];
  limit: number;
  offset: number;
}

export interface ModelBreakdown {
  models: ModelStats[];
}

export interface ModelStats {
  model: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_cost: number;
}

// ============================================================================
// PRICING API TYPES
// ============================================================================

export interface PricingRecord {
  id: number;
  model: string;
  input_price: number;
  output_price: number;
  last_updated: string;
  source: PricingSource;
}

export interface PricingResponse {
  pricing: PricingRecord[];
}

export interface UpdatePricingRequest {
  input_price: number;
  output_price: number;
}

export interface UpdatePricingResponse {
  success: boolean;
  message: string;
}

// ============================================================================
// MODEL RECOMMENDATION API TYPES
// ============================================================================

export interface RecommendationRequest {
  taskDescription: string;
  constraints?: Record<string, unknown>;
}

export interface RecommendationResponse {
  success: boolean;
  recommendation: ModelRecommendation;
  timestamp: string;
}

export interface ModelRecommendation {
  model: string;
  safetyScore: number;
  costScore: number;
  overallScore: number;
  reasoning: string;
  error?: string;
  fallback?: ModelRecommendation;
}

export interface ModelAnalysisResponse {
  success: boolean;
  period: Period;
  lookbackDays: number;
  analysis: EnrichedModelAnalysis[];
  timestamp: string;
}

export interface EnrichedModelAnalysis {
  model: string;
  total_requests: number;
  success_rate: number;
  error_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  cost_per_request: number;
  last_updated: string;
  errorPatterns: string[];
  successPercent: number;
}

export interface OptimizationOpportunitiesResponse {
  success: boolean;
  period: Period;
  lookbackDays: number;
  recordsAnalyzed: number;
  opportunities: CostOptimizationOpportunity[];
  currentTotalCost: string;
  potentialTotalCost: string;
  totalPotentialSavings: string;
  savingsPercent: string;
  message?: string;
  timestamp: string;
}

export interface CostOptimizationOpportunity {
  taskType: string;
  usedModel: string;
  recommendedModel: string;
  count: number;
  totalCost: number;
  potentialCost: number;
  riskScore: number;
  savings: string;
  potentialSavings: string;
}

// ============================================================================
// ERROR RESPONSE TYPE
// ============================================================================

export interface ErrorResponse {
  error: string;
  status?: number;
  timestamp?: string;
  success?: false;
}

// ============================================================================
// GENERIC RESPONSE ENVELOPE TYPES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
