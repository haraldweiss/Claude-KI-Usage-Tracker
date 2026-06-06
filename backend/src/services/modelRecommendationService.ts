// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import * as db from '../database/sqlite.js';
import type { TaskComplexity, SafetyScore, ModelAnalyticsRefreshResult } from '../types/index.js';
import { resolveTargetFamilies } from '../data/keywordFamilyMap.js';
import { resolveLocalInstalledCards, type LocalInstalledCard } from './localInstalledService.js';
import { getModelProsCons } from '../data/modelProsConsRepo.js';
import { generateClaudeProsCons } from './catalogProsConsService.js';
import logger from '../utils/logger.js';

// Last-resort fallback when even loadActiveModels() throws. Updated to a
// currently-active model on each pricing-fallback snapshot revision.
const HARDCODED_FALLBACK_MODEL = 'Claude Sonnet 4.6';

interface ActiveModel {
  model: string;
  input_price: number;
  output_price: number;
  tier: string | null;
  last_updated: string | null;
}

// Extrahiert die letzte Versions-Zahl im Modellnamen als [major, minor]-Tupel.
// "Claude Sonnet 4.6" → [4, 6]; "Claude Opus 4.10" → [4, 10]; "Claude Haiku 5" → [5, 0].
// Tuple-Vergleich vermeidet den Float-Vergleichsfehler bei "4.10" vs "4.5"
// (als Float: 4.10 < 4.5; als Tupel: [4,10] > [4,5]).
export function extractVersionKey(modelName: string): [number, number] {
  const matches = modelName.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return [0, 0];
  const last = matches[matches.length - 1]!;
  const parts = last.split('.');
  const major = parseInt(parts[0]!, 10);
  const minor = parts[1] ? parseInt(parts[1], 10) : 0;
  return [Number.isFinite(major) ? major : 0, Number.isFinite(minor) ? minor : 0];
}

async function loadActiveModels(): Promise<ActiveModel[]> {
  const rows = (await db.allQuery(
    "SELECT model, input_price, output_price, tier, last_updated FROM pricing WHERE status = 'active'"
  )) as ActiveModel[];
  // Sortierung in JS, damit Versions-Tupel korrekt verglichen werden (SQLite kann
  // "Claude Sonnet 4.10" vs "4.5" nicht lexikographisch lösen). Reihenfolge:
  // tier alphabetisch, dann Version DESC. Bei Score-Gleichstand im Recommender
  // gewinnt der erste — also das jeweils neueste Modell pro tier.
  rows.sort((a, b) => {
    const tierA = a.tier ?? '';
    const tierB = b.tier ?? '';
    if (tierA !== tierB) return tierA.localeCompare(tierB);
    const [aMaj, aMin] = extractVersionKey(a.model);
    const [bMaj, bMin] = extractVersionKey(b.model);
    if (aMaj !== bMaj) return bMaj - aMaj;
    if (aMin !== bMin) return bMin - aMin;
    return a.model.localeCompare(b.model);
  });
  return rows;
}

// Complexity keywords for task analysis
const COMPLEXITY_KEYWORDS = {
  simple: ['summarize', 'list', 'format', 'extract', 'simple', 'search', 'translate', 'rewrite', 'capitalize'],
  medium: ['debug', 'review', 'explain', 'refactor', 'analyze', 'code review', 'fix', 'improve', 'optimize'],
  complex: [
    'architecture',
    'design',
    'reasoning',
    'system design',
    'ctf',
    'exploit',
    'research',
    'research',
    'multi-step',
    'novel',
    'challenging'
  ]
} as const;

interface RecommendationConstraints {
  maxCost?: number | null;
  minSafety?: number;
  preferredModels?: string[] | null;
  avoidModels?: string[] | null;
}

interface ModelScore {
  model: string;
  score: number;
  safetyScore: number;
  costScore: number;
  pricing: { input: number; output: number };
  components?: {
    cost: number;
    safety: number;
    complexity: number;
  };
}

interface HistoricalData {
  successRateHaiku: number;
  successRateSonnet: number;
  successRateOpus: number;
}

interface RecommendationAlternative {
  model: string;
  confidence: number;
  savings: string;
  riskOfFailure: string;
  safetyImprovement: string;
  pros?: string[];
  cons?: string[];
}

export interface LocalAlternative {
  name: string;
  base_name: string;
  family: 'chat' | 'code' | 'embedding' | 'custom';
  pros?: string[];
  cons?: string[];
  ollama_command: string;
}

interface RecommendationResponse {
  recommended?: string;
  confidence?: number;
  reasoning?: {
    complexity: number;
    category: string;
    matchedKeywords: string[];
    safetyScore: number;
    costScore: number;
    estimatedCost: string;
  };
  alternatives?: RecommendationAlternative[];
  historicalData?: HistoricalData;
  error?: string;
  fallback?: string;
  pros?: string[];
  cons?: string[];
  localAlternatives?: LocalAlternative[];
}

interface ModelAnalysisRecord {
  success_rate: number;
  error_count: number;
}

interface ModelStatsRecord {
  model: string;
}

interface UsageStatsRecord {
  total_requests: number;
  success_rate: number;
  error_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  cost_per_request: number;
}

interface CostBenefitResult {
  score: number;
  costScore?: number;
  safetyScore?: number;
  complexityMatch?: number;
  components?: {
    cost: number;
    safety: number;
    complexity: number;
  };
  error?: string;
}

/**
 * Analyzes task description and returns complexity score (1-10) and category
 */
export function analyzeTaskComplexity(taskDescription: string): TaskComplexity {
  const desc = taskDescription.toLowerCase();
  let complexity = 5; // Default middle value
  let category: 'simple_task' | 'medium_task' | 'complex_task' | 'general' = 'general';
  let matchedKeywords: string[] = [];

  // Check simple keywords
  for (const keyword of COMPLEXITY_KEYWORDS.simple) {
    if (desc.includes(keyword)) {
      complexity = Math.min(complexity, 2);
      category = 'simple_task';
      matchedKeywords.push(keyword);
      break;
    }
  }

  // Check medium keywords
  for (const keyword of COMPLEXITY_KEYWORDS.medium) {
    if (desc.includes(keyword)) {
      complexity = Math.min(complexity, 5);
      category = 'medium_task';
      matchedKeywords.push(keyword);
    }
  }

  // Check complex keywords
  for (const keyword of COMPLEXITY_KEYWORDS.complex) {
    if (desc.includes(keyword)) {
      complexity = Math.max(complexity, 8);
      category = 'complex_task';
      matchedKeywords.push(keyword);
    }
  }

  return {
    complexity: Math.max(1, Math.min(10, complexity)),
    category,
    matchedKeywords: [...new Set(matchedKeywords)]
  };
}

/**
 * Calculates safety score (0-100) based on model's historical success rate
 */
export async function calculateSafetyScore(model: string): Promise<SafetyScore> {
  try {
    // Get model analysis (cached stats)
    const analysis = (await db.getQuery(
      'SELECT success_rate, error_count FROM model_analysis WHERE model = ?',
      [model]
    )) as ModelAnalysisRecord | undefined;

    if (!analysis) {
      // No historical data - use neutral score
      return { score: 70, basis: 'no_data' };
    }

    const successRate = analysis.success_rate || 0;
    let score = successRate * 100;

    // Scale safety score based on success rate tiers
    if (successRate >= 0.95) {
      score = 100; // Very safe
    } else if (successRate >= 0.9) {
      score = 88;
    } else if (successRate >= 0.8) {
      score = 75; // Acceptable
    } else if (successRate >= 0.7) {
      score = 60;
    } else {
      score = 45; // Risky
    }

    // Penalty for errors (if we track error types later)
    if ((analysis.error_count || 0) > 5) {
      score = Math.max(50, score - 10);
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      successRate,
      errorCount: analysis.error_count || 0,
      basis: 'historical_data'
    };
  } catch (error) {
logger.error({ err: error }, 'Error calculating safety score:');
    return { score: 70, basis: 'no_data' };
  }
}

/**
 * Calculates cost-benefit score for a model (0-100)
 * Combines cost efficiency with safety and task complexity fit
 */
export async function calculateCostBenefit(
  model: string,
  complexity: number,
  costWeightage: number = 0.3,
  activeModels?: ActiveModel[]
): Promise<CostBenefitResult> {
  try {
    const safetyData = await calculateSafetyScore(model);
    const safetyScore = safetyData.score;

    // Load active models if not provided
    const models = activeModels ?? (await loadActiveModels());

    // Get model pricing from DB
    const row = models.find(m => m.model === model);
    if (!row) {
      return { score: 0, error: 'Unknown model' };
    }
    const pricing = { input: row.input_price, output: row.output_price };

    // Calculate cost score (lower cost = higher score)
    const maxCost = Math.max(
      ...models.map(m => (m.input_price ?? 0) + (m.output_price ?? 0) / 2)
    );
    const modelCost = (pricing.input + pricing.output) / 2;
    const costScore = maxCost > 0 ? ((maxCost - modelCost) / maxCost) * 100 : 0;

    // Complexity match scoring
    // Haiku: Best for simple (1-3), gets -20 for complex
    // Sonnet: Best for medium (4-6), neutral for all
    // Opus: Best for complex (7-10), gets -10 for simple
    let complexityMatch = 0;

    if (model.includes('Haiku')) {
      if (complexity <= 3) complexityMatch = 10;
      else if (complexity <= 5) complexityMatch = 0;
      else if (complexity <= 7) complexityMatch = -10;
      else complexityMatch = -20;
    } else if (model.includes('Sonnet')) {
      if (complexity <= 3) complexityMatch = 0;
      else if (complexity <= 6) complexityMatch = 10;
      else complexityMatch = -5;
    } else if (model.includes('Opus')) {
      if (complexity <= 3) complexityMatch = -10;
      else if (complexity <= 6) complexityMatch = 0;
      else complexityMatch = 15;
    }

    // Final weighted score
    const finalScore = costScore * costWeightage + safetyScore * (1 - costWeightage) + complexityMatch;

    return {
      score: Math.max(0, Math.min(100, finalScore)),
      costScore,
      safetyScore,
      complexityMatch,
      components: {
        cost: costScore,
        safety: safetyScore,
        complexity: complexityMatch
      }
    };
  } catch (error) {
logger.error({ err: error }, 'Error calculating cost-benefit:');
    return { score: 0, error: (error as Error).message };
  }
}

/**
 * Main recommendation function - recommends best model for a task
 */
export async function recommendModel(
  taskDescription: string,
  constraints: RecommendationConstraints = {},
  userId?: number,
): Promise<RecommendationResponse> {
  try {
    const { minSafety = 70, preferredModels = null, avoidModels = null } = constraints;

    // Load active models from DB once for this call
    const activeModels = await loadActiveModels();

    // Analyze task
    const taskAnalysis = analyzeTaskComplexity(taskDescription);
    const complexity = taskAnalysis.complexity;

    // Get all models to evaluate
    let modelsToEvaluate = activeModels.map(m => m.model);
    if (preferredModels) {
      modelsToEvaluate = modelsToEvaluate.filter(m => preferredModels.includes(m));
    }
    if (avoidModels) {
      modelsToEvaluate = modelsToEvaluate.filter(m => !avoidModels.includes(m));
    }

    // Score each model
    const scores: ModelScore[] = [];
    const safetyByModel = new Map<string, Awaited<ReturnType<typeof calculateSafetyScore>>>();

    for (const model of modelsToEvaluate) {
      const costBenefit = await calculateCostBenefit(model, complexity, 0.3, activeModels);
      const safety = await calculateSafetyScore(model);
      safetyByModel.set(model, safety);
      const row = activeModels.find(m => m.model === model);

      if (!row) continue;
      const pricing = { input: row.input_price, output: row.output_price };

      let finalScore = costBenefit.score || 0;

      // Check constraints
      if (safety.score < minSafety) {
        finalScore = Math.max(0, finalScore - 30); // Penalize unsafe models
      }

      scores.push({
        model,
        score: finalScore,
        safetyScore: safety.score,
        costScore: costBenefit.costScore || 0,
        pricing,
        components: costBenefit.components
      });
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);

    // Build tier-to-representative-model map for historicalData
    const byTier: Record<string, ActiveModel | undefined> = {};
    for (const m of activeModels) {
      const tier = (m.tier ?? '').toLowerCase();
      if (tier === 'haiku' || tier === 'sonnet' || tier === 'opus') {
        if (!byTier[tier]) byTier[tier] = m;
      }
    }
    const haikuModel = byTier['haiku']?.model;
    const sonnetModel = byTier['sonnet']?.model;
    const opusModel = byTier['opus']?.model;

    if (scores.length === 0) {
      return {
        error: 'No models available for evaluation',
        fallback: sonnetModel ?? haikuModel ?? activeModels[0]?.model ?? HARDCODED_FALLBACK_MODEL
      };
    }

    // Prepare recommendation response
    const recommended = scores[0];
    if (!recommended) {
      return {
        error: 'Failed to select recommendation',
        fallback: sonnetModel ?? haikuModel ?? activeModels[0]?.model ?? HARDCODED_FALLBACK_MODEL
      };
    }

    const alternatives = scores.slice(1);

    // Calculate estimated costs
    const estimatedInputTokens = 1000; // Average request
    const estimatedOutputTokens = 500; // Average response
    const estimateCost = (inputTokens: number, outputTokens: number, pricing: { input: number; output: number }): string => {
      return (
        (
          (inputTokens * pricing.input + outputTokens * pricing.output) /
          1000000
        ).toFixed(4)
      );
    };

    // Build response - recommended is guaranteed to exist due to check above
    const recommendedModel = recommended.model;
    const recommendedSafetyScore = recommended.safetyScore;
    const recommendedCostScore = recommended.costScore;
    const recommendedPricing = recommended.pricing;

    // Confidence based on score spread and safety
    let confidence = Math.min(0.99, (recommended.score / 100) * 0.9 + 0.1);
    if (recommendedSafetyScore >= 85) {
      confidence = Math.min(0.99, confidence + 0.05);
    }

    // Build historicalData using tier-representative models from active DB records
    const historicalData: HistoricalData = {
      successRateHaiku: haikuModel ? safetyByModel.get(haikuModel)?.successRate || 0 : 0,
      successRateSonnet: sonnetModel ? safetyByModel.get(sonnetModel)?.successRate || 0 : 0,
      successRateOpus: opusModel ? safetyByModel.get(opusModel)?.successRate || 0 : 0
    };

    // Enrich with pros/cons from model_pros_cons. Fire-and-forget generation
    // for misses — sequentially with 2s pauses to avoid hammering the LLM pool.
    const namesToEnrich = [recommendedModel, ...alternatives.map((a) => a.model)];
    const prosConsByModel = new Map<string, { pros: string[]; cons: string[] }>();
    const needsClaudeGeneration: Array<{ name: string; tier: string | null; pricing: { input: number; output: number } }> = [];

    for (const name of namesToEnrich) {
      const cached = await getModelProsCons(name);
      if (cached) {
        prosConsByModel.set(name, { pros: cached.pros, cons: cached.cons });
        continue;
      }
      const row = activeModels.find((m) => m.model === name);
      if (row) {
        needsClaudeGeneration.push({
          name,
          tier: row.tier,
          pricing: { input: row.input_price, output: row.output_price },
        });
      }
    }

    if (needsClaudeGeneration.length > 0) {
      void (async () => {
        for (const { name, tier, pricing } of needsClaudeGeneration) {
          try {
            await generateClaudeProsCons(name, tier, pricing);
          } catch (err) {
            logger.error({ name, err }, '[reco-catalog] claude pros/cons generate failed');
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      })().catch(() => {});
    }

    // Resolve local alternatives, filtered by task-matched families.
    let localAlternatives: LocalAlternative[] = [];
    if (userId !== undefined) {
      const targetFamilies = new Set(resolveTargetFamilies(taskAnalysis.matchedKeywords));
      const localCards: LocalInstalledCard[] = await resolveLocalInstalledCards(userId);
      localAlternatives = localCards
        .filter((c) => targetFamilies.has(c.family))
        .map((c) => ({
          name: c.name,
          base_name: c.base_name,
          family: c.family,
          pros: c.pros,
          cons: c.cons,
          ollama_command: `ollama run ${c.name}`,
        }));
    }

    const recoProsCons = prosConsByModel.get(recommendedModel);

    return {
      recommended: recommendedModel,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: {
        complexity,
        category: taskAnalysis.category,
        matchedKeywords: taskAnalysis.matchedKeywords,
        safetyScore: recommendedSafetyScore,
        costScore: recommendedCostScore,
        estimatedCost: `$${estimateCost(estimatedInputTokens, estimatedOutputTokens, recommendedPricing)}`,
      },
      pros: recoProsCons?.pros,
      cons: recoProsCons?.cons,
      alternatives: alternatives.map((alt) => {
        const altPC = prosConsByModel.get(alt.model);
        return {
          model: alt.model,
          confidence: Math.round((alt.score / 100) * 100) / 100,
          savings:
            alt.model.includes('Haiku') && recommendedModel.includes('Opus')
              ? '75-85%'
              : alt.model.includes('Haiku') && recommendedModel.includes('Sonnet')
                ? '60-70%'
                : alt.model.includes('Sonnet') && recommendedModel.includes('Opus')
                  ? '75-80%'
                  : 'N/A',
          riskOfFailure: alt.safetyScore >= 85 ? 'Low' : alt.safetyScore >= 70 ? 'Medium' : 'High',
          safetyImprovement: (((recommendedSafetyScore - alt.safetyScore) / 100) * 100).toFixed(0) + '%',
          pros: altPC?.pros,
          cons: altPC?.cons,
        };
      }),
      historicalData,
      localAlternatives,
    };
  } catch (error) {
logger.error({ err: error }, 'Error in recommendModel:');
    return {
      error: (error as Error).message,
      fallback: HARDCODED_FALLBACK_MODEL
    };
  }
}

/**
 * Refreshes model analytics by aggregating historical usage data
 * Should be called daily via cron
 */
export async function refreshModelAnalytics(): Promise<ModelAnalyticsRefreshResult> {
  try {
    logger.info('Starting model analytics refresh...');

    // Get all models from usage_records
    const models = (await db.allQuery(
      'SELECT DISTINCT model FROM usage_records WHERE timestamp >= datetime(\'now\', \'-30 days\')'
    )) as ModelStatsRecord[];

    if (!models || models.length === 0) {
      logger.info('No usage data found for analytics refresh');
      return {
        success: false,
        modelsUpdated: 0,
        models: [],
        timestamp: new Date().toISOString(),
        message: 'No usage data found'
      };
    }

    let updated = 0;
    const updatedModels: string[] = [];

    for (const { model } of models) {
      // Get usage stats for this model (last 30 days)
      const stats = (await db.getQuery(
        `
        SELECT
          COUNT(*) as total_requests,
          ROUND(CAST(SUM(CASE WHEN success_status = 'success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*), 3) as success_rate,
          SUM(CASE WHEN success_status = 'error' THEN 1 ELSE 0 END) as error_count,
          ROUND(AVG(input_tokens), 1) as avg_input_tokens,
          ROUND(AVG(output_tokens), 1) as avg_output_tokens,
          ROUND(AVG(cost), 6) as cost_per_request
        FROM usage_records
        WHERE model = ? AND timestamp >= datetime('now', '-30 days')
      `,
        [model]
      )) as UsageStatsRecord | undefined;

      if (stats && (stats.total_requests || 0) > 0) {
        await db.insertOrUpdateModelAnalysis(model, {
          total_requests: stats.total_requests || 0,
          success_rate: stats.success_rate || 0,
          error_count: stats.error_count || 0,
          avg_input_tokens: stats.avg_input_tokens || 0,
          avg_output_tokens: stats.avg_output_tokens || 0,
          cost_per_request: stats.cost_per_request || 0
        });

        updated++;
        updatedModels.push(model);
        logger.info(
          `Updated analytics for ${model}: ${stats.total_requests} requests, ${((stats.success_rate || 0) * 100).toFixed(1)}% success rate`
        );
      }
    }

    logger.info(`Model analytics refresh completed. Updated ${updated} models.`);
    return {
      success: true,
      modelsUpdated: updated,
      models: updatedModels,
      timestamp: new Date().toISOString(),
      message: `Updated ${updated} model analytics`
    };
  } catch (error) {
logger.error({ err: error }, 'Error refreshing model analytics:');
    throw error;
  }
}
