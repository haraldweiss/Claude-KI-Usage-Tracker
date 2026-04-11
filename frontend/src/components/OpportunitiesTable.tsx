import React, { useState } from 'react';
import { OpportunitiesTableProps } from '../types/components';

interface Opportunity {
  taskType: string;
  usedModel: string;
  recommendedModel: string;
  count: number;
  potentialSavings: string;
  riskScore: number;
}

type SortField = 'savings' | 'count';

export default function OpportunitiesTable(props: OpportunitiesTableProps): React.ReactElement {
  const { opportunities } = props;
  const [sortBy, setSortBy] = useState<SortField>('savings');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const opportunitiesData = (opportunities as unknown as { opportunities?: Opportunity[] })?.opportunities || [];

  if (!opportunitiesData || opportunitiesData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 border border-slate-200">
        <h3 className="text-xl font-bold text-slate-800 mb-4">📋 Optimization Details</h3>
        <div className="text-center py-12 text-slate-500">
          <p>✨ No optimization opportunities found yet</p>
          <p className="text-sm mt-2">Start using Claude and we'll identify patterns where you can save!</p>
        </div>
      </div>
    );
  }

  const getRiskColor = (score: number): string => {
    if (score < 0.1) return 'bg-green-50 text-green-800 border-green-200';
    if (score < 0.2) return 'bg-yellow-50 text-yellow-800 border-yellow-200';
    return 'bg-orange-50 text-orange-800 border-orange-200';
  };

  const getSavingsColor = (savingsStr: string): string => {
    const savings = parseFloat(savingsStr);
    if (savings >= 80) return 'text-green-600 font-bold';
    if (savings >= 60) return 'text-green-600';
    return 'text-slate-600';
  };

  let sortedOpportunities = [...opportunitiesData];
  sortedOpportunities.sort((a, b) => {
    let aVal: number;
    let bVal: number;
    if (sortBy === 'savings') {
      aVal = parseFloat(a.potentialSavings);
      bVal = parseFloat(b.potentialSavings);
    } else {
      aVal = a.count;
      bVal = b.count;
    }
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const handleSort = (field: SortField): void => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-slate-200">
      <h3 className="text-xl font-bold text-slate-800 mb-4">📋 Optimization Details</h3>

      {/* Table Header Info */}
      <div className="text-sm text-slate-600 mb-4">
        Found <span className="font-semibold text-slate-800">{sortedOpportunities.length}</span> optimization
        {sortedOpportunities.length === 1 ? ' opportunity' : ' opportunities'}
      </div>

      {/* Responsive Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-slate-300 bg-slate-50">
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-800">Task Type</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-800">Actually Used</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-800">Recommended</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-slate-800">Count</th>
              <th
                className="px-4 py-3 text-left text-sm font-semibold text-slate-800 cursor-pointer hover:bg-slate-100"
                onClick={() => handleSort('savings')}
              >
                Savings {sortBy === 'savings' && (sortAsc ? '↑' : '↓')}
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-800">Risk</th>
            </tr>
          </thead>
          <tbody>
            {sortedOpportunities.map((opp, idx) => (
              <tr
                key={idx}
                className="border-b border-slate-200 hover:bg-slate-50 transition"
              >
                <td className="px-4 py-4 text-sm">
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">
                    {opp.taskType}
                  </span>
                </td>

                <td className="px-4 py-4 text-sm font-semibold text-red-600">
                  {opp.usedModel}
                </td>

                <td className="px-4 py-4 text-sm font-semibold text-green-600">
                  {opp.recommendedModel}
                </td>

                <td className="px-4 py-4 text-sm text-center">
                  <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 rounded font-semibold">
                    {opp.count}x
                  </span>
                </td>

                <td className={`px-4 py-4 text-sm font-bold ${getSavingsColor(opp.potentialSavings)}`}>
                  {opp.potentialSavings}
                </td>

                <td className="px-4 py-4 text-sm">
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${getRiskColor(
                      opp.riskScore
                    )}`}
                  >
                    {opp.riskScore < 0.1 ? '✅ Low' : opp.riskScore < 0.2 ? '⚠️ Medium' : '❌ High'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary Stats */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg">
          <p className="text-sm text-slate-600 mb-1">Biggest Opportunity</p>
          <p className="text-2xl font-bold text-green-600">
            {sortedOpportunities[0]?.potentialSavings}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {sortedOpportunities[0]?.usedModel} → {sortedOpportunities[0]?.recommendedModel}
          </p>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg">
          <p className="text-sm text-slate-600 mb-1">Total Occurrences</p>
          <p className="text-2xl font-bold text-blue-600">
            {sortedOpportunities.reduce((sum, opp) => sum + opp.count, 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">tasks analyzed</p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg">
          <p className="text-sm text-slate-600 mb-1">Avg. Risk Level</p>
          <p className="text-2xl font-bold text-purple-600">
            {sortedOpportunities.length > 0
              ? (
                  sortedOpportunities.reduce((sum, opp) => sum + (opp.riskScore || 0), 0) /
                  sortedOpportunities.length
                ).toFixed(2)
              : '0.00'}
          </p>
          <p className="text-xs text-slate-500 mt-1">0 = safe, 1 = risky</p>
        </div>
      </div>
    </div>
  );
}
