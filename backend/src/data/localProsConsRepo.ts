// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// CRUD für catalog_local_pros_cons. Gespeichert wird per exakt-Match auf
// den Ollama-Modellnamen (z.B. "mistral-nemo-cc:latest"), nicht auf den
// normalisierten Basis-Namen — so können verschiedene Tags/Custom-Builds
// unterschiedliche Pros/Cons haben falls vom LLM differenziert generiert.
import { runQuery, getQuery } from '../database/sqlite.js';
import type { LocalModelFamily } from './curatedLocalModels.js';

export interface LocalProsConsRow {
  model_name: string;
  pros: string[];
  cons: string[];
  family: LocalModelFamily;
  generated_at: string;
}

interface RawRow {
  model_name: string;
  pros: string;
  cons: string;
  family: string;
  generated_at: string;
}

export async function getLocalProsCons(
  modelName: string,
): Promise<LocalProsConsRow | null> {
  const row = await getQuery<RawRow>(
    'SELECT * FROM catalog_local_pros_cons WHERE model_name = ?',
    [modelName],
  );
  if (!row) return null;
  return {
    model_name: row.model_name,
    pros: JSON.parse(row.pros) as string[],
    cons: JSON.parse(row.cons) as string[],
    family: row.family as LocalModelFamily,
    generated_at: row.generated_at,
  };
}

export async function upsertLocalProsCons(
  modelName: string,
  pros: string[],
  cons: string[],
  family: LocalModelFamily,
): Promise<void> {
  await runQuery(
    `INSERT INTO catalog_local_pros_cons (model_name, pros, cons, family, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(model_name) DO UPDATE SET
       pros = excluded.pros,
       cons = excluded.cons,
       family = excluded.family,
       generated_at = excluded.generated_at`,
    [
      modelName,
      JSON.stringify(pros),
      JSON.stringify(cons),
      family,
      new Date().toISOString(),
    ],
  );
}
