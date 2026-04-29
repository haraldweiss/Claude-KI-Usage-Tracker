import React, { useState, useEffect } from 'react';
import { getModelBreakdown, getHistory } from '../services/api';
import DashboardTabs from '../components/DashboardTabs';
import PeriodFilter from '../components/PeriodFilter';
import OverviewTab from '../components/OverviewTab';
import ModelsTab from '../components/ModelsTab';
import CombinedCostTab from '../components/CombinedCostTab';
import { ModelBreakdown } from '../types/api';
import { BarChartData, PeriodType } from '../types/components';

type TabType = 'overview' | 'models' | 'combined';

export default function Dashboard(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [activePeriod, setActivePeriod] = useState<PeriodType>('all');
  const [modelData, setModelData] = useState<ModelBreakdown[]>([]);
  const [chartData, setChartData] = useState<BarChartData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async (): Promise<void> => {
    try {
      setLoading(true);
      const [breakdown, activityData] = await Promise.all([
        getModelBreakdown(),
        getHistory(1000, 0)
      ]);

      setModelData(breakdown.models);

      // Transform history into chart data grouped by date
      const chartMap = new Map<string, number>();
      activityData.records.forEach((record) => {
        const date = new Date(record.timestamp).toLocaleDateString('de-DE', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const current = chartMap.get(date) || 0;
        chartMap.set(date, current + record.input_tokens + record.output_tokens);
      });

      const transformedChartData = Array.from(chartMap.entries())
        .map(([date, tokens]) => ({ date, tokens }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      setChartData(transformedChartData);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterChartDataByPeriod = (data: BarChartData[], period: PeriodType): BarChartData[] => {
    const now = new Date();
    let startDate = new Date();

    if (period === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === '30d') {
      startDate.setDate(now.getDate() - 30);
    }

    return data.filter(point => {
      const pointDate = new Date(point.date);
      return pointDate >= startDate;
    });
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

  const filteredChartData = filterChartDataByPeriod(chartData, activePeriod);

  return (
    <div className="space-y-6">
      {/* Tabs and Period Filter */}
      <div className="flex justify-between items-center">
        <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />
        <PeriodFilter activePeriod={activePeriod} onPeriodChange={setActivePeriod} />
      </div>

      {/* Content based on active tab */}
      {loading && activeTab !== 'combined' ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <OverviewTab chartData={filteredChartData} models={modelData} />
          )}
          {activeTab === 'models' && (
            <ModelsTab models={modelData} />
          )}
          {activeTab === 'combined' && <CombinedCostTab />}
        </>
      )}
    </div>
  );
}
