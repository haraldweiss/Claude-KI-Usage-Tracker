const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api`;

export async function getSummary(period = 'day') {
  const response = await fetch(`${API_BASE}/usage/summary?period=${period}`);
  if (!response.ok) throw new Error('Failed to fetch summary');
  return response.json();
}

export async function getModelBreakdown() {
  const response = await fetch(`${API_BASE}/usage/models`);
  if (!response.ok) throw new Error('Failed to fetch model breakdown');
  return response.json();
}

export async function getHistory(limit = 50, offset = 0) {
  const response = await fetch(`${API_BASE}/usage/history?limit=${limit}&offset=${offset}`);
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

export async function getPricing() {
  const response = await fetch(`${API_BASE}/pricing`);
  if (!response.ok) throw new Error('Failed to fetch pricing');
  return response.json();
}

export async function updatePricing(model, inputPrice, outputPrice) {
  const response = await fetch(`${API_BASE}/pricing/${encodeURIComponent(model)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_price: inputPrice,
      output_price: outputPrice
    })
  });
  if (!response.ok) throw new Error('Failed to update pricing');
  return response.json();
}

// Smart Model Recommendation endpoints

export async function recommendModel(taskDescription, constraints = {}) {
  const response = await fetch(`${API_BASE}/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskDescription,
      constraints
    })
  });
  if (!response.ok) throw new Error('Failed to get recommendation');
  return response.json();
}

export async function getModelAnalysis(period = 'month') {
  const response = await fetch(`${API_BASE}/recommend/analysis/models?period=${period}`);
  if (!response.ok) throw new Error('Failed to fetch model analysis');
  return response.json();
}

export async function getOptimizationOpportunities(period = 'month') {
  const response = await fetch(`${API_BASE}/recommend/analysis/opportunities?period=${period}`);
  if (!response.ok) throw new Error('Failed to fetch optimization opportunities');
  return response.json();
}
