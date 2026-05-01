import express, { Router } from 'express';
import * as modelRecommendationController from '../controllers/modelRecommendationController.js';
import { requireUser } from '../middleware/auth.js';
import {
  recommendValidator,
  getModelAnalysisValidator,
  getOptimizationOpportunitiesValidator,
  handleValidationErrors
} from '../middleware/validators.js';

const router: Router = express.Router();
router.use(requireUser);

/**
 * POST /api/recommend
 * Request body: { taskDescription, constraints?: { maxCost, minSafety, preferredModels, avoidModels } }
 * Returns: { recommended, confidence, reasoning, alternatives, historicalData }
 */
router.post('/', recommendValidator, handleValidationErrors, modelRecommendationController.recommendModel);

/**
 * GET /api/analysis/models?period=day|week|month
 * Returns model statistics and success rates
 */
router.get('/analysis/models', getModelAnalysisValidator, handleValidationErrors, modelRecommendationController.getModelAnalysis);

/**
 * GET /api/analysis/opportunities?period=day|week|month
 * Returns cost optimization opportunities
 */
router.get('/analysis/opportunities', getOptimizationOpportunitiesValidator, handleValidationErrors, modelRecommendationController.getOptimizationOpportunities);

export default router;
