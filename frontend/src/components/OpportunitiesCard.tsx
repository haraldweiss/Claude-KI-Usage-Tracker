import React from 'react';
import { OpportunitiesCardProps } from '../types/components';

interface OpportunitiesResponse {
  totalPotentialSavings?: string;
  savingsPercent?: string;
  currentTotalCost?: string;
  potentialTotalCost?: string;
  recordsAnalyzed?: number;
  opportunities?: Array<Record<string, unknown>>;
}

export default function OpportunitiesCard(props: OpportunitiesCardProps): React.ReactElement | null {
  const { opportunities, period } = props;

  if (!opportunities) {
    return null;
  }

  const opp = opportunities as unknown as OpportunitiesResponse;
  const opportunitiesCount = opp.opportunities ? opp.opportunities.length : 0;

  const currentTotalCostNum = opp.currentTotalCost ? parseFloat(String(opp.currentTotalCost).replace('$', '')) : 0;
  const potentialTotalCostNum = opp.potentialTotalCost ? parseFloat(String(opp.potentialTotalCost).replace('$', '')) : 0;
  const optimizedWidthPercent =
    currentTotalCostNum > 0 && Number.isFinite(potentialTotalCostNum)
      ? Math.max(0, Math.min(100, (potentialTotalCostNum / currentTotalCostNum) * 100))
      : 0;

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg shadow-md p-6 border-2 border-green-300">
      <h3 className="text-2xl font-bold text-slate-800 mb-2">💰 Cost Optimization Potential</h3>
      <p className="text-slate-600 mb-6 text-sm">
        Last {period === 'day' ? '24 hours' : period === 'week' ? '7 days' : '30 days'}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {/* Total Savings */}
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-slate-600 mb-2">Total Potential Savings</p>
          <p className="text-3xl font-bold text-green-600">{opp.totalPotentialSavings}</p>
          <p className="text-xs text-slate-500 mt-2">by optimizing model selection</p>
        </div>

        {/* Savings Percentage */}
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-slate-600 mb-2">Average Savings</p>
          <p className="text-3xl font-bold text-green-600">{opp.savingsPercent}</p>
          <p className="text-xs text-slate-500 mt-2">of current spending</p>
        </div>

        {/* Opportunities Found */}
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-slate-600 mb-2">Opportunities Found</p>
          <p className="text-3xl font-bold text-blue-600">{opportunitiesCount}</p>
          <p className="text-xs text-slate-500 mt-2">different optimization patterns</p>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="mt-6 p-4 bg-white rounded-lg">
        <h4 className="font-semibold text-slate-800 mb-3">Spending Analysis</h4>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-600">Current Total Cost</span>
              <span className="font-bold text-slate-800">{opp.currentTotalCost}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div className="h-full bg-red-500 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-600">Optimized Cost</span>
              <span className="font-bold text-slate-800">{opp.potentialTotalCost}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${optimizedWidthPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Records Analyzed */}
      <div className="mt-4 text-xs text-slate-500 bg-slate-100 p-3 rounded-lg">
        📊 Analysis based on {opp.recordsAnalyzed} usage records
      </div>
    </div>
  );
}
