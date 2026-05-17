// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HTTP handlers for /api/local-usage. Auth via requireUser middleware
// (router-level), so req.user is guaranteed present.
import type { Request, Response } from 'express';
import {
  upsertProviderServiceConfig,
  getProviderServiceConfig,
  getLocalUsageSummary,
} from '../data/localUsageRepo.js';
import { encryptSecret } from '../utils/secretCrypto.js';
import { syncProviderServiceEvents } from '../services/providerServiceSyncService.js';

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
  res.json({
    configured: true,
    enabled: cfg.enabled === 1,
    last_sync_at: cfg.last_sync_at,
    last_sync_error: cfg.last_sync_error,
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
    res.json({ configured: false });
    return;
  }
  // Never return the encrypted token — only a flag that one is set.
  res.json({
    configured: true,
    service_url: cfg.service_url,
    service_token_set: true,
    provider_user_id: cfg.provider_user_id,
    enabled: cfg.enabled === 1,
    last_sync_at: cfg.last_sync_at,
    last_sync_error: cfg.last_sync_error,
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
