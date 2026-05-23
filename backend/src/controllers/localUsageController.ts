// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HTTP handlers for /api/local-usage. Auth via requireUser middleware
// (router-level), so req.user is guaranteed present.
import type { Request, Response } from 'express';
import {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  getLocalUsageSummary,
  listProviderUserIds,
  addProviderUserId,
  removeProviderUserId,
  setProviderUserIdEnabled,
  updateProviderUserIdLabel,
  getProviderUserIdRow,
} from '../data/localUsageRepo.js';
import { encryptSecret } from '../utils/secretCrypto.js';
import { syncProviderServiceEvents } from '../services/providerServiceSyncService.js';

function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test((e as Error).message ?? '');
}

export async function getSummary(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const period = (req.query.period as string) ?? 'month';
  if (period !== 'day' && period !== 'week' && period !== 'month') {
    res.status(400).json({ error: 'invalid period' });
    return;
  }
  const summary = await getLocalUsageSummary(userId, period);
  res.json(summary);
}

export async function getSyncStatus(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg) {
    res.json({ configured: false });
    return;
  }
  const ids = await listProviderUserIds(userId);
  const lastSyncAt = ids
    .map((r) => r.last_sync_at)
    .filter((v): v is string => v != null)
    .sort()
    .at(-1) ?? null;
  const anyError = ids.find((r) => r.last_sync_error != null);
  res.json({
    configured: true,
    enabled: cfg.enabled === 1,
    last_sync_at: lastSyncAt,
    last_sync_error: anyError?.last_sync_error ?? null,
    perId: ids.map((r) => ({
      id: r.id,
      provider_user_id: r.provider_user_id,
      label: r.label,
      enabled: r.enabled === 1,
      last_sync_at: r.last_sync_at,
      last_sync_error: r.last_sync_error,
    })),
  });
}

export async function triggerSync(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await syncProviderServiceEvents(userId);
  res.json(result);
}

export async function getConfig(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg) {
    res.json({ configured: false, user_ids: [] });
    return;
  }
  const ids = await listProviderUserIds(userId);
  res.json({
    configured: true,
    service_url: cfg.service_url,
    service_token_set: true,
    enabled: cfg.enabled === 1,
    user_ids: ids.map((r) => ({
      id: r.id,
      provider_user_id: r.provider_user_id,
      label: r.label,
      enabled: r.enabled === 1,
      last_sync_at: r.last_sync_at,
      last_sync_error: r.last_sync_error,
    })),
  });
}

export async function putConfig(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as {
    service_url?: unknown;
    service_token?: unknown;
    enabled?: unknown;
  };

  if (typeof body.service_url !== 'string' || !body.service_url.trim()) {
    res.status(400).json({ error: 'service_url required' });
    return;
  }

  const existing = await getProviderServiceConfig(userId);
  let tokenEnc: string;
  if (typeof body.service_token === 'string' && body.service_token.length > 0) {
    tokenEnc = encryptSecret(body.service_token);
  } else if (existing) {
    tokenEnc = existing.service_token_enc;
  } else {
    res.status(400).json({ error: 'service_token required on first save' });
    return;
  }

  await upsertProviderServiceConfig(userId, {
    service_url: body.service_url.trim(),
    service_token_enc: tokenEnc,
    enabled: body.enabled === false ? 0 : 1,
  });

  res.json({ ok: true });
}

// ----- Sub-A.1: user-ids CRUD -----

export async function postUserId(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as { provider_user_id?: unknown; label?: unknown };
  if (typeof body.provider_user_id !== 'string' || !body.provider_user_id.trim()) {
    res.status(400).json({ error: 'provider_user_id required' });
    return;
  }
  const label =
    typeof body.label === 'string' && body.label.trim().length > 0
      ? body.label.trim()
      : null;
  try {
    const row = await addProviderUserId(userId, body.provider_user_id.trim(), label);
    res.json({
      id: row.id,
      provider_user_id: row.provider_user_id,
      label: row.label,
      enabled: row.enabled === 1,
      last_sync_at: row.last_sync_at,
      last_sync_error: row.last_sync_error,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      res.status(409).json({ error: 'already configured' });
      return;
    }
    throw e;
  }
}

export async function deleteUserId(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const rowId = Number(req.params.id);
  if (!Number.isFinite(rowId)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const removed = await removeProviderUserId(rowId, userId);
  if (!removed) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
}

export async function patchUserId(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const rowId = Number(req.params.id);
  if (!Number.isFinite(rowId)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const body = (req.body ?? {}) as { label?: unknown; enabled?: unknown };
  let touched = false;
  if (typeof body.label === 'string' || body.label === null) {
    const label = body.label === null
      ? null
      : typeof body.label === 'string' && body.label.trim().length > 0
        ? body.label.trim()
        : null;
    const ok = await updateProviderUserIdLabel(rowId, userId, label);
    if (!ok) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    touched = true;
  }
  if (typeof body.enabled === 'boolean') {
    const ok = await setProviderUserIdEnabled(rowId, userId, body.enabled);
    if (!ok && !touched) {
      res.status(404).json({ error: 'not found' });
      return;
    }
  }
  const fresh = await getProviderUserIdRow(rowId, userId);
  if (!fresh) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({
    id: fresh.id,
    provider_user_id: fresh.provider_user_id,
    label: fresh.label,
    enabled: fresh.enabled === 1,
    last_sync_at: fresh.last_sync_at,
    last_sync_error: fresh.last_sync_error,
  });
}
