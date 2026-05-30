// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Typed client for /api/local-usage. Mirrors the controllers in
// backend/src/controllers/localUsageController.ts.
import { apiCall } from './api';

export interface ProviderUserIdRow {
  id: number;
  provider_user_id: string;
  label: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface SourceSummary {
  source: string;          // 'origin_app' value OR 'user:<provider_user_id>' fallback
  label: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgTokensPerCall: number;
  topModel: { model: string; calls: number } | null;
}

export interface LocalUsageSummary {
  period: 'day' | 'week' | 'month';
  total: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    avgTokensPerCall: number;
    topModels: Array<{ model: string; calls: number }>;
  };
  perSource: SourceSummary[];
}

export interface PerIdStatus {
  id: number;
  provider_user_id: string;
  label: string | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface SyncStatus {
  configured: boolean;
  enabled?: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  perId?: PerIdStatus[];
}

export interface ProviderServiceConfig {
  configured: boolean;
  service_url?: string;
  service_token_set?: boolean;
  enabled?: boolean;
  user_ids: ProviderUserIdRow[];
}

export interface ProviderServiceConfigInput {
  service_url: string;
  service_token?: string;
  enabled: boolean;
}

export interface PerIdResult {
  providerUserId: string;
  ok: boolean;
  newEvents: number;
  error?: string;
}

export interface SyncTriggerResult {
  ok: boolean;
  newEvents: number;
  perId: PerIdResult[];
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

export function addProviderUserId(
  input: { provider_user_id: string; label?: string },
): Promise<ProviderUserIdRow> {
  return apiCall<ProviderUserIdRow>('/local-usage/user-ids', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeProviderUserId(id: number): Promise<{ ok: boolean }> {
  return apiCall<{ ok: boolean }>(`/local-usage/user-ids/${id}`, { method: 'DELETE' });
}

export function discoverProviderUsers(): Promise<{ added: Array<{provider_user_id: string; label: string | null}>; skipped: Array<{provider_user_id: string; reason: string}>; total: number }> {
  return apiCall('/local-usage/discover', { method: 'POST' });
}

export function updateProviderUserId(
  id: number,
  patch: { label?: string | null; enabled?: boolean },
): Promise<ProviderUserIdRow> {
  return apiCall<ProviderUserIdRow>(`/local-usage/user-ids/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
