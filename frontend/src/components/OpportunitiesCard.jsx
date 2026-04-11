export default function OpportunitiesCard({ opportunities, period }) {
  if (!opportunities) {
    return null;
  }

  const totalSavings = opportunities.totalPotentialSavings
    ? parseFloat(opportunities.totalPotentialSavings.replace('$', ''))
    : 0;
  const savingsPercent = opportunities.savingsPercent
    ? parseFloat(opportunities.savingsPercent.replace('%', ''))
    : 0;
  const opportunitiesCount = opportunities.opportunities ? opportunities.opportunities.length : 0;

  // Parse cost values safely (guard against missing fields / NaN / zero divisor)
  const currentTotalCostNum = opportunities.currentTotalCost
    ? parseFloat(String(opportunities.currentTotalCost).replace('$', ''))
    : 0;
  const potentialTotalCostNum = opportunities.potentialTotalCost
    ? parseFloat(String(opportunities.potentialTotalCost).replace('$', ''))
    : 0;
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
          <p className="text-3xl font-bold text-green-600">{opportunities.totalPotentialSavings}</p>
          <p className="text-xs text-slate-500 mt-2">
            by optimizing model selection
          </p>
        </div>

        {/* Savings Percentage */}
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-slate-600 mb-2">Average Savings</p>
          <p className="text-3xl font-bold text-green-600">{opportunities.savingsPercent}</p>
          <p className="text-xs text-slate-500 mt-2">
            of current spending
          </p>
        </div>

        {/* Opportunities Found */}
        <div className="bg-white rounded-lg p-4 shadow">
          <p className="text-sm text-slate-600 mb-2">Opportunities Found</p>
          <p className="text-3xl font-bold text-blue-600">{opportunitiesCount}</p>
          <p className="text-xs text-slate-500 mt-2">
            different optimization patterns
          </p>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="mt-6 p-4 bg-white rounded-lg">
        <h4 className="font-semibold text-slate-800 mb-3">Spending Analysis</h4>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-600">Current Total Cost</span>
              <span className="font-bold text-slate-800">{opportunities.currentTotalCost}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div className="h-full bg-red-500 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-slate-600">Optimized Cost</span>
              <span className="font-bold text-slate-800">{opportunities.potentialTotalCost}</span>
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
        📊 Analysis based on {opportunities.recordsAnalyzed} usage records
      </div>
    </div>
  );
}
