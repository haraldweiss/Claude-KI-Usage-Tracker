/**
 * Service Layer Type Definitions
 * Defines return types and interfaces for service methods
 */

import { Period } from './models';

// ============================================================================
// PRICING SERVICE TYPES
// ============================================================================

export interface PricingValidation {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface CostCalculation {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

export interface PricingUpdateResult {
  success: boolean;
  model: string;
  oldPricing?: { input_price: number; output_price: number };
  newPricing: { input_price: number; output_price: number };
  affectedRecords?: number;
}

export interface RecalculateCostsResult {
  success: boolean;
  model: string;
  recordsUpdated: number;
  message: string;
}

// ============================================================================
// MODEL RECOMMENDATION SERVICE TYPES
// ============================================================================

/**
 * Task complexity analysis result
 * @property complexity - Complexity level from 1-10 (1=very simple, 10=extremely complex)
 * @property category - Complexity category (simple→Haiku, medium→Sonnet, complex→Opus)
 * @property matchedKeywords - Keywords from description that influenced classification
 * @property reasoning - Explanation of complexity determination
 */
export interface TaskComplexity {
  complexity: number;
  category: 'simple_task' | 'medium_task' | 'complex_task' | 'general';
  matchedKeywords: string[];
  reasoning?: string;
}

/**
 * Safety score based on historical success rates
 * @property score - Score from 0-100 (0=unsafe, 100=fully safe)
 * @property basis - Data source: 'historical_data' (actual records), 'no_data' (fallback), 'low_sample_size' (insufficient data)
 * @property successRate - Percentage of successful requests (0-1)
 * @property errorCount - Number of errors recorded
 * @property sampleSize - Number of historical records analyzed
 */
export interface SafetyScore {
  score: number;
  basis: 'historical_data' | 'no_data' | 'low_sample_size';
  successRate?: number;
  errorCount?: number;
  sampleSize?: number;
}

/**
 * Cost efficiency score
 * @property score - Score from 0-100 (0=expensive, 100=cheap)
 * @property estimatedCostPerRequest - Average cost per API call
 * @property currency - ISO currency code (e.g., 'USD')
 * @property reasoning - Explanation of cost calculation
 */
export interface CostScore {
  score: number;
  estimatedCostPerRequest: number;
  currency: string;
  reasoning?: string;
}

/**
 * Complete model recommendation with scores and alternatives
 * @property model - Recommended Claude model (e.g., 'claude-3-haiku', 'claude-3-sonnet')
 * @property safetyScore - Safety score from 0-100 (0=unsafe, 100=fully safe)
 * @property costScore - Cost efficiency from 0-100 (0=expensive, 100=cheap)
 * @property overallScore - Weighted recommendation score 0-100 (70% safety, 30% cost)
 * @property confidence - Confidence level from 0-1 based on data quality
 */
export interface ModelRecommendationResult {
  model: string;
  safetyScore: number;
  costScore: number;
  overallScore: number;
  reasoning: string;
  confidence: number;
  alternatives?: AlternativeModel[];
  estimatedCost?: number;
}

export interface AlternativeModel {
  model: string;
  overallScore: number;
  safetyScore: number;
  costScore: number;
  reasoning: string;
}

export interface ModelRecommendationError {
  error: string;
  fallback: ModelRecommendationResult;
  timestamp: string;
}

export interface ModelAnalyticsRefreshResult {
  success: boolean;
  modelsUpdated: number;
  models: string[];
  timestamp: string;
  message: string;
}

// ============================================================================
// MODEL ANALYSIS SERVICE TYPES
// ============================================================================

export interface ModelPerformanceStats {
  model: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCost: number;
  costPerRequest: number;
  recentErrors: ErrorPattern[];
}

export interface ErrorPattern {
  errorType: string;
  count: number;
  percentage: number;
  examples?: string[];
}

export interface CostOptimizationAnalysis {
  opportunities: OptimizationOpportunity[];
  totalCurrentCost: number;
  totalPotentialCost: number;
  totalSavings: number;
  savingsPercentage: number;
  analyzeCount: number;
}

export interface OptimizationOpportunity {
  id: string;
  taskType: string;
  usedModel: string;
  recommendedModel: string;
  count: number;
  currentCost: number;
  potentialCost: number;
  potentialSavings: number;
  riskScore: number;
  savingsPercentage: string;
  description: string;
}

// ============================================================================
// DATABASE SERVICE TYPES
// ============================================================================

export interface DatabaseConnectionOptions {
  path: string;
  mode?: 'readonly' | 'readwrite' | 'create';
  verbose?: boolean;
}

export interface DatabaseInitResult {
  success: boolean;
  message: string;
  tablesCreated: string[];
  indexesCreated: string[];
}

export interface DatabaseBackupResult {
  success: boolean;
  backupPath: string;
  timestamp: string;
  message: string;
}

// ============================================================================
// UTILITY SERVICE TYPES
// ============================================================================

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginationResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DateRangeFilter {
  startDate: Date;
  endDate: Date;
}

export interface PeriodConfig {
  value: Period;
  lookbackDays: number;
  label: string;
}

// ============================================================================
// VALIDATION SERVICE TYPES
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

export interface NumericRangeValidation {
  isValid: boolean;
  value: number;
  min?: number;
  max?: number;
  errors: string[];
}

// ============================================================================
// CACHING SERVICE TYPES
// ============================================================================

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

export interface CacheManager {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttl?: number): void;
  delete(key: string): boolean;
  clear(): void;
  has(key: string): boolean;
}

// ============================================================================
// METRIC/ANALYTICS SERVICE TYPES
// ============================================================================

export interface MetricsSnapshot {
  timestamp: string;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalRequests: number;
  averageCostPerRequest: number;
  modelBreakdown: Record<string, ModelMetrics>;
}

export interface ModelMetrics {
  requests: number;
  tokens: number;
  cost: number;
  successRate: number;
}

export interface TrendData {
  period: Period;
  dataPoints: TrendDataPoint[];
  average: number;
  min: number;
  max: number;
}

export interface TrendDataPoint {
  timestamp: string;
  value: number;
  label?: string;
}
