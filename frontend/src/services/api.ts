/**
 * API Service Module
 * Provides typed HTTP client functions for all API endpoints
 */

import {
  UsageSummaryData,
  UsageHistoryRecord,
  ModelBreakdown,
  PricingData,
  Period,
  ModelRecommendation,
  ModelAnalysis,
  OptimizationOpportunity
} from '../types/api';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api`;

/**
 * Fetch usage summary statistics
 */
export async function getSummary(period: Period = 'day'): Promise<UsageSummaryData> {
  const response = await fetch(`${API_BASE}/usage/summary?period=${period}`);
  if (!response.ok) throw new Error('Failed to fetch summary');
  return response.json() as Promise<UsageSummaryData>;
}

/**
 * Fetch model usage breakdown
 */
export async function getModelBreakdown(): Promise<{ models: ModelBreakdown[] }> {
  const response = await fetch(`${API_BASE}/usage/models`);
  if (!response.ok) throw new Error('Failed to fetch model breakdown');
  return response.json() as Promise<{ models: ModelBreakdown[] }>;
}

/**
 * Fetch usage history with pagination
 */
export async function getHistory(
  limit: number = 50,
  offset: number = 0
): Promise<{ records: UsageHistoryRecord[]; total: number }> {
  const response = await fetch(
    `${API_BASE}/usage/history?limit=${limit}&offset=${offset}`
  );
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json() as Promise<{
    records: UsageHistoryRecord[];
    total: number;
  }>;
}

/**
 * Fetch current pricing for all models
 */
export async function getPricing(): Promise<{ pricing: PricingData[] }> {
  const response = await fetch(`${API_BASE}/pricing`);
  if (!response.ok) throw new Error('Failed to fetch pricing');
  return response.json() as Promise<{ pricing: PricingData[] }>;
}

/**
 * Update pricing for a specific model
 */
export async function updatePricing(
  model: string,
  inputPrice: number,
  outputPrice: number
): Promise<PricingData> {
  const response = await fetch(`${API_BASE}/pricing/${encodeURIComponent(model)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_price: inputPrice,
      output_price: outputPrice
    })
  });
  if (!response.ok) throw new Error('Failed to update pricing');
  return response.json() as Promise<PricingData>;
}

/**
 * Confirm pricing for a newly-detected model, optionally overriding prices
 */
export async function confirmPricing(
  model: string,
  inputPrice?: number,
  outputPrice?: number
): Promise<void> {
  const body: Record<string, number> = {};
  if (inputPrice !== undefined) body.inputPrice = inputPrice;
  if (outputPrice !== undefined) body.outputPrice = outputPrice;
  const res = await fetch(`${API_BASE}/pricing/${encodeURIComponent(model)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Confirm failed: HTTP ${res.status}`);
}

/**
 * Get model recommendation for a task
 */
export async function recommendModel(
  taskDescription: string,
  constraints?: Record<string, unknown>
): Promise<{ success: boolean; recommendation?: ModelRecommendation; error?: string }> {
  const response = await fetch(`${API_BASE}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskDescription,
      constraints: constraints || {}
    })
  });
  if (!response.ok) throw new Error('Failed to get recommendation');
  return response.json() as Promise<{ success: boolean; recommendation?: ModelRecommendation; error?: string }>;
}

/**
 * Fetch model performance analysis for a period
 */
export async function getModelAnalysis(period: Period = 'month'): Promise<ModelAnalysis> {
  const response = await fetch(
    `${API_BASE}/recommend/analysis/models?period=${period}`
  );
  if (!response.ok) throw new Error('Failed to fetch model analysis');
  return response.json() as Promise<ModelAnalysis>;
}

/**
 * Fetch cost optimization opportunities for a period
 */
export async function getOptimizationOpportunities(
  period: Period = 'month'
): Promise<{ success: boolean; opportunities?: OptimizationOpportunity[]; error?: string; [key: string]: unknown }> {
  const response = await fetch(
    `${API_BASE}/recommend/analysis/opportunities?period=${period}`
  );
  if (!response.ok) throw new Error('Failed to fetch optimization opportunities');
  return response.json() as Promise<{ success: boolean; opportunities?: OptimizationOpportunity[]; error?: string; [key: string]: unknown }>;
}
