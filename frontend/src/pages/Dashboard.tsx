import React, { useState, useEffect } from 'react';
import { getModelBreakdown } from '../services/api';
import DashboardTabs from '../components/DashboardTabs';
import OverviewTab from '../components/OverviewTab';
import ModelsTab from '../components/ModelsTab';
import CombinedCostTab from '../components/CombinedCostTab';
import { ModelBreakdown } from '../types/api';

type TabType = 'overview' | 'models' | 'combined';

export default function Dashboard(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [modelData, setModelData] = useState<ModelBreakdown[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Models endpoint feeds the Models tab. Overview and Combined tabs are
    // self-loading, so the dashboard shell only fetches what the Models tab
    // needs.
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const breakdown = await getModelBreakdown();
        if (!cancelled) {
          setModelData(breakdown.models);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-semibold">Error loading data:</p>
        <p>{error}</p>
        <p className="text-sm mt-2">
          Backend nicht erreichbar. Lokal: <code>cd backend &amp;&amp; npm run dev</code> auf
          Port 3000 starten. Auf VPS: <code>systemctl status claudetracker-backend</code>{' '}
          prüfen.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'models' && <ModelsTab models={modelData} />}
      {activeTab === 'combined' && <CombinedCostTab />}
    </div>
  );
}
