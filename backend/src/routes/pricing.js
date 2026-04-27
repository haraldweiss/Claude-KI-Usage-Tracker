import express from 'express';
import { getPricing, updatePricing, confirmPricing } from '../controllers/pricingController.js';
import { updatePricingValidator, confirmPricingValidator, handleValidationErrors } from '../middleware/validators.js';
const router = express.Router();
// Get all pricing
router.get('/', getPricing);
// Update pricing for a model
router.put('/:model', updatePricingValidator, handleValidationErrors, updatePricing);
// Confirm pricing (transition from pending_confirmation to active)
router.post('/:model/confirm', confirmPricingValidator, handleValidationErrors, confirmPricing);
export default router;
//# sourceMappingURL=pricing.js.map