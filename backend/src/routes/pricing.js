import express from 'express';
import {
  getPricing,
  updatePricing
} from '../controllers/pricingController.js';
import {
  updatePricingValidator,
  handleValidationErrors
} from '../middleware/validators.js';

const router = express.Router();

// Get all pricing
router.get('/', getPricing);

// Update pricing for a model
router.put('/:model', updatePricingValidator, handleValidationErrors, updatePricing);

export default router;
