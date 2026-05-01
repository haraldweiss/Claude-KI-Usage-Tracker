import express, { Router } from 'express';
import {
  getPricing,
  updatePricing,
  confirmPricing,
  getPlans,
  updatePlan,
  triggerPlanRefresh
} from '../controllers/pricingController.js';
import {
  updatePricingValidator,
  confirmPricingValidator,
  handleValidationErrors
} from '../middleware/validators.js';
import { requireUser, requireAdmin } from '../middleware/auth.js';

const router: Router = express.Router();

// All pricing routes require authentication
router.use(requireUser);

// Get all pricing
router.get('/', getPricing);

// Plan subscription pricing — list/edit/refresh
router.get('/plans', getPlans);
router.put('/plans/:name', requireAdmin, updatePlan);
router.post('/plans/refresh', requireAdmin, triggerPlanRefresh);

// Update pricing for a model
router.put('/:model', requireAdmin, updatePricingValidator, handleValidationErrors, updatePricing);

// Confirm pricing (transition from pending_confirmation to active)
router.post('/:model/confirm', requireAdmin, confirmPricingValidator, handleValidationErrors, confirmPricing);

export default router;
