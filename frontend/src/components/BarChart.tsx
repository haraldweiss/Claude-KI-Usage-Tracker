import React from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface BarChartData {
  date: string;
  tokens: number;
}

interface BarChartProps {
  data: BarChartData[];
}

export default function BarChart({ data }: BarChartProps): React.ReactElement {
  if (!data || data.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">No data available</div>
    );
  }

  return (
    <div
      data-testid="bar-chart-container"
      className="w-full h-96 bg-white rounded-lg shadow p-4"
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
          <YAxis />
          <Tooltip formatter={(value) => (value as number).toLocaleString()} />
          <Bar dataKey="tokens" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
