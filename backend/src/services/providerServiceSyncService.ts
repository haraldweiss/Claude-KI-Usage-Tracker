// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Pull usage events from the configured ai-provider-service for a single user
// and mirror them into provider_service_events. Idempotent via the UNIQUE
// constraint on (user_id, remote_event_id) — re-runs with the same cursor
// insert nothing, so a wrong cursor is recoverable.
import {
  getProviderServiceConfig,
  insertEventIfNew,
  updateSyncStatus,
  type RemoteEvent,
} from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';

export interface SyncResult {
  ok: boolean;
  newEvents: number;
  error?: string;
}

interface RemoteEventDto {
  id: number;
  created_at: string;
  provider_id: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  origin_app: string | null;
  status: string;
  error_message: string | null;
}

interface RemotePage {
  events: RemoteEventDto[];
  count: number;
  next_since: string | null;
  has_more: boolean;
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 50; // safety: 25k events per cron tick is plenty

export async function syncProviderServiceEvents(userId: number): Promise<SyncResult> {
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) {
    return { ok: true, newEvents: 0 };
  }

  let token: string;
  try {
    token = decryptSecret(cfg.service_token_enc);
  } catch (e) {
    const msg = `decrypt failed: ${(e as Error).message}`;
    await updateSyncStatus(userId, { last_sync_error: msg });
    return { ok: false, newEvents: 0, error: msg };
  }

  let cursor: string | null = cfg.last_sync_cursor;
  let totalNew = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL('/usage/events', cfg.service_url);
      url.searchParams.set('user_id', cfg.provider_user_id);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('since', cursor);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RemotePage;

      for (const ev of data.events) {
        const row: RemoteEvent = {
          remote_event_id: ev.id,
          remote_created_at: ev.created_at,
          provider_id: ev.provider_id,
          model: ev.model,
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cost_usd: ev.cost_usd,
          origin_app: ev.origin_app,
          status: ev.status,
          error_message: ev.error_message,
        };
        if (await insertEventIfNew(userId, row)) totalNew++;
      }

      cursor = data.next_since ?? cursor;
      if (!data.has_more) break;
    }

    await updateSyncStatus(userId, {
      last_sync_at: new Date().toISOString(),
      last_sync_cursor: cursor,
      last_sync_error: null,
    });
    return { ok: true, newEvents: totalNew };
  } catch (e) {
    const msg = (e as Error).message;
    await updateSyncStatus(userId, { last_sync_error: msg });
    return { ok: false, newEvents: totalNew, error: msg };
  }
}
