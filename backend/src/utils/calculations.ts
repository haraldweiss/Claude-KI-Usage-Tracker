/**
 * Calculate cost from tokens and pricing
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param inputPrice - Input price per 1M tokens
 * @param outputPrice - Output price per 1M tokens
 * @returns Total cost in USD
 * @throws Error if tokens are negative
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPrice: number,
  outputPrice: number
): number {
  if (inputTokens < 0 || outputTokens < 0) {
    throw new Error('Tokens cannot be negative');
  }

  const inputCost = (inputTokens * inputPrice) / 1000000;
  const outputCost = (outputTokens * outputPrice) / 1000000;
  return inputCost + outputCost;
}

/**
 * Parse period string to number of days
 * @param period - Period string: 'day', 'week', or 'month'
 * @returns Number of days
 * @throws Error if period is invalid
 */
export function parsePeriodToDays(period: string): number {
  const periodMap: Record<string, number> = {
    day: 1,
    week: 7,
    month: 30
  };

  const days = periodMap[period];
  if (days === undefined) {
    throw new Error(`Invalid period: ${period}. Must be 'day', 'week', or 'month'.`);
  }

  return days;
}
