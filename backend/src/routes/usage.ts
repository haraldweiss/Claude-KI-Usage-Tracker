import express, { Router } from 'express';
import {
  trackUsage,
  getSummary,
  getModelBreakdown,
  getHistory,
  getConsoleKeys,
  getSpendingTotal
} from '../controllers/usageController.js';
import {
  trackUsageValidator,
  getSummaryValidator,
  getHistoryValidator,
  handleValidationErrors
} from '../middleware/validators.js';
import { requireUser } from '../middleware/auth.js';

const router: Router = express.Router();
router.use(requireUser);

// Track new usage
router.post('/track', trackUsageValidator, handleValidationErrors, trackUsage);

// Get summary statistics (by period)
router.get('/summary', getSummaryValidator, handleValidationErrors, getSummary);

// Get breakdown by model
router.get('/models', getModelBreakdown);

// Get usage history
router.get('/history', getHistoryValidator, handleValidationErrors, getHistory);

// Per-key snapshot of the latest sync from console.anthropic.com and platform.claude.com
router.get('/console/keys', getConsoleKeys);

// All-time spending: every month with at least one claude.ai sync, plus
// the cumulative API cost as of the most recent console sync.
router.get('/spending-total', getSpendingTotal);

export default router;
