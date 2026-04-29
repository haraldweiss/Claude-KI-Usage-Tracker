import React from 'react';
import BarChart from './BarChart';
import ModelBreakdownSection from './ModelBreakdownSection';
import { ModelBreakdown } from '../types/api';
import { BarChartData } from '../types/components';

interface OverviewTabProps {
  chartData: BarChartData[];
  models: ModelBreakdown[];
}

export default function OverviewTab({ chartData, models }: OverviewTabProps): React.ReactElement {
  return (
    <div className="space-y-6 py-6">
      <div>
        <BarChart data={chartData} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ModelBreakdownSection models={models} />
        </div>
      </div>
    </div>
  );
}
