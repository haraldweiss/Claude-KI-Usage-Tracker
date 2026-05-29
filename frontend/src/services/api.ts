// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
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
  OptimizationOpportunity,
  ConsoleKeyRecord,
  PlanPricingRow,
  SpendingTotal,
  CurrentUser,
  ApiTokenInfo,
  AdminUserRow,
  AdminStats,
  PlanHistoryRow,
  PendingPlanChange
} from '../types/api';

// Use relative path for API calls — works both locally and on production VPS
// On production, Apache routes /api to the backend (port 3001)
const API_BASE = '/api';

/**
 * Central fetch helper.
 * - Sends cookies for all requests (credentials: 'include')
 * - Only /auth/request omits credentials (user doesn't have session yet)
 * - Redirects to /login on 401, unless the request itself is an /auth/ call
 *   (those handle their own auth flow and must not loop)
 */
export async function apiCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isInitialAuthRequest = path.startsWith('/auth/request');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: isInitialAuthRequest ? 'omit' : 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.location.assign('/login');
    throw new Error('redirecting to login');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 204 No Content — return undefined cast to T
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Usage endpoints
// ---------------------------------------------------------------------------

/**
 * Fetch usage summary statistics
 */
export async function getSummary(period: Period = 'day'): Promise<UsageSummaryData> {
  return apiCall<UsageSummaryData>(`/usage/summary?period=${period}`);
}

/**
 * Fetch model usage breakdown
 */
export async function getModelBreakdown(): Promise<{ models: ModelBreakdown[] }> {
  return apiCall<{ models: ModelBreakdown[] }>('/usage/models');
}

/**
 * Fetch usage history with pagination
 */
export async function getHistory(
  limit: number = 50,
  offset: number = 0
): Promise<{ records: UsageHistoryRecord[]; total: number }> {
  return apiCall<{ records: UsageHistoryRecord[]; total: number }>(
    `/usage/history?limit=${limit}&offset=${offset}`
  );
}

/**
 * Fetch the per-key snapshot of the most recent Anthropic Console scrape.
 * Used by the Combined Cost tab to render the per-key drilldown table.
 */
export async function getConsoleKeys(): Promise<{ keys: ConsoleKeyRecord[] }> {
  return apiCall<{ keys: ConsoleKeyRecord[] }>('/usage/console/keys');
}

/**
 * All-time spending across both claude.ai (subscription + additional) and
 * the Anthropic API. Returns one entry per month with claude.ai data.
 */
export async function getSpendingTotal(): Promise<SpendingTotal> {
  return apiCall<SpendingTotal>('/usage/spending-total');
}

// ---------------------------------------------------------------------------
// Pricing endpoints
// ---------------------------------------------------------------------------

/**
 * List the current plan-subscription pricing rows (Pro / Max / Team / …).
 */
export async function getPlanPricing(): Promise<{ plans: PlanPricingRow[] }> {
  return apiCall<{ plans: PlanPricingRow[] }>('/pricing/plans');
}

/**
 * Update one plan's monthly EUR price. Marks the row as 'manual' so the
 * daily refresh job won't override the user's edit.
 */
export async function updatePlanPricing(planName: string, monthlyEur: number): Promise<void> {
  return apiCall<void>(`/pricing/plans/${encodeURIComponent(planName)}`, {
    method: 'PUT',
    body: JSON.stringify({ monthly_eur: monthlyEur })
  });
}

/**
 * Fetch current pricing for all models
 */
export async function getPricing(): Promise<{ pricing: PricingData[] }> {
  return apiCall<{ pricing: PricingData[] }>('/pricing');
}

/**
 * Update pricing for a specific model
 */
export async function updatePricing(
  model: string,
  inputPrice: number,
  outputPrice: number
): Promise<PricingData> {
  return apiCall<PricingData>(`/pricing/${encodeURIComponent(model)}`, {
    method: 'PUT',
    body: JSON.stringify({ input_price: inputPrice, output_price: outputPrice })
  });
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
  return apiCall<void>(`/pricing/${encodeURIComponent(model)}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// ---------------------------------------------------------------------------
// Recommendation endpoints
// ---------------------------------------------------------------------------

/**
 * Get model recommendation for a task
 */
export async function recommendModel(
  taskDescription: string,
  constraints?: Record<string, unknown>
): Promise<{ success: boolean; recommendation?: ModelRecommendation; error?: string }> {
  return apiCall<{ success: boolean; recommendation?: ModelRecommendation; error?: string }>(
    '/recommend',
    {
      method: 'POST',
      body: JSON.stringify({ taskDescription, constraints: constraints || {} })
    }
  );
}

/**
 * Fetch model performance analysis for a period
 */
export async function getModelAnalysis(period: Period = 'month'): Promise<ModelAnalysis> {
  return apiCall<ModelAnalysis>(`/recommend/analysis/models?period=${period}`);
}

/**
 * Fetch cost optimization opportunities for a period
 */
export async function getOptimizationOpportunities(
  period: Period = 'month'
): Promise<{ success: boolean; opportunities?: OptimizationOpportunity[]; error?: string; [key: string]: unknown }> {
  return apiCall<{ success: boolean; opportunities?: OptimizationOpportunity[]; error?: string; [key: string]: unknown }>(
    `/recommend/analysis/opportunities?period=${period}`
  );
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

/**
 * Request a magic-link / one-time login email for the given address.
 */
export const requestMagicLink = (email: string) =>
  apiCall<{ ok: true }>('/auth/request', { method: 'POST', body: JSON.stringify({ email }) });

/**
 * Return the currently authenticated user, or throw on 401.
 * Note: 401 on /auth/me does NOT redirect (path starts with /auth/).
 */
export const getCurrentUser = () => apiCall<CurrentUser>('/auth/me');

/**
 * Log out the current session.
 * Uses raw fetch intentionally — the cookie is already being invalidated server-side,
 * so we must not let the 401 interceptor cause a redirect loop.
 */
export const logout = () =>
  fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });

// ---------------------------------------------------------------------------
// Account endpoints
// ---------------------------------------------------------------------------

/** Return the current user's account details. */
export const getAccount = () => apiCall<CurrentUser>('/account');

/** Patch mutable fields on the current user's account. */
export const patchAccount = (
  body: Partial<{ display_name: string; plan_name: string; monthly_limit_eur: number }>
) => apiCall<CurrentUser>('/account', { method: 'PATCH', body: JSON.stringify(body) });

/** Permanently delete the current user's account. */
export const deleteAccount = () => apiCall<void>('/account', { method: 'DELETE' });

/** Return the current user's API token info (null if none exists). */
export const getApiToken = () => apiCall<ApiTokenInfo | null>('/account/token');

/** Issue a new API token (rotates any existing token). */
export const rotateApiToken = (label?: string) =>
  apiCall<{ token: string; id: number; label: string }>('/account/token', {
    method: 'POST',
    body: JSON.stringify({ label })
  });

/** Revoke the current API token. */
export const revokeApiToken = () => apiCall<void>('/account/token', { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

/** List all users (admin only). */
export const adminListUsers = () => apiCall<{ users: AdminUserRow[] }>('/admin/users');

/** Update a user record by ID (admin only). */
export const adminPatchUser = (id: number, body: Partial<AdminUserRow>) =>
  apiCall<AdminUserRow>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

/** Delete a user by ID (admin only). */
export const adminDeleteUser = (id: number) =>
  apiCall<void>(`/admin/users/${id}`, { method: 'DELETE' });

/** Return aggregate admin stats. */
export const adminStats = () => apiCall<AdminStats>('/admin/stats');

// ---------------------------------------------------------------------------
// Plan-schedule endpoints
// ---------------------------------------------------------------------------

/** Return the current user's plan-change history, DESC by effective_from. */
export const getPlanHistory = (limit?: number) =>
  apiCall<PlanHistoryRow[]>(
    `/account/plan-history${limit ? `?limit=${limit}` : ''}`
  );

/** Return the user's next pending plan change, or null. */
export const getPlanPending = () =>
  apiCall<PendingPlanChange | null>('/account/plan-pending');

/** Schedule a future plan change. Throws 400 on validation errors. */
export const postPlanSchedule = (body: {
  plan_name: string;
  effective_from: string;
  note?: string;
}) =>
  apiCall<{ id: number }>('/account/plan-schedule', {
    method: 'POST',
    body: JSON.stringify(body),
  });

/** Cancel all pending scheduled plan changes for the current user. */
export const deletePlanSchedule = () =>
  apiCall<void>('/account/plan-schedule', { method: 'DELETE' });
