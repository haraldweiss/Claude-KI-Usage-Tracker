import { body, query, param, validationResult, ValidationError } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to handle validation errors
 * Should be placed after all validators in a route
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      errors: errors.array().map((err: ValidationError) => ({
        field: err.type === 'field' ? err.path : 'unknown',
        message: err.msg,
        value: err.type === 'field' ? err.value : undefined
      }))
    });
    return;
  }
  next();
};

/**
 * POST /api/usage/track
 * Validates usage tracking request body
 */
export const trackUsageValidator = [
  body('model')
    .trim()
    .notEmpty()
    .withMessage('model is required')
    .isLength({ max: 100 })
    .withMessage('model must be less than 100 characters')
    .escape(),

  body('input_tokens')
    .isInt({ min: 0 })
    .withMessage('input_tokens must be a non-negative integer'),

  body('output_tokens')
    .isInt({ min: 0 })
    .withMessage('output_tokens must be a non-negative integer'),

  body('conversation_id')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('conversation_id must be less than 500 characters')
    .escape(),

  body('source')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('source must be less than 50 characters')
    .escape(),

  body('task_description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('task_description must be less than 1000 characters')
    .escape(),

  body('success_status')
    .optional()
    .trim()
    .isIn(['unknown', 'success', 'error'])
    .withMessage('success_status must be one of: unknown, success, error'),

  body('response_metadata')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return true;
        } catch {
          throw new Error('response_metadata must be valid JSON if provided as string');
        }
      }
      if (typeof value === 'object') {
        return true;
      }
      throw new Error('response_metadata must be an object or valid JSON string');
    }),

  // Plan B: Console scraping fields
  body('workspace')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('workspace must be less than 100 characters')
    .escape(),

  body('key_name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('key_name must be less than 100 characters')
    .escape(),

  body('key_id_suffix')
    .optional()
    .trim()
    .isLength({ max: 16 })
    .withMessage('key_id_suffix must be less than 16 characters')
    .escape(),

  body('cost_usd')
    .optional()
    .isFloat({ min: 0, max: 1_000_000 })
    .withMessage('cost_usd must be a non-negative number')
];

/**
 * PUT /api/pricing/:model
 * Validates pricing update request
 */
export const updatePricingValidator = [
  param('model')
    .trim()
    .notEmpty()
    .withMessage('model parameter is required')
    .isLength({ max: 100 })
    .withMessage('model must be less than 100 characters')
    .escape(),

  body('input_price')
    .isFloat({ min: 0, max: 10000 })
    .withMessage('input_price must be a number between 0 and 10000'),

  body('output_price')
    .isFloat({ min: 0, max: 10000 })
    .withMessage('output_price must be a number between 0 and 10000')
];

/**
 * POST /api/pricing/:model/confirm
 * Validates pricing confirmation request (optional prices)
 */
export const confirmPricingValidator = [
  param('model')
    .trim()
    .notEmpty()
    .withMessage('Model is required')
    .isLength({ max: 100 })
    .withMessage('Model name must be 100 characters or less')
    .escape(),
  body('inputPrice')
    .optional()
    .isFloat({ min: 0, max: 1000 })
    .withMessage('Input price must be a number between 0 and 1000'),
  body('outputPrice')
    .optional()
    .isFloat({ min: 0, max: 1000 })
    .withMessage('Output price must be a number between 0 and 1000')
];

/**
 * POST /api/recommend
 * Validates model recommendation request
 */
export const recommendValidator = [
  body('taskDescription')
    .trim()
    .notEmpty()
    .withMessage('taskDescription is required')
    .isLength({ min: 3, max: 2000 })
    .withMessage('taskDescription must be between 3 and 2000 characters')
    .escape(),

  body('constraints')
    .optional()
    .custom((value) => {
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('constraints must be an object');
      }
      return true;
    }),

  body('constraints.maxCost')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('constraints.maxCost must be a non-negative number'),

  body('constraints.minSafety')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('constraints.minSafety must be a number between 0 and 100'),

  body('constraints.preferredModels')
    .optional()
    .isArray()
    .withMessage('constraints.preferredModels must be an array'),

  body('constraints.avoidModels')
    .optional()
    .isArray()
    .withMessage('constraints.avoidModels must be an array')
];

/**
 * GET /api/usage/summary
 * Validates query parameters for summary endpoint
 */
export const getSummaryValidator = [
  query('period')
    .optional()
    .trim()
    .isIn(['day', 'week', 'month'])
    .withMessage('period must be one of: day, week, month')
];

/**
 * GET /api/usage/history
 * Validates query parameters for history endpoint
 */
export const getHistoryValidator = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be an integer between 1 and 500')
    .toInt(),

  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('offset must be a non-negative integer')
    .toInt()
];

/**
 * GET /api/analysis/models
 * Validates query parameters for model analysis endpoint
 */
export const getModelAnalysisValidator = [
  query('period')
    .optional()
    .trim()
    .isIn(['day', 'week', 'month'])
    .withMessage('period must be one of: day, week, month')
];

/**
 * GET /api/analysis/opportunities
 * Validates query parameters for optimization opportunities endpoint
 */
export const getOptimizationOpportunitiesValidator = [
  query('period')
    .optional()
    .trim()
    .isIn(['day', 'week', 'month'])
    .withMessage('period must be one of: day, week, month')
];
