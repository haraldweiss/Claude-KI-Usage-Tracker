// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Typed client for /api/local-usage. Mirrors the controllers in
// backend/src/controllers/localUsageController.ts.
import { apiCall } from './api';

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModels: Array<{ model: string; calls: number }>;
}

export interface SyncStatus {
  configured: boolean;
  enabled?: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
}

export interface ProviderServiceConfig {
  configured: boolean;
  service_url?: string;
  service_token_set?: boolean;
  provider_user_id?: string;
  enabled?: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
}

export interface ProviderServiceConfigInput {
  service_url: string;
  service_token?: string;
  provider_user_id: string;
  enabled: boolean;
}

export interface SyncTriggerResult {
  ok: boolean;
  newEvents: number;
  error?: string;
}

export function getLocalUsageSummary(
  period: 'day' | 'week' | 'month' = 'month',
): Promise<LocalUsageSummary> {
  return apiCall<LocalUsageSummary>(`/local-usage/summary?period=${period}`);
}

export function getLocalUsageSyncStatus(): Promise<SyncStatus> {
  return apiCall<SyncStatus>('/local-usage/sync-status');
}

export function triggerLocalUsageSync(): Promise<SyncTriggerResult> {
  return apiCall<SyncTriggerResult>('/local-usage/sync', { method: 'POST' });
}

export function getProviderServiceConfig(): Promise<ProviderServiceConfig> {
  return apiCall<ProviderServiceConfig>('/local-usage/config');
}

export function updateProviderServiceConfig(
  cfg: ProviderServiceConfigInput,
): Promise<{ ok: boolean }> {
  return apiCall<{ ok: boolean }>('/local-usage/config', {
    method: 'PUT',
    body: JSON.stringify(cfg),
  });
}
