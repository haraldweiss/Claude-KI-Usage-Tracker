// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// HTTP handlers for /api/catalog/*. Auth via requireUser (router-level).
import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  fetchModelMetadata,
  searchModels,
  type ModelCard,
} from '../services/catalogService.js';
import { getProviderServiceConfig } from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_PATH = join(__dirname, '../data/curated-models.json');

interface CuratedSpec {
  sections: Array<{
    key: string;
    label: string;
    default_quant: string;
    models: string[];
  }>;
}

let curatedSpecCache: CuratedSpec | null = null;

async function loadCuratedSpec(): Promise<CuratedSpec> {
  if (curatedSpecCache) return curatedSpecCache;
  const txt = await readFile(CURATED_PATH, 'utf-8');
  curatedSpecCache = JSON.parse(txt) as CuratedSpec;
  return curatedSpecCache;
}

export async function getCurated(_req: Request, res: Response): Promise<void> {
  const spec = await loadCuratedSpec();
  const sections = await Promise.all(
    spec.sections.map(async (s) => {
      const cards = await Promise.all(
        s.models.map((repo) =>
          fetchModelMetadata(repo, s.default_quant).catch(() => null),
        ),
      );
      return {
        key: s.key,
        label: s.label,
        default_quant: s.default_quant,
        models: cards.filter((c): c is ModelCard => c !== null),
      };
    }),
  );
  res.json({ sections });
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
    res.json(r);
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
