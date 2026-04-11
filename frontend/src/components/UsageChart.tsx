import React from 'react';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { UsageChartProps } from '../types/components';

const COLORS: string[] = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function UsageChart(props: UsageChartProps): React.ReactElement {
  const { modelData } = props;

  if (!modelData || modelData.length === 0) {
    return <div className="text-center py-8 text-gray-500">No data available</div>;
  }

  const data = modelData.map((model) => ({
    name: model.model,
    value: model.total_tokens,
  }));

  return (
    <div className="bg-white rounded-lg shadow p-6 h-80">
      <h3 className="text-lg font-semibold mb-4 text-gray-900">Usage by Model</h3>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => (typeof value === 'number' ? value.toLocaleString() : value)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
