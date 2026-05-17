// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Sub-A.1: pull usage events for ALL active provider_user_ids of a tracker-user.
// Each ID has its own cursor + error state in provider_service_user_ids — a slow
// or failing ID doesn't poison another ID's incremental sync.
import {
  getProviderServiceConfig,
  insertEventIfNew,
  listProviderUserIds,
  updateProviderUserIdSyncStatus,
  type RemoteEvent,
  type ProviderUserIdRow,
} from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';

export interface PerIdResult {
  providerUserId: string;
  ok: boolean;
  newEvents: number;
  error?: string;
}

export interface SyncResult {
  ok: boolean;          // true when ALL ids ok
  newEvents: number;    // summed across ids
  perId: PerIdResult[];
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
const MAX_PAGES = 50;

async function syncOneId(
  userId: number,
  serviceUrl: string,
  token: string,
  idRow: ProviderUserIdRow,
): Promise<PerIdResult> {
  let cursor: string | null = idRow.last_sync_cursor;
  let totalNew = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL('/usage/events', serviceUrl);
      url.searchParams.set('user_id', idRow.provider_user_id);
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
          provider_user_id: idRow.provider_user_id,
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

    await updateProviderUserIdSyncStatus(idRow.id, {
      last_sync_at: new Date().toISOString(),
      last_sync_cursor: cursor,
      last_sync_error: null,
    });
    return { providerUserId: idRow.provider_user_id, ok: true, newEvents: totalNew };
  } catch (e) {
    const msg = (e as Error).message;
    await updateProviderUserIdSyncStatus(idRow.id, { last_sync_error: msg });
    return { providerUserId: idRow.provider_user_id, ok: false, newEvents: totalNew, error: msg };
  }
}

export async function syncProviderServiceEvents(userId: number): Promise<SyncResult> {
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) {
    return { ok: true, newEvents: 0, perId: [] };
  }

  let token: string;
  try {
    token = decryptSecret(cfg.service_token_enc);
  } catch (e) {
    // No specific id to attach to — record on all enabled ids for visibility.
    const ids = (await listProviderUserIds(userId)).filter((r) => r.enabled === 1);
    const msg = `decrypt failed: ${(e as Error).message}`;
    await Promise.all(ids.map((r) => updateProviderUserIdSyncStatus(r.id, { last_sync_error: msg })));
    return {
      ok: false,
      newEvents: 0,
      perId: ids.map((r) => ({ providerUserId: r.provider_user_id, ok: false, newEvents: 0, error: msg })),
    };
  }

  const ids = (await listProviderUserIds(userId)).filter((r) => r.enabled === 1);
  const perId: PerIdResult[] = [];
  for (const idRow of ids) {
    perId.push(await syncOneId(userId, cfg.service_url, token, idRow));
  }
  return {
    ok: perId.every((r) => r.ok),
    newEvents: perId.reduce((sum, r) => sum + r.newEvents, 0),
    perId,
  };
}
