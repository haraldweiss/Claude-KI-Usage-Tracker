import React from 'react';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { BarChartProps } from '../types/components';

const CHART_COLOR = '#3b82f6'; // Blue-500 for consistency

export default function BarChart({ data, title = 'Token Usage Over Time' }: BarChartProps): React.ReactElement {
  // Validate data
  if (!data || data.length === 0 || data.some(d => typeof d.tokens !== 'number' || isNaN(d.tokens))) {
    return (
      <div
        data-testid="bar-chart-container"
        className="w-full h-96 bg-white rounded-lg shadow p-4 flex items-center justify-center"
        role="region"
        aria-label="Empty chart"
      >
        <p className="text-center text-gray-500">No valid data available</p>
      </div>
    );
  }

  return (
    <div
      data-testid="bar-chart-container"
      className="w-full bg-white rounded-lg shadow p-6"
      role="img"
      aria-label={title}
    >
      <h3 className="text-lg font-semibold mb-6 text-gray-900">{title}</h3>
      <ResponsiveContainer width="100%" height={350}>
        <RechartsBarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="date"
            angle={-45}
            textAnchor="end"
            height={100}
            tick={{ fontSize: 12, fill: '#6b7280' }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickFormatter={(value) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
              if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
              return value.toString();
            }}
          />
          <Tooltip
            formatter={(value) => {
              if (typeof value !== 'number') return '0';
              return value.toLocaleString();
            }}
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              padding: '8px'
            }}
            label={{ fontSize: 12 }}
          />
          <Bar
            dataKey="tokens"
            fill={CHART_COLOR}
            radius={[4, 4, 0, 0]}
            name="Tokens"
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
