import { Request, Response } from 'express';
import * as modelRecommendationService from '../services/modelRecommendationService.js';
import * as db from '../database/sqlite.js';
import type { RecommendationRequest, ModelAnalysisResponse, OptimizationOpportunitiesResponse } from '../types/index.js';

// Whitelist of valid periods mapped to lookback days.
// Using a whitelist prevents SQL injection via the `period` query parameter.
const PERIOD_TO_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30
};

/**
 * Safely resolves a period string to lookback days using a whitelist.
 * Returns the default if the period is invalid.
 */
function resolveLookbackDays(period?: string, defaultPeriod = 'month'): { period: string; lookbackDays: number } {
  const validPeriod = (typeof period === 'string' && Object.prototype.hasOwnProperty.call(PERIOD_TO_DAYS, period)) ? period : defaultPeriod;
  const lookbackDays = PERIOD_TO_DAYS[validPeriod] ?? 30;
  return { period: validPeriod, lookbackDays };
}

/**
 * POST /api/recommend
 * Recommends the best model for a given task description
 */
export async function recommendModel(req: Request<unknown, unknown, RecommendationRequest>, res: Response): Promise<void> {
  try {
    const { taskDescription, constraints = {} } = req.body;

    if (!taskDescription || typeof taskDescription !== 'string') {
      res.status(400).json({
        success: false,
        error: 'taskDescription is required and must be a string'
      });
      return;
    }

    const recommendation = await modelRecommendationService.recommendModel(taskDescription, constraints);

    if ((recommendation as any).error) {
      res.status(500).json({
        success: false,
        error: (recommendation as any).error,
        fallback: (recommendation as any).fallback
      });
      return;
    }

    res.status(200).json({
      success: true,
      recommendation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in recommendModel endpoint:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
}

/**
 * GET /api/analysis/models
 * Returns model statistics and success rates
 */
export async function getModelAnalysis(req: Request<unknown, unknown, unknown, { period?: string }>, res: Response<ModelAnalysisResponse>): Promise<void> {
  try {
    // Validate period via whitelist to prevent SQL injection
    const { period, lookbackDays } = resolveLookbackDays(req.query.period, 'month');

    // Get model analytics from cache table
    const analysis = await db.allQuery(`
      SELECT
        model,
        total_requests,
        success_rate,
        error_count,
        avg_input_tokens,
        avg_output_tokens,
        cost_per_request,
        last_updated
      FROM model_analysis
      ORDER BY total_requests DESC
    `);

    // Enrich with recent usage data
    const enrichedAnalysis = [];

    for (const model of (analysis as any[]) || []) {
      // Get recent error patterns
      const modifier = `-${lookbackDays} days`;
      const errors = await db.allQuery(`
        SELECT response_metadata FROM usage_records
        WHERE model = ? AND success_status = 'error'
        AND timestamp >= datetime('now', ?)
        AND user_id = ?
        LIMIT 5
      `, [model.model, modifier, req.user!.id]);

      // Parse error metadata if available
      const errorPatterns: Record<string, number> = {};
      for (const error of (errors as any[]) || []) {
        if (error.response_metadata) {
          try {
            const metadata = JSON.parse(error.response_metadata as string);
            const errorType = metadata.error_type || 'unknown';
            errorPatterns[errorType] = (errorPatterns[errorType] || 0) + 1;
          } catch (e) {
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
    console.error('Error in getModelAnalysis:', error);
    res.status(500).json({
      success: false,
      period: 'month',
      lookbackDays: 30,
      analysis: [],
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    } as any);
  }
}

/**
 * GET /api/analysis/opportunities
 * Shows potential cost optimization opportunities
 */
export async function getOptimizationOpportunities(req: Request<unknown, unknown, unknown, { period?: string }>, res: Response<OptimizationOpportunitiesResponse>): Promise<void> {
  try {
    // Validate period via whitelist to prevent SQL injection
    const { period, lookbackDays } = resolveLookbackDays(req.query.period, 'week');
    const modifier = `-${lookbackDays} days`;

    // Get all usage records from period
    const records = await db.allQuery(`
      SELECT
        id,
        model,
        task_description,
        input_tokens,
        output_tokens,
        cost,
        success_status
      FROM usage_records
      WHERE timestamp >= datetime('now', ?)
      AND user_id = ?
      ORDER BY timestamp DESC
    `, [modifier, req.user!.id]);

    if (!records || (records as any[]).length === 0) {
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

    // Analyze opportunities
    const opportunities: Record<string, any> = {};
    let totalCurrentCost = 0;
    let totalPotentialCost = 0;

    for (const record of records as any[]) {
      totalCurrentCost += record.cost || 0;

      // Analyze if cheaper model could have been used
      const complexity = modelRecommendationService.analyzeTaskComplexity(record.task_description || 'unknown');

      // Check if this was an expensive model for a simple task
      if (complexity.complexity <= 3 && record.model.includes('Opus')) {
        const key = 'simple_with_opus';
        if (!opportunities[key]) {
          opportunities[key] = {
            taskType: 'simple',
            usedModel: 'Claude 3 Opus',
            recommendedModel: 'Claude 3.5 Haiku',
            count: 0,
            totalCost: 0,
            potentialCost: 0,
            riskScore: 0.05,
            savings: '80-85%'
          };
        }
        opportunities[key].count++;
        opportunities[key].totalCost += record.cost || 0;

        // Estimate Haiku cost
        const haikuCost = ((record.input_tokens * 0.8 + record.output_tokens * 4) / 1000000);
        opportunities[key].potentialCost += haikuCost;
        totalPotentialCost += haikuCost;
      }

      // Check if Sonnet could replace Opus for medium complexity
      if (complexity.complexity >= 4 && complexity.complexity <= 6 && record.model.includes('Opus') && record.success_status === 'success') {
        const key = 'medium_with_opus';
        if (!opportunities[key]) {
          opportunities[key] = {
            taskType: 'medium',
            usedModel: 'Claude 3 Opus',
            recommendedModel: 'Claude 3.5 Sonnet',
            count: 0,
            totalCost: 0,
            potentialCost: 0,
            riskScore: 0.08,
            savings: '75-80%'
          };
        }
        opportunities[key].count++;
        opportunities[key].totalCost += record.cost || 0;

        // Estimate Sonnet cost
        const sonnetCost = ((record.input_tokens * 3 + record.output_tokens * 15) / 1000000);
        opportunities[key].potentialCost += sonnetCost;
        totalPotentialCost += sonnetCost;
      }
    }

    // Format opportunities (guard against divide-by-zero when totalCost is 0)
    const opportunityList = Object.values(opportunities).map((opp: any) => {
      const savingsRatio = opp.totalCost > 0
        ? 1 - (opp.potentialCost / opp.totalCost)
        : 0;
      return {
        ...opp,
        potentialSavings: `${(savingsRatio * 100).toFixed(1)}%`
      };
    });

    // Sort by potential savings (guard against divide-by-zero)
    opportunityList.sort((a: any, b: any) => {
      const savingsA = a.totalCost > 0 ? 1 - (a.potentialCost / a.totalCost) : 0;
      const savingsB = b.totalCost > 0 ? 1 - (b.potentialCost / b.totalCost) : 0;
      return savingsB - savingsA;
    });

    const totalPotentialSavings = totalCurrentCost - totalPotentialCost;

    res.status(200).json({
      success: true,
      period: period as 'day' | 'week' | 'month',
      lookbackDays,
      recordsAnalyzed: (records as any[]).length,
      opportunities: opportunityList,
      currentTotalCost: `$${totalCurrentCost.toFixed(2)}`,
      potentialTotalCost: `$${totalPotentialCost.toFixed(2)}`,
      totalPotentialSavings: `$${totalPotentialSavings.toFixed(2)}`,
      savingsPercent: totalCurrentCost > 0 ? `${((totalPotentialSavings / totalCurrentCost) * 100).toFixed(1)}%` : '0%',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in getOptimizationOpportunities:', error);
    res.status(500).json({
      success: false,
      period: 'week',
      lookbackDays: 7,
      recordsAnalyzed: 0,
      opportunities: [],
      currentTotalCost: '$0.00',
      potentialTotalCost: '$0.00',
      totalPotentialSavings: '$0.00',
      savingsPercent: '0%',
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    } as any);
  }
}
