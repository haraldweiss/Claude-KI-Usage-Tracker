// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// CRUD für model_pros_cons. Keyed by exakter Modellname aus pricing.model
// (z.B. "Claude Sonnet 4.6"). Anders als catalog_local_pros_cons hat diese
// Tabelle keine family-Spalte — die Tier-Information lebt in pricing.tier.
import { runQuery, getQuery } from '../database/sqlite.js';

export interface ModelProsConsRow {
  model_name: string;
  pros: string[];
  cons: string[];
  generated_at: string;
}

interface RawRow {
  model_name: string;
  pros: string;
  cons: string;
  generated_at: string;
}

export async function getModelProsCons(
  modelName: string,
): Promise<ModelProsConsRow | null> {
  const row = await getQuery<RawRow>(
    'SELECT * FROM model_pros_cons WHERE model_name = ?',
    [modelName],
  );
  if (!row) return null;
  return {
    model_name: row.model_name,
    pros: JSON.parse(row.pros) as string[],
    cons: JSON.parse(row.cons) as string[],
    generated_at: row.generated_at,
  };
}

export async function upsertModelProsCons(
  modelName: string,
  pros: string[],
  cons: string[],
): Promise<void> {
  await runQuery(
    `INSERT INTO model_pros_cons (model_name, pros, cons, generated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(model_name) DO UPDATE SET
       pros = excluded.pros,
       cons = excluded.cons,
       generated_at = excluded.generated_at`,
    [
      modelName,
      JSON.stringify(pros),
      JSON.stringify(cons),
      new Date().toISOString(),
    ],
  );
}
