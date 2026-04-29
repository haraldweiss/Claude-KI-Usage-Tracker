import React from 'react';
import { ModelBreakdown } from '../types/api';

interface ModelsTabProps {
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

function formatCost(cost: number | undefined | null): string {
  return `$${(cost ?? 0).toFixed(4)}`;
}

export default function ModelsTab({ models }: ModelsTabProps): React.ReactElement {
  if (!models || models.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-gray-500">No model data available</p>
      </div>
    );
  }

  return (
    <div className="py-6">
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Model</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Input Tokens</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Output Tokens</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Requests</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {models.map((model, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-900 font-medium">{model.model}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{formatTokens(model.input_tokens)}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{formatTokens(model.output_tokens)}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{model.request_count}</td>
                <td className="px-6 py-4 text-sm text-gray-900 font-medium">{formatCost(model.total_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
