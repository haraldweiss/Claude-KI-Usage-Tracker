import express, { Router } from 'express';
import {
  trackUsage,
  getSummary,
  getModelBreakdown,
  getHistory,
  confirmEffectiveness,
  getConsoleKeys
} from '../controllers/usageController.js';
import {
  trackUsageValidator,
  getSummaryValidator,
  getHistoryWithFiltersValidator,
  confirmEffectivenessValidator,
  handleValidationErrors
} from '../middleware/validators.js';

const router: Router = express.Router();

// Track new usage
router.post('/track', trackUsageValidator, handleValidationErrors, trackUsage);

// Get summary statistics (by period)
router.get('/summary', getSummaryValidator, handleValidationErrors, getSummary);

// Get breakdown by model
router.get('/models', getModelBreakdown);

// Get usage history with optional category & status filters
router.get('/history', getHistoryWithFiltersValidator, handleValidationErrors, getHistory);

// Per-key snapshot of the latest sync from console.anthropic.com
router.get('/console/keys', getConsoleKeys);

// Confirm or correct categorization for a record
router.put(
  '/:id/confirm-effectiveness',
  confirmEffectivenessValidator,
  handleValidationErrors,
  confirmEffectiveness
);

export default router;
