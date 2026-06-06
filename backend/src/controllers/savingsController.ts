// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import { allQuery } from '../database/sqlite.js';
import { getCloudEquivalent, FALLBACK_EQUIVALENT } from '../data/modelMapper.js';

function periodSinceISO(period: string): string {
  const d = new Date();
  switch (period) {
    case 'day': d.setDate(d.getDate() - 1); break;
    case 'week': d.setDate(d.getDate() - 7); break;
    case 'month': d.setDate(d.getDate() - 30); break;
    case 'year': d.setFullYear(d.getFullYear() - 1); break;
    default: d.setDate(d.getDate() - 30);
  }
  return d.toISOString();
}

interface LocalModelRow {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface SavingsPerModel {
  model: string;
  cloudModel: string;
  cloudProvider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cloudCost: number;
  localCost: number;
  savings: number;
}

export async function getProjection(req: Request, res: Response): Promise<void> {
  const period = (req.query.period as string) || 'month';
  const since = periodSinceISO(period);

  const rows: LocalModelRow[] = await allQuery<LocalModelRow>(
    `SELECT
       model,
       COUNT(*) AS calls,
       COALESCE(SUM(input_tokens), 0) AS inputTokens,
       COALESCE(SUM(output_tokens), 0) AS outputTokens
     FROM provider_service_events
     WHERE remote_created_at >= ? AND status = 'success'
     GROUP BY model
     ORDER BY (COALESCE(SUM(input_tokens),0) + COALESCE(SUM(output_tokens),0)) DESC`,
    [since],
  );

  const perModel: SavingsPerModel[] = rows.map((r: LocalModelRow) => {
    const eq = getCloudEquivalent(r.model) || FALLBACK_EQUIVALENT;
    const inCost = (r.inputTokens / 1_000_000) * eq.inputPrice;
    const outCost = (r.outputTokens / 1_000_000) * eq.outputPrice;
    const cloudCost = inCost + outCost;
    return {
      model: r.model,
      cloudModel: eq.cloudModel,
      cloudProvider: eq.provider,
      calls: r.calls,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cloudCost: Math.round(cloudCost * 10000) / 10000,
      localCost: 0,
      savings: Math.round(cloudCost * 10000) / 10000,
    };
  });

  const totalCalls = perModel.reduce((s: number, m: SavingsPerModel) => s + m.calls, 0);
  const totalCloudCost = perModel.reduce((s: number, m: SavingsPerModel) => s + m.cloudCost, 0);
  const totalSavings = perModel.reduce((s: number, m: SavingsPerModel) => s + m.savings, 0);

  let monthlyProjection: number | null = null;
  let annualProjection: number | null = null;
  if (totalSavings > 0) {
    switch (period) {
      case 'day':
        monthlyProjection = totalSavings * 30;
        annualProjection = totalSavings * 365;
        break;
      case 'week':
        monthlyProjection = Math.round(totalSavings * 4.33 * 100) / 100;
        annualProjection = Math.round(totalSavings * 52 * 100) / 100;
        break;
      case 'month':
        monthlyProjection = Math.round(totalSavings * 100) / 100;
        annualProjection = Math.round(totalSavings * 12 * 100) / 100;
        break;
      case 'year':
        monthlyProjection = Math.round((totalSavings / 12) * 100) / 100;
        annualProjection = Math.round(totalSavings * 100) / 100;
        break;
    }
  }

  res.json({
    period,
    since,
    total: {
      calls: totalCalls,
      cloudCost: Math.round(totalCloudCost * 100) / 100,
      localCost: 0,
      savings: Math.round(totalSavings * 100) / 100,
      savingsPercent: totalCloudCost > 0 ? 100 : 0,
    },
    projections: {
      monthly: monthlyProjection,
      annual: annualProjection,
    },
    perModel,
  });
}
