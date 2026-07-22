// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
//
// DB access for plan validity — kept separate from utils/planValidity.ts so
// the pure helpers stay unit-testable without a database import chain.

import { allQuery } from '../database/sqlite.js';
import type { ProviderValidity } from '../utils/planValidity.js';

/**
 * Load all provider_config validity rows for a user, keyed by provider name.
 */
export async function getProviderValidityMap(userId: number): Promise<Map<string, ProviderValidity>> {
  const rows = await allQuery<{ provider_name: string; plan_name: string | null; plan_valid_until: string | null }>(
    `SELECT provider_name, plan_name, plan_valid_until FROM provider_config
     WHERE user_id = ?`,
    [userId]
  );
  const map = new Map<string, ProviderValidity>();
  for (const row of rows) {
    map.set(row.provider_name, { plan_name: row.plan_name, plan_valid_until: row.plan_valid_until });
  }
  return map;
}
