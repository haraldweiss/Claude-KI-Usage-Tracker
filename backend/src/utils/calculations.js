/**
 * Calculate cost from tokens and pricing
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {number} inputPrice - Input price per 1M tokens
 * @param {number} outputPrice - Output price per 1M tokens
 * @returns {number} Total cost in USD
 * @throws {Error} If tokens are negative
 */
export function calculateCost(inputTokens, outputTokens, inputPrice, outputPrice) {
  if (inputTokens < 0 || outputTokens < 0) {
    throw new Error('Tokens cannot be negative');
  }

  const inputCost = (inputTokens * inputPrice) / 1000000;
  const outputCost = (outputTokens * outputPrice) / 1000000;
  return inputCost + outputCost;
}

/**
 * Parse period string to number of days
 * @param {string} period - Period string: 'day', 'week', or 'month'
 * @returns {number} Number of days
 * @throws {Error} If period is invalid
 */
export function parsePeriodToDays(period) {
  const periodMap = {
    day: 1,
    week: 7,
    month: 30
  };

  if (!periodMap[period]) {
    throw new Error(`Invalid period: ${period}. Must be 'day', 'week', or 'month'.`);
  }

  return periodMap[period];
}
