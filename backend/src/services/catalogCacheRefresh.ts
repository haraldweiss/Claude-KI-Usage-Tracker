// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Daily refresh of HF metadata for the curated catalog models.
// Per-repo error handling: a failing repo doesn't stop the loop. The
// existing DB row keeps its data_json and gets last_error stamped.
import { fetchModelMetadata, fetchLatestUploads } from './catalogService.js';
import type { ModelCard } from './catalogService.js';
import { CURATED_MODELS } from '../data/curatedModels.js';
import {
  upsertCardCache,
  recordCacheError,
  getCachedCard,
} from '../data/catalogCacheRepo.js';
import { replaceLatestUploads } from '../data/latestUploadsRepo.js';
import {
  generateBatchProsCons,
  isProsConsEnabled,
} from './catalogProsConsService.js';
import { runQuery } from '../database/sqlite.js';

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

// ---------------------------------------------------------------------------
// Sub-B.2: refresh the dynamic Latest Uploads index.
// ---------------------------------------------------------------------------

const LATEST_QUANTERS = ['bartowski', 'MaziyarPanahi'];
const LATEST_TOP_N = 6;

export async function refreshLatestUploads(): Promise<RefreshSummary> {
  const summary: RefreshSummary = { refreshed: 0, failed: 0, errors: [] };

  // 1. Query both quanters' latest uploads. Failures per author do not abort.
  const merged: Array<{ repo: string; lastModified: string }> = [];
  for (const author of LATEST_QUANTERS) {
    try {
      const list = await fetchLatestUploads(author, 15);
      for (const m of list) {
        const repo = m.id ?? m.modelId;
        if (repo && m.lastModified) {
          merged.push({ repo, lastModified: m.lastModified });
        }
      }
    } catch (e) {
      summary.errors.push({ repo: `author:${author}`, error: (e as Error).message });
      summary.failed++;
    }
  }

  // 2. Sort by lastModified DESC, dedup by repo, take top N.
  const seen = new Set<string>();
  const top = merged
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    .filter((m) => {
      if (seen.has(m.repo)) return false;
      seen.add(m.repo);
      return true;
    })
    .slice(0, LATEST_TOP_N);

  // 3. Ensure each repo's metadata is in catalog_hf_cache. Per-repo errors do
  //    not stop the loop — failing repo still ends up in latest list with
  //    cache miss (Page-load fallback to live HF later).
  for (const m of top) {
    try {
      const card = await fetchModelMetadata(m.repo, 'Q4_K_M');
      if (card === null) {
        summary.failed++;
        summary.errors.push({ repo: m.repo, error: 'HF 404' });
        continue;
      }
      const clean = { ...card };
      delete clean.stale;
      await upsertCardCache(m.repo, clean, null);
      summary.refreshed++;
    } catch (e) {
      summary.failed++;
      summary.errors.push({ repo: m.repo, error: (e as Error).message });
    }
  }

  // 4. Atomic replacement of the index table.
  await replaceLatestUploads(top.map((m) => m.repo));

  // 5. B.3: Generate pros/cons for cards that are missing them or are stale (> 30d).
  //    Failures are non-fatal — they get logged but don't affect the summary.
  if (isProsConsEnabled()) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const cardsNeedingPros: ModelCard[] = [];
    for (const m of top) {
      const cached = await getCachedCard(m.repo);
      if (!cached) continue;
      const generatedAt = cached.card.auto_pros_generated_at ?? '';
      if (!cached.card.pros || generatedAt < thirtyDaysAgo) {
        cardsNeedingPros.push(cached.card);
      }
    }
    if (cardsNeedingPros.length > 0) {
      const r = await generateBatchProsCons(cardsNeedingPros);
      console.log(
        `[catalog-pros] latest: generated=${r.generated} failed=${r.failed} skipped=${r.skipped}`,
      );
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// B.3 Eviction: remove search-hit cache rows older than 90 days.
// Curated repos and current latest_uploads are immune.
// ---------------------------------------------------------------------------

const EVICTION_AGE_DAYS = 90;

export async function evictStaleSearchCacheRows(): Promise<{ evicted: number }> {
  const curatedRepos = CURATED_MODELS.sections.flatMap((s) => s.models.map((m) => m.repo));
  const cutoff = new Date(Date.now() - EVICTION_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const placeholders = curatedRepos.map(() => '?').join(',') || "''";
  const r = await runQuery(
    `DELETE FROM catalog_hf_cache
       WHERE fetched_at < ?
         AND repo NOT IN (${placeholders})
         AND repo NOT IN (SELECT repo FROM catalog_latest_uploads)`,
    [cutoff, ...curatedRepos],
  );
  return { evicted: r.changes ?? 0 };
}
