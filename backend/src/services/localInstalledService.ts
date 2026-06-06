// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Geteilte Logik zum Assemblieren der "Lokal installiert"-Karten — wird
// von /api/catalog/local-installed UND vom Recommendations-Endpoint genutzt.
// Resolves Provider-Service /models/status → Karten mit pros/cons aus
// curated map oder catalog_local_pros_cons; triggert fire-and-forget LLM
// generation für unbekannte Modelle.
import { getProviderServiceConfig } from '../data/localUsageRepo.js';
import { decryptSecret } from '../utils/secretCrypto.js';
import {
  lookupCuratedLocal,
  normalizeOllamaName,
  type LocalModelFamily,
} from '../data/curatedLocalModels.js';
import { getLocalProsCons } from '../data/localProsConsRepo.js';
import { generateLocalProsCons } from './catalogProsConsService.js';
import logger from '../utils/logger.js';

export interface LocalInstalledCard {
  name: string;
  base_name: string;
  family: LocalModelFamily;
  pros?: string[];
  cons?: string[];
  setup_note?: string;
}

const FAMILY_RANK: Record<LocalModelFamily, number> = {
  chat: 0,
  code: 1,
  embedding: 2,
  custom: 3,
};

// Holt alle vom Provider-Service als "loaded" gemeldeten Ollama-Modelle und
// assembliert Cards (curated → cache → empty + fire-and-forget LLM). Liefert
// sortiert nach Family-Rank dann Name. Bei Fehler (Provider nicht konfiguriert,
// /models/status unreachable, etc.): leeres Array.
export async function resolveLocalInstalledCards(
  userId: number,
): Promise<LocalInstalledCard[]> {
  const cfg = await getProviderServiceConfig(userId);
  if (!cfg || cfg.enabled !== 1) return [];

  let loaded: string[];
  try {
    const token = decryptSecret(cfg.service_token_enc);
    const url = new URL('/models/status', cfg.service_url);
    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { loaded?: string[] };
    loaded = data.loaded ?? [];
  } catch {
    return [];
  }

  const cards: LocalInstalledCard[] = [];
  const needsGeneration: Array<{ name: string; family: LocalModelFamily }> = [];

  for (const name of loaded) {
    const base_name = normalizeOllamaName(name);
    const curated = lookupCuratedLocal(name);
    if (curated) {
      cards.push({
        name,
        base_name,
        family: curated.family,
        pros: curated.pros,
        cons: curated.cons,
        setup_note: curated.setup_note,
      });
      continue;
    }
    const cached = await getLocalProsCons(name);
    if (cached) {
      cards.push({
        name,
        base_name,
        family: cached.family,
        pros: cached.pros,
        cons: cached.cons,
      });
      continue;
    }
    cards.push({ name, base_name, family: 'custom' });
    needsGeneration.push({ name, family: 'custom' });
  }

  cards.sort((a, b) => {
    const rDiff = FAMILY_RANK[a.family] - FAMILY_RANK[b.family];
    if (rDiff !== 0) return rDiff;
    return a.name.localeCompare(b.name);
  });

  // Fire-and-forget: generate pros/cons for unknown models in the background.
  if (needsGeneration.length > 0) {
    void (async () => {
      for (const { name, family } of needsGeneration) {
        try {
          await generateLocalProsCons(name, family);
        } catch (err) {
          logger.error({ name, err }, '[local-installed] generate failed');
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    })().catch(() => {});
  }

  return cards;
}
