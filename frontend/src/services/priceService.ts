/**
 * Price Calculation and Formatting Service
 * Utility functions for cost calculations and token/currency formatting
 */

/**
 * Calculate total cost from tokens and prices
 * @param inputTokens Number of input tokens
 * @param outputTokens Number of output tokens
 * @param inputPrice Price per million input tokens
 * @param outputPrice Price per million output tokens
 * @returns Total cost in USD
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  inputPrice: number,
  outputPrice: number
): number {
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1000000;
}

/**
 * Format cost value for display
 * @param cost Cost in USD
 * @returns Formatted cost string (e.g., "$1.2345")
 */
export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return '$0.0000';
  return '$' + cost.toFixed(4);
}

/**
 * Format token count for display
 * @param tokens Number of tokens
 * @returns Formatted token string (e.g., "1.2M", "500K", "123")
 */
export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return '0';
  
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  return tokens.toString();
}

/**
 * Format large numbers with comma separators
 * @param value Number to format
 * @returns Formatted number string (e.g., "1,234,567")
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return Math.floor(value).toLocaleString();
}

/**
 * Calculate percentage change between two values
 * @param oldValue Previous value
 * @param newValue Current value
 * @returns Percentage change (can be negative)
 */
export function calculatePercentageChange(
  oldValue: number,
  newValue: number
): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}
