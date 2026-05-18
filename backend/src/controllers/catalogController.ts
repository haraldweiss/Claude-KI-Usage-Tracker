// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HTTP handlers for /api/catalog/*. Auth via requireUser (router-level).
import type { Request, Response } from 'express';
import {
  fetchModelMetadata,
  searchModels,
  type ModelCard,
} from '../services/catalogService.js';
import { CURATED_MODELS } from '../data/curatedModels.js';
import { getCachedCard, getOldestFetchedAt } from '../data/catalogCacheRepo.js';
import { listLatestUploads } from '../data/latestUploadsRepo.js';
import { getProviderServiceConfig } from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';
import {
  generateBatchProsCons,
  isProsConsEnabled,
} from '../services/catalogProsConsService.js';

export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = CURATED_MODELS;

  // 3 static sections (unchanged)
  const staticSections = await Promise.all(
    spec.sections.map(async (s) => {
      const cards = await Promise.all(
        s.models.map(async (m): Promise<ModelCard | null> => {
          // DB-first read. Cold-start fallback to live HF if the row is missing.
          const cached = await getCachedCard(m.repo);
          let card: ModelCard | null;
          if (cached) {
            card = cached.card;
          } else {
            card = await fetchModelMetadata(m.repo, s.default_quant).catch(() => null);
          }
          if (!card) return null;
          // Merge curated meta into the HF-derived card.
          return {
            ...card,
            pros: m.pros,
            cons: m.cons,
            setup_note: m.setup_note,
          };
        }),
      );
      return {
        key: s.key,
        label: s.label,
        default_quant: s.default_quant,
        models: cards.filter((c): c is ModelCard => c !== null),
      };
    }),
  );

  // 4th dynamic section: latest uploads (Sub-B.2)
  const latestRows = await listLatestUploads();
  const latestCards = await Promise.all(latestRows.map(async (r): Promise<ModelCard | null> => {
    const cached = await getCachedCard(r.repo);
    if (cached) return cached.card;
    // Cold-start fallback — unlikely once cron has run, but graceful
    return fetchModelMetadata(r.repo, 'Q4_K_M').catch(() => null);
  }));
  const latestSection = {
    key: 'latest',
    label: 'Frisch hochgeladen',
    default_quant: 'Q4_K_M',
    models: latestCards.filter((c): c is ModelCard => c !== null),
  };

  const oldest = await getOldestFetchedAt();
  res.json({ sections: [...staticSections, latestSection], fetched_at: oldest });
}

export async function getSearch(req: Request, res: Response): Promise<void> {
  const q = (req.query.q as string | undefined)?.trim() ?? '';
  if (!q) {
    res.status(400).json({ error: 'q required' });
    return;
  }
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 50));
  try {
    const r = await searchModels(q, limit);

    // B.3: First, replace cards that already have cached pros/cons (from earlier visits).
    const merged = await Promise.all(
      r.results.map(async (card): Promise<ModelCard> => {
        const cached = await getCachedCard(card.repo);
        if (cached?.card.pros && cached.card.pros.length > 0) {
          return { ...card, pros: cached.card.pros, cons: cached.card.cons };
        }
        return card;
      }),
    );
    res.json({ results: merged });

    // Fire-and-forget: generate pros/cons for the top-10 results that don't yet
    // have them. Next time the same model is searched, it'll come back with pros.
    if (isProsConsEnabled()) {
      const top = merged.slice(0, 10).filter((c) => !c.pros || c.pros.length === 0);
      if (top.length > 0) {
        void generateBatchProsCons(top).catch((err) =>
          console.error('[catalog-pros] search async error', (err as Error).message),
        );
      }
    }
  } catch (e) {
    res.status(502).json({ error: 'hf_unreachable', detail: (e as Error).message });
  }
}

export async function getInstalled(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) {
    res.json({ models: [] });
    return;
  }
  try {
    const token = decryptSecret(cfg.service_token_enc);
    const url = new URL('/models/status', cfg.service_url);
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      res.json({ models: [] });
      return;
    }
    const data = (await r.json()) as { loaded?: string[] };
    res.json({ models: data.loaded ?? [] });
  } catch {
    res.json({ models: [] });
  }
}
