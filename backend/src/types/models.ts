/**
 * Database Model Type Definitions
 * Defines the structure of data stored in SQLite
 */

// ============================================================================
// USAGE RECORDS
// ============================================================================

export interface DatabaseUsageRecord {
  id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  timestamp: string;
  conversation_id: string | null;
  source: string | null;
  created_at: string;
  task_description: string | null;
  success_status: string | null;
  response_metadata: string | null;
}

export interface UsageRecordInsert {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  conversation_id?: string;
  source?: SourceType;
  task_description?: string;
  success_status?: SuccessStatus;
  response_metadata?: string;
}

export interface UsageRecordUpdate {
  cost?: number;
  success_status?: SuccessStatus;
  response_metadata?: string;
  task_description?: string;
}

// ============================================================================
// PRICING RECORDS
// ============================================================================

export interface DatabasePricingRecord {
  id: number;
  model: string;
  input_price: number;
  output_price: number;
  last_updated: string;
  source: PricingSource;
}

export interface PricingRecordInsert {
  model: string;
  input_price: number;
  output_price: number;
  source: PricingSource;
}

export interface PricingRecordUpdate {
  input_price?: number;
  output_price?: number;
  source?: PricingSource;
  last_updated?: string;
}

// ============================================================================
// MODEL ANALYSIS (CACHED STATISTICS)
// ============================================================================

export interface ModelAnalysisRecord {
  id?: number;
  model: string;
  total_requests: number;
  success_rate: number;
  error_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  cost_per_request: number;
  last_updated: string;
}

export interface ModelAnalysisInsert {
  model: string;
  total_requests: number;
  success_rate: number;
  error_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  cost_per_request: number;
}

export interface ModelAnalysisUpdate {
  total_requests?: number;
  success_rate?: number;
  error_count?: number;
  avg_input_tokens?: number;
  avg_output_tokens?: number;
  cost_per_request?: number;
  last_updated?: string;
}

// ============================================================================
// AGGREGATE STATISTICS
// ============================================================================

export interface ModelTokenStats {
  model: string;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
}

export interface PeriodTokenStats {
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
}

export interface ErrorStatistics {
  model: string;
  error_type: string;
  count: number;
  percentage: number;
}

// ============================================================================
// DATABASE QUERY RESULT TYPES
// ============================================================================

export interface QueryResult {
  id?: number;
  lastID?: number;
  changes?: number;
}

export interface CountResult {
  count: number;
}

export interface AggregateResult {
  request_count: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_tokens: number | null;
  total_cost: number | null;
}

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

/**
 * Success status enum for tracking API call outcomes
 * Values: 'success', 'error', 'unknown'
 */
export enum SuccessStatus {
  Success = 'success',
  Error = 'error',
  Unknown = 'unknown'
}

/**
 * Source type enum for tracking where usage data originates
 */
export enum SourceType {
  ClaudeAi = 'claude_ai',
  AnthropicApi = 'anthropic_api',
  Extension = 'extension',
  Manual = 'manual',
  // Browser-extension auto-syncs that scrape rendered Anthropic pages.
  ClaudeAiAuto = 'claude_ai_auto',
  ClaudeOfficialSync = 'claude_official_sync',
  AnthropicConsoleSync = 'anthropic_console_sync',
  ClaudeCodeSync = 'claude_code_sync'
}

/**
 * Pricing source enum for tracking pricing data origin
 * Values: 'manual' (user input), 'auto' (scheduled update), 'anthropic' (official)
 */
export enum PricingSource {
  Manual = 'manual',
  Auto = 'auto',
  Anthropic = 'anthropic'
}

/**
 * Period type for time-range queries
 * Supported periods: 'day', 'week', 'month'
 */
export type Period = 'day' | 'week' | 'month';
