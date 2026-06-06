// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Request, Response } from 'express';
import * as modelRecommendationService from '../services/modelRecommendationService.js';
import * as db from '../database/sqlite.js';
import logger from '../utils/logger.js';
import type { RecommendationRequest, ModelAnalysisResponse, OptimizationOpportunitiesResponse } from '../types/index.js';

interface AnalysisRow {
  model: string;
  total_requests: number;
  success_rate: number;
  error_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  cost_per_request: number;
  last_updated: string;
}

interface ErrorMetadataRow {
  response_metadata: string | null;
}

interface UsageRecordRow {
  id: number;
  model: string;
  task_description: string | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  success_status: string;
}

interface OpportunityItem {
  taskType: string;
  usedModel: string;
  recommendedModel: string;
  count: number;
  totalCost: number;
  potentialCost: number;
  riskScore: number;
  savings: string;
  potentialSavings?: string;
}

// Whitelist of valid periods mapped to lookback days.
const PERIOD_TO_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30
};

function resolveLookbackDays(period?: string, defaultPeriod = 'month'): { period: string; lookbackDays: number } {
  const validPeriod = (typeof period === 'string' && Object.prototype.hasOwnProperty.call(PERIOD_TO_DAYS, period)) ? period : defaultPeriod;
  const lookbackDays = PERIOD_TO_DAYS[validPeriod] ?? 30;
  return { period: validPeriod, lookbackDays };
}

export async function recommendModel(req: Request<unknown, unknown, RecommendationRequest>, res: Response): Promise<void> {
  try {
    const { taskDescription, constraints = {} } = req.body;

    if (!taskDescription || typeof taskDescription !== 'string') {
      res.status(400).json({ success: false, error: 'taskDescription is required and must be a string' });
      return;
    }

    const recommendation = await modelRecommendationService.recommendModel(taskDescription, constraints, req.user!.id);

    if (recommendation.error) {
      res.status(500).json({
        success: false,
        error: recommendation.error,
        fallback: recommendation.fallback
      });
      return;
    }

    res.status(200).json({
      success: true,
      recommendation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error in recommendModel endpoint');
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
}

export async function getModelAnalysis(req: Request<unknown, unknown, unknown, { period?: string }>, res: Response<ModelAnalysisResponse>): Promise<void> {
  try {
    const { period, lookbackDays } = resolveLookbackDays(req.query.period, 'month');

    const analysis = await db.allQuery<AnalysisRow>(`
      SELECT model, total_requests, success_rate, error_count, avg_input_tokens, avg_output_tokens, cost_per_request, last_updated
      FROM model_analysis
      ORDER BY total_requests DESC
    `);

    const enrichedAnalysis: Array<AnalysisRow & { errorPatterns: string[]; successPercent: number }> = [];

    for (const model of analysis) {
      const modifier = `-${lookbackDays} days`;
      const errors = await db.allQuery<ErrorMetadataRow>(`
        SELECT response_metadata FROM usage_records
        WHERE model = ? AND success_status = 'error'
        AND timestamp >= datetime('now', ?)
        AND user_id = ?
        LIMIT 5
      `, [model.model, modifier, req.user!.id]);

      const errorPatterns: Record<string, number> = {};
      for (const error of errors) {
        if (error.response_metadata) {
          try {
            const metadata = JSON.parse(error.response_metadata) as { error_type?: string };
            const errorType = metadata.error_type || 'unknown';
            errorPatterns[errorType] = (errorPatterns[errorType] || 0) + 1;
          } catch {
            // Ignore parse errors
          }
        }
      }

      enrichedAnalysis.push({
        ...model,
        errorPatterns: Object.entries(errorPatterns).map(([type, count]) => `${type}: ${count}`),
        successPercent: Math.round((model.success_rate || 0) * 100)
      });
    }

    res.status(200).json({
      success: true,
      period: period as 'day' | 'week' | 'month',
      lookbackDays,
      analysis: enrichedAnalysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error in getModelAnalysis');
    res.status(500).json({
      success: false,
      period: 'month' as const,
      lookbackDays: 30,
      analysis: [],
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    });
  }
}

export async function getOptimizationOpportunities(req: Request<unknown, unknown, unknown, { period?: string }>, res: Response<OptimizationOpportunitiesResponse>): Promise<void> {
  try {
    const { period, lookbackDays } = resolveLookbackDays(req.query.period, 'week');
    const modifier = `-${lookbackDays} days`;

    const records = await db.allQuery<UsageRecordRow>(`
      SELECT id, model, task_description, input_tokens, output_tokens, cost, success_status
      FROM usage_records
      WHERE timestamp >= datetime('now', ?)
      AND user_id = ?
      ORDER BY timestamp DESC
    `, [modifier, req.user!.id]);

    if (records.length === 0) {
      res.status(200).json({
        success: true,
        period: period as 'day' | 'week' | 'month',
        lookbackDays,
        recordsAnalyzed: 0,
        opportunities: [],
        currentTotalCost: '$0.00',
        potentialTotalCost: '$0.00',
        totalPotentialSavings: '$0.00',
        savingsPercent: '0%',
        message: 'No usage data available for this period',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const opportunitiesMap = new Map<string, OpportunityItem>();
    let totalCurrentCost = 0;
    let totalPotentialCost = 0;

    for (const record of records) {
      totalCurrentCost += record.cost || 0;
      const complexity = modelRecommendationService.analyzeTaskComplexity(record.task_description || 'unknown');

      if (complexity.complexity <= 3 && record.model.includes('Opus')) {
        const key = 'simple_with_opus';
        if (!opportunitiesMap.has(key)) {
          opportunitiesMap.set(key, {
            taskType: 'simple',
            usedModel: 'Claude 3 Opus',
            recommendedModel: 'Claude 3.5 Haiku',
            count: 0, totalCost: 0, potentialCost: 0,
            riskScore: 0.05, savings: '80-85%'
          });
        }
        const opp = opportunitiesMap.get(key)!;
        opp.count++;
        opp.totalCost += record.cost || 0;
        const haikuCost = (record.input_tokens * 0.8 + record.output_tokens * 4) / 1000000;
        opp.potentialCost += haikuCost;
        totalPotentialCost += haikuCost;
      }

      if (complexity.complexity >= 4 && complexity.complexity <= 6 && record.model.includes('Opus') && record.success_status === 'success') {
        const key = 'medium_with_opus';
        if (!opportunitiesMap.has(key)) {
          opportunitiesMap.set(key, {
            taskType: 'medium',
            usedModel: 'Claude 3 Opus',
            recommendedModel: 'Claude 3.5 Sonnet',
            count: 0, totalCost: 0, potentialCost: 0,
            riskScore: 0.08, savings: '75-80%'
          });
        }
        const opp = opportunitiesMap.get(key)!;
        opp.count++;
        opp.totalCost += record.cost || 0;
        const sonnetCost = (record.input_tokens * 3 + record.output_tokens * 15) / 1000000;
        opp.potentialCost += sonnetCost;
        totalPotentialCost += sonnetCost;
      }
    }

    const opportunityList = Array.from(opportunitiesMap.values()).map((opp) => ({
      ...opp,
      potentialSavings: opp.totalCost > 0
        ? `${((1 - opp.potentialCost / opp.totalCost) * 100).toFixed(1)}%`
        : '0.0%'
    }));

    opportunityList.sort((a, b) => {
      const savingsA = a.totalCost > 0 ? 1 - a.potentialCost / a.totalCost : 0;
      const savingsB = b.totalCost > 0 ? 1 - b.potentialCost / b.totalCost : 0;
      return savingsB - savingsA;
    });

    const totalPotentialSavings = totalCurrentCost - totalPotentialCost;

    res.status(200).json({
      success: true,
      period: period as 'day' | 'week' | 'month',
      lookbackDays,
      recordsAnalyzed: records.length,
      opportunities: opportunityList,
      currentTotalCost: `$${totalCurrentCost.toFixed(2)}`,
      potentialTotalCost: `$${totalPotentialCost.toFixed(2)}`,
      totalPotentialSavings: `$${totalPotentialSavings.toFixed(2)}`,
      savingsPercent: totalCurrentCost > 0 ? `${((totalPotentialSavings / totalCurrentCost) * 100).toFixed(1)}%` : '0%',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error }, 'Error in getOptimizationOpportunities');
    res.status(500).json({
      success: false,
      period: 'week' as const,
      lookbackDays: 7,
      recordsAnalyzed: 0,
      opportunities: [],
      currentTotalCost: '$0.00',
      potentialTotalCost: '$0.00',
      totalPotentialSavings: '$0.00',
      savingsPercent: '0%',
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    });
  }
}

// Backend type export so Express Response generic resolves
export type { OpportunityItem };
