import React, { useState, useEffect } from 'react';
import { getSummary, getModelBreakdown, getHistory } from '../services/api';
import UsageSummary from '../components/UsageSummary';
import UsageChart from '../components/UsageChart';
import ActivityTable from '../components/ActivityTable';
import { Period, UsageSummaryData, ModelBreakdown, UsageHistoryRecord } from '../types/api';

export default function Dashboard(): React.ReactElement {
  const [stats, setStats] = useState<UsageSummaryData | null>(null);
  const [modelData, setModelData] = useState<ModelBreakdown[]>([]);
  const [history, setHistory] = useState<UsageHistoryRecord[]>([]);
  const [period, setPeriod] = useState<Period>('day');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // Refresh every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [period]);

  const loadData = async (): Promise<void> => {
    try {
      setLoading(true);
      const [summaryData, breakdown, activityData] = await Promise.all([
        getSummary(period),
        getModelBreakdown(),
        getHistory(50, 0)
      ]);

      setStats(summaryData);
      setModelData(breakdown.models);
      setHistory(activityData.records);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-semibold">Error loading data:</p>
        <p>{error}</p>
        <p className="text-sm mt-2">Make sure the backend server is running on port 3000</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex gap-2">
        {(['day', 'week', 'month'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              period === p
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        <button
          onClick={loadData}
          className="ml-auto px-4 py-2 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : (
        <>
          <UsageSummary stats={stats || undefined} />

          {/* Charts and activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <UsageChart modelData={modelData} />
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-900">Top Models</h3>
              <div className="space-y-3">
                {modelData.slice(0, 5).map((model, idx) => (
                  <div key={idx} className="flex justify-between items-center pb-3 border-b">
                    <div>
                      <p className="font-medium text-gray-900">{model.model}</p>
                      <p className="text-sm text-gray-600">{model.request_count} requests</p>
                    </div>
                    <p className="font-semibold text-blue-600">
                      {(model.total_tokens / 1000).toFixed(0)}K
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Activity table */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
            <ActivityTable records={history} loading={false} />
          </div>
        </>
      )}
    </div>
  );
}
