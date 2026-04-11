import { formatCost, formatTokens } from '../services/priceService';

export default function ActivityTable({ records, loading }) {
  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading...</div>;
  }

  if (!records || records.length === 0) {
    return <div className="text-center py-8 text-gray-500">No activity yet</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Model</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Input</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Output</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Cost</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => (
            <tr key={record.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-sm font-medium text-gray-900">{record.model}</td>
              <td className="px-6 py-4 text-sm text-gray-600">{formatTokens(record.input_tokens)}</td>
              <td className="px-6 py-4 text-sm text-gray-600">{formatTokens(record.output_tokens)}</td>
              <td className="px-6 py-4 text-sm font-medium text-orange-600">{formatCost(record.cost)}</td>
              <td className="px-6 py-4 text-sm text-gray-600">
                {new Date(record.timestamp).toLocaleTimeString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
