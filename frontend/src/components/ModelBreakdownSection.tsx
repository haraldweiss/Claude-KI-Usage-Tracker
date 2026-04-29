import React from 'react';
import { ModelBreakdown } from '../types/api';

interface ModelBreakdownSectionProps {
  models: ModelBreakdown[];
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'k';
  }
  return tokens.toString();
}

export default function ModelBreakdownSection({ models }: ModelBreakdownSectionProps): React.ReactElement {
  if (!models || models.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <p className="text-gray-500">No model data available</p>
      </div>
    );
  }

  const totalRequests = models.reduce((sum, m) => sum + (m.request_count || 0), 0);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4 text-gray-900">Model Breakdown</h2>
      <div className="space-y-4">
        {models.map((model, idx) => {
          const percentage = totalRequests > 0 ? ((model.request_count || 0) / totalRequests) * 100 : 0;

          return (
            <div key={idx} className="flex items-center justify-between pb-4 border-b last:border-b-0">
              <div className="flex-1">
                <p className="font-medium text-gray-900">{model.model}</p>
                <p className="text-sm text-gray-600">
                  {formatTokens(model.input_tokens)} in · {formatTokens(model.output_tokens)} out
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">{percentage.toFixed(1)}%</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
