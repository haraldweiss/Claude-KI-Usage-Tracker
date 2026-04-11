import { getQuery, allQuery, runQuery } from '../database/sqlite.js';

// Anthropic's default pricing (can be updated manually in settings)
const DEFAULT_PRICING = {
  'Claude 3.5 Sonnet': { input: 3, output: 15 },
  'Claude 3.5 Haiku': { input: 0.8, output: 4 },
  'Claude 3 Opus': { input: 15, output: 75 }
};

/**
 * Validate pricing object for XSS/injection attacks
 * @param {Object} pricing - Pricing object with model, inputPrice, outputPrice
 * @returns {boolean} True if pricing is valid
 * @throws {Error} If pricing contains invalid data
 */
export function validatePricing(pricing) {
  if (!pricing || typeof pricing !== 'object') {
    throw new Error('Pricing must be an object');
  }

  const { model, inputPrice, outputPrice } = pricing;

  // Validate model name
  if (!model || typeof model !== 'string') {
    throw new Error('Model must be a non-empty string');
  }

  // Check for XSS/injection attempts in model name
  const dangerousPatterns = ['<', '>', '"', '\'', '&', ';', '\\', '/*', '*/'];
  if (dangerousPatterns.some(pattern => model.includes(pattern))) {
    throw new Error('Model name contains invalid characters');
  }

  // Validate input price
  if (typeof inputPrice !== 'number' || inputPrice < 0) {
    throw new Error('Input price must be a non-negative number');
  }

  // Validate output price
  if (typeof outputPrice !== 'number' || outputPrice < 0) {
    throw new Error('Output price must be a non-negative number');
  }

  // Check for unreasonable values (sanity check)
  if (inputPrice > 1000 || outputPrice > 1000) {
    throw new Error('Price values seem unreasonably high (max 1000)');
  }

  return true;
}

/**
 * Format pricing response for API
 * @param {Array} pricingRecords - Raw pricing records from database
 * @returns {Object} Formatted pricing response
 */
export function formatPricingResponse(pricingRecords) {
  if (!Array.isArray(pricingRecords)) {
    throw new Error('Pricing records must be an array');
  }

  const formatted = {};

  for (const record of pricingRecords) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    const { model, input_price, output_price, source, last_updated } = record;

    if (!model) {
      continue;
    }

    formatted[model] = {
      inputPrice: parseFloat(input_price) || 0,
      outputPrice: parseFloat(output_price) || 0,
      source: source || 'unknown',
      lastUpdated: last_updated || null
    };
  }

  return formatted;
}

/**
 * Fetch latest pricing from Anthropic
 * This is a placeholder - actual implementation would fetch from:
 * - Anthropic's API (if available)
 * - Anthropic's pricing page (via scraping)
 * - A public pricing endpoint
 */
export async function fetchLatestPricing() {
  try {
    console.log('Fetching latest pricing from Anthropic...');

    // For now, return the hardcoded pricing
    // In production, this could fetch from:
    // 1. Anthropic API endpoint (if they provide one)
    // 2. Web scrape from https://www.anthropic.com/pricing
    // 3. A JSON file from Anthropic's CDN

    return DEFAULT_PRICING;
  } catch (error) {
    console.error('Error fetching latest pricing:', error);
    return null;
  }
}

/**
 * Update pricing in database
 */
export async function updatePricingInDB(model, inputPrice, outputPrice) {
  try {
    const existing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);

    if (existing) {
      await runQuery(
        'UPDATE pricing SET input_price = ?, output_price = ?, source = ?, last_updated = CURRENT_TIMESTAMP WHERE model = ?',
        [inputPrice, outputPrice, 'manual', model]
      );
    } else {
      await runQuery(
        'INSERT INTO pricing (model, input_price, output_price, source) VALUES (?, ?, ?, ?)',
        [model, inputPrice, outputPrice, 'manual']
      );
    }

    console.log(`Updated pricing for ${model}`);
    return true;
  } catch (error) {
    console.error('Error updating pricing:', error);
    return false;
  }
}

/**
 * Check and update pricing if changed
 */
export async function checkAndUpdatePricing() {
  try {
    const latestPricing = await fetchLatestPricing();
    if (!latestPricing) {
      console.log('Could not fetch latest pricing');
      return false;
    }

    let updated = false;

    for (const [model, prices] of Object.entries(latestPricing)) {
      const current = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);

      // Only update if prices changed and source is 'anthropic' (not manually edited)
      if (current && (current.input_price !== prices.input || current.output_price !== prices.output) && current.source === 'anthropic') {
        console.log(`Pricing changed for ${model}: ${current.input_price}/${current.output_price} -> ${prices.input}/${prices.output}`);
        await updatePricingInDB(model, prices.input, prices.output);
        updated = true;

        // Recalculate costs for recent records
        await recalculateCosts(model);
      }
    }

    return updated;
  } catch (error) {
    console.error('Error checking pricing:', error);
    return false;
  }
}

/**
 * Recalculate costs for a model's recent records
 */
export async function recalculateCosts(model) {
  try {
    const records = await allQuery(
      `SELECT id, input_tokens, output_tokens FROM usage_records
       WHERE model = ? AND datetime(timestamp) >= datetime('now', '-30 days')`,
      [model]
    );

    const pricing = await getQuery('SELECT * FROM pricing WHERE model = ?', [model]);

    if (pricing && records.length > 0) {
      for (const record of records) {
        const cost = (record.input_tokens * pricing.input_price + record.output_tokens * pricing.output_price) / 1000000;
        await runQuery('UPDATE usage_records SET cost = ? WHERE id = ?', [cost, record.id]);
      }
      console.log(`Recalculated costs for ${records.length} records of ${model}`);
    }
  } catch (error) {
    console.error('Error recalculating costs:', error);
  }
}

/**
 * Get all current pricing
 */
export async function getAllPricing() {
  try {
    return await allQuery('SELECT * FROM pricing ORDER BY model ASC');
  } catch (error) {
    console.error('Error getting pricing:', error);
    return [];
  }
}

/**
 * Schedule daily pricing check
 * This should be called on server startup
 */
export function schedulePricingCheck(cronJob) {
  try {
    // Run pricing check daily at 2 AM
    cronJob.schedule('0 2 * * *', async () => {
      console.log('Running scheduled pricing check...');
      const updated = await checkAndUpdatePricing();
      if (updated) {
        console.log('Pricing was updated');
      } else {
        console.log('No pricing changes detected');
      }
    });
    console.log('Pricing check scheduled for daily at 2 AM');
  } catch (error) {
    console.error('Error scheduling pricing check:', error);
  }
}
