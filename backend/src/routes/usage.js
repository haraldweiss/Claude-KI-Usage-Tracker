import express from 'express';
import { trackUsage, getSummary, getModelBreakdown, getHistory } from '../controllers/usageController.js';
import { trackUsageValidator, getSummaryValidator, getHistoryValidator, handleValidationErrors } from '../middleware/validators.js';
const router = express.Router();
// Track new usage
router.post('/track', trackUsageValidator, handleValidationErrors, trackUsage);
// Get summary statistics (by period)
router.get('/summary', getSummaryValidator, handleValidationErrors, getSummary);
// Get breakdown by model
router.get('/models', getModelBreakdown);
// Get usage history
router.get('/history', getHistoryValidator, handleValidationErrors, getHistory);
export default router;
//# sourceMappingURL=usage.js.map