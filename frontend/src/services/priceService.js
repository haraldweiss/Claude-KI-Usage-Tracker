export function calculateCost(inputTokens, outputTokens, inputPrice, outputPrice) {
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1000000;
}

export function formatCost(cost) {
  if (cost === null || cost === undefined) return '$0.0000';
  return '$' + cost.toFixed(4);
}

export function formatTokens(tokens) {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  } else if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'K';
  }
  return tokens.toString();
}
