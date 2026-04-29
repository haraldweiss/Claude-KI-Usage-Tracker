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

const router: Router = express.Router();

// Get all pricing
router.get('/', getPricing);

// Plan subscription pricing — list/edit/refresh
router.get('/plans', getPlans);
router.put('/plans/:name', updatePlan);
router.post('/plans/refresh', triggerPlanRefresh);

// Update pricing for a model
router.put('/:model', updatePricingValidator, handleValidationErrors, updatePricing);

// Confirm pricing (transition from pending_confirmation to active)
router.post('/:model/confirm', confirmPricingValidator, handleValidationErrors, confirmPricing);

export default router;
