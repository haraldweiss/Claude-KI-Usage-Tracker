// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Daily refresh of HF metadata for the curated catalog models.
// Per-repo error handling: a failing repo doesn't stop the loop. The
// existing DB row keeps its data_json and gets last_error stamped.
import { fetchModelMetadata } from './catalogService.js';
import { CURATED_MODELS } from '../data/curatedModels.js';
import {
  upsertCardCache,
  recordCacheError,
  getCachedCard,
} from '../data/catalogCacheRepo.js';

export interface RefreshSummary {
  refreshed: number;
  failed: number;
  errors: Array<{ repo: string; error: string }>;
}

export async function refreshCuratedHfCache(): Promise<RefreshSummary> {
  const allRepos = CURATED_MODELS.sections.flatMap((s) =>
    s.models.map((m) => ({ repo: m.repo, default_quant: s.default_quant })),
  );
  const summary: RefreshSummary = { refreshed: 0, failed: 0, errors: [] };
  for (const { repo, default_quant } of allRepos) {
    try {
      const card = await fetchModelMetadata(repo, default_quant);
      if (card === null) {
        const msg = 'HF 404 (not found)';
        await recordCacheError(repo, msg);
        summary.failed++;
        summary.errors.push({ repo, error: msg });
        continue;
      }
      // Strip the stale flag if catalogService set it; the cron writes fresh values.
      const cleanCard = { ...card };
      delete cleanCard.stale;
      await upsertCardCache(repo, cleanCard, null);
      summary.refreshed++;
    } catch (e) {
      const msg = (e as Error).message;
      await recordCacheError(repo, msg);
      summary.failed++;
      summary.errors.push({ repo, error: msg });
    }
  }
  return summary;
}

export async function isCacheEmpty(): Promise<boolean> {
  const firstSection = CURATED_MODELS.sections[0];
  if (!firstSection) return true;
  const firstModel = firstSection.models[0];
  if (!firstModel) return true;
  const sample = await getCachedCard(firstModel.repo);
  return sample === null;
}
