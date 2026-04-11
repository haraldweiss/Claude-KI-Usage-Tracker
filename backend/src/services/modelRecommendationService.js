import * as db from '../database/sqlite.js';

// Complexity keywords for task analysis
const COMPLEXITY_KEYWORDS = {
  simple: ['summarize', 'list', 'format', 'extract', 'simple', 'search', 'translate', 'rewrite', 'capitalize'],
  medium: ['debug', 'review', 'explain', 'refactor', 'analyze', 'code review', 'fix', 'improve', 'optimize'],
  complex: ['architecture', 'design', 'reasoning', 'system design', 'ctf', 'exploit', 'research', 'research', 'multi-step', 'novel', 'challenging']
};

// Model pricing (current as of April 2026)
const MODEL_PRICING = {
  'Claude 3.5 Haiku': { input: 0.8, output: 4 },
  'Claude 3.5 Sonnet': { input: 3, output: 15 },
  'Claude 3 Opus': { input: 15, output: 75 }
};

const AVAILABLE_MODELS = ['Claude 3.5 Haiku', 'Claude 3.5 Sonnet', 'Claude 3 Opus'];

/**
 * Analyzes task description and returns complexity score (1-10) and category
 */
export function analyzeTaskComplexity(taskDescription) {
  const desc = taskDescription.toLowerCase();
  let complexity = 5; // Default middle value
  let category = 'general';
  let matchedKeywords = [];

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
export async function calculateSafetyScore(model, lookbackDays = 30) {
  try {
    // Get model analysis (cached stats)
    const analysis = await db.getQuery(
      'SELECT success_rate, error_count FROM model_analysis WHERE model = ?',
      [model]
    );

    if (!analysis) {
      // No historical data - use neutral score
      return { score: 70, basis: 'no_data' };
    }

    const successRate = analysis.success_rate || 0;
    let score = successRate * 100;

    // Scale safety score based on success rate tiers
    if (successRate >= 0.95) {
      score = 100; // Very safe
    } else if (successRate >= 0.90) {
      score = 88;
    } else if (successRate >= 0.80) {
      score = 75; // Acceptable
    } else if (successRate >= 0.70) {
      score = 60;
    } else {
      score = 45; // Risky
    }

    // Penalty for errors (if we track error types later)
    if (analysis.error_count > 5) {
      score = Math.max(50, score - 10);
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      successRate,
      errorCount: analysis.error_count || 0,
      basis: 'historical_data'
    };
  } catch (error) {
    console.error('Error calculating safety score:', error);
    return { score: 70, basis: 'error', error: error.message };
  }
}

/**
 * Calculates cost-benefit score for a model (0-100)
 * Combines cost efficiency with safety and task complexity fit
 */
export async function calculateCostBenefit(model, complexity, costWeightage = 0.3) {
  try {
    const safetyData = await calculateSafetyScore(model);
    const safetyScore = safetyData.score;

    // Get model pricing
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      return { score: 0, error: 'Unknown model' };
    }

    // Calculate cost score (lower cost = higher score)
    const maxCost = Math.max(...AVAILABLE_MODELS.map(m => (MODEL_PRICING[m].input + MODEL_PRICING[m].output) / 2));
    const modelCost = (pricing.input + pricing.output) / 2;
    const costScore = ((maxCost - modelCost) / maxCost) * 100;

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
    const finalScore = (costScore * costWeightage) + (safetyScore * (1 - costWeightage)) + complexityMatch;

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
    console.error('Error calculating cost-benefit:', error);
    return { score: 0, error: error.message };
  }
}

/**
 * Main recommendation function - recommends best model for a task
 */
export async function recommendModel(taskDescription, constraints = {}) {
  try {
    const {
      maxCost = null,
      minSafety = 70,
      preferredModels = null,
      avoidModels = null
    } = constraints;

    // Analyze task
    const taskAnalysis = analyzeTaskComplexity(taskDescription);
    const complexity = taskAnalysis.complexity;

    // Get all models to evaluate
    let modelsToEvaluate = AVAILABLE_MODELS;
    if (preferredModels) {
      modelsToEvaluate = modelsToEvaluate.filter(m => preferredModels.includes(m));
    }
    if (avoidModels) {
      modelsToEvaluate = modelsToEvaluate.filter(m => !avoidModels.includes(m));
    }

    // Score each model
    const scores = [];
    for (const model of modelsToEvaluate) {
      const costBenefit = await calculateCostBenefit(model, complexity);
      const safety = await calculateSafetyScore(model);
      const pricing = MODEL_PRICING[model];

      // Check constraints
      if (safety.score < minSafety) {
        costBenefit.score = Math.max(0, costBenefit.score - 30); // Penalize unsafe models
      }

      scores.push({
        model,
        score: costBenefit.score,
        safetyScore: safety.score,
        costScore: costBenefit.costScore || 0,
        pricing,
        components: costBenefit.components
      });
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);

    // Prepare recommendation response
    const recommended = scores[0];
    const alternatives = scores.slice(1);

    // Calculate estimated costs
    const estimatedInputTokens = 1000; // Average request
    const estimatedOutputTokens = 500; // Average response
    const estimateCost = (inputTokens, outputTokens, pricing) => {
      return ((inputTokens * pricing.input + outputTokens * pricing.output) / 1000000).toFixed(4);
    };

    // Confidence based on score spread and safety
    let confidence = Math.min(0.99, (recommended.score / 100) * 0.9 + 0.1);
    if (recommended.safetyScore >= 85) {
      confidence = Math.min(0.99, confidence + 0.05);
    }

    // Build response
    return {
      recommended: recommended.model,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: {
        complexity,
        category: taskAnalysis.category,
        matchedKeywords: taskAnalysis.matchedKeywords,
        safetyScore: recommended.safetyScore,
        costScore: recommended.costScore,
        estimatedCost: `$${estimateCost(estimatedInputTokens, estimatedOutputTokens, recommended.pricing)}`
      },
      alternatives: alternatives.map(alt => ({
        model: alt.model,
        confidence: Math.round((alt.score / 100) * 100) / 100,
        savings: alt.model.includes('Haiku') && recommended.model.includes('Opus')
          ? '75-85%'
          : alt.model.includes('Haiku') && recommended.model.includes('Sonnet')
            ? '60-70%'
            : alt.model.includes('Sonnet') && recommended.model.includes('Opus')
              ? '75-80%'
              : 'N/A',
        riskOfFailure: alt.safetyScore >= 85 ? 'Low' : alt.safetyScore >= 70 ? 'Medium' : 'High',
        safetyImprovement: ((recommended.safetyScore - alt.safetyScore) / 100 * 100).toFixed(0) + '%'
      })),
      historicalData: {
        successRateHaiku: (await calculateSafetyScore('Claude 3.5 Haiku')).successRate || 0,
        successRateSonnet: (await calculateSafetyScore('Claude 3.5 Sonnet')).successRate || 0,
        successRateOpus: (await calculateSafetyScore('Claude 3 Opus')).successRate || 0
      }
    };
  } catch (error) {
    console.error('Error in recommendModel:', error);
    return {
      error: error.message,
      fallback: 'Claude 3.5 Sonnet'
    };
  }
}

/**
 * Refreshes model analytics by aggregating historical usage data
 * Should be called daily via cron
 */
export async function refreshModelAnalytics() {
  try {
    console.log('Starting model analytics refresh...');

    // Get all models from usage_records
    const models = await db.allQuery(
      'SELECT DISTINCT model FROM usage_records WHERE timestamp >= datetime(\'now\', \'-30 days\')'
    );

    if (!models || models.length === 0) {
      console.log('No usage data found for analytics refresh');
      return { updated: 0 };
    }

    let updated = 0;

    for (const { model } of models) {
      // Get usage stats for this model (last 30 days)
      const stats = await db.getQuery(`
        SELECT
          COUNT(*) as total_requests,
          ROUND(CAST(SUM(CASE WHEN success_status = 'success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*), 3) as success_rate,
          SUM(CASE WHEN success_status = 'error' THEN 1 ELSE 0 END) as error_count,
          ROUND(AVG(input_tokens), 1) as avg_input_tokens,
          ROUND(AVG(output_tokens), 1) as avg_output_tokens,
          ROUND(AVG(cost), 6) as cost_per_request
        FROM usage_records
        WHERE model = ? AND timestamp >= datetime('now', '-30 days')
      `, [model]);

      if (stats && stats.total_requests > 0) {
        await db.insertOrUpdateModelAnalysis(model, {
          total_requests: stats.total_requests || 0,
          success_rate: stats.success_rate || 0,
          error_count: stats.error_count || 0,
          avg_input_tokens: stats.avg_input_tokens || 0,
          avg_output_tokens: stats.avg_output_tokens || 0,
          cost_per_request: stats.cost_per_request || 0
        });

        updated++;
        console.log(`Updated analytics for ${model}: ${stats.total_requests} requests, ${(stats.success_rate * 100).toFixed(1)}% success rate`);
      }
    }

    console.log(`Model analytics refresh completed. Updated ${updated} models.`);
    return { updated, timestamp: new Date().toISOString() };
  } catch (error) {
    console.error('Error refreshing model analytics:', error);
    throw error;
  }
}
