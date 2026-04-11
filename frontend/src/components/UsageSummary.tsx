import React from 'react';
import { formatCost, formatTokens } from '../services/priceService';
import { UsageSummaryProps } from '../types/components';

export default function UsageSummary(props: UsageSummaryProps): React.ReactElement {
  const { stats } = props;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-sm font-medium">Total Tokens</p>
        <p className="text-3xl font-bold text-blue-600 mt-2">
          {formatTokens(stats?.total_tokens || 0)}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-sm font-medium">Input Tokens</p>
        <p className="text-3xl font-bold text-green-600 mt-2">
          {formatTokens(stats?.total_input_tokens || 0)}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-sm font-medium">Output Tokens</p>
        <p className="text-3xl font-bold text-purple-600 mt-2">
          {formatTokens(stats?.total_output_tokens || 0)}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-sm font-medium">Estimated Cost</p>
        <p className="text-3xl font-bold text-orange-600 mt-2">
          {formatCost(stats?.total_cost || 0)}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 text-sm font-medium">Requests</p>
        <p className="text-3xl font-bold text-gray-700 mt-2">
          {stats?.request_count || 0}
        </p>
      </div>
    </div>
  );
}
