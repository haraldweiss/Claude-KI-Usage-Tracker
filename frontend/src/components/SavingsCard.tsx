// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';

interface PerModel {
  model: string;
  cloudModel: string;
  cloudProvider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cloudCost: number;
  localCost: number;
  savings: number;
}

interface ProjectionTotal {
  calls: number;
  cloudCost: number;
  localCost: number;
  savings: number;
  savingsPercent: number;
}

interface Projections {
  monthly: number | null;
  annual: number | null;
}

interface ProjectionData {
  period: string;
  since: string;
  total: ProjectionTotal;
  projections: Projections;
  perModel: PerModel[];
}

const PERIOD_LABELS: Record<string, string> = {
  week: 'diese Woche',
  month: 'diesen Monat',
  year: 'dieses Jahr',
};

export default function SavingsCard(): React.ReactElement {
  const [data, setData] = useState<ProjectionData | null>(null);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/savings/projection?period=' + period, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow p-6">
        <div className="animate-pulse h-24 bg-gray-100 rounded" />
      </div>
    );
  }

  if (!data || data.total.calls === 0) {
    return (
      <div className="bg-white rounded-xl shadow p-6">
        <h3 className="text-lg font-bold mb-1">Ersparnis durch lokale LLMs</h3>
        <p className="text-gray-500 text-sm">Noch keine lokalen Nutzungsdaten fuer diesen Zeitraum.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-bold">Ersparnis durch lokale LLMs</h3>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
          className="text-sm border rounded px-2 py-1"
        >
          <option value="week">Woche</option>
          <option value="month">Monat</option>
          <option value="year">Jahr</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-green-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-700">{data.total.savings.toFixed(2)} EUR</div>
          <div className="text-xs text-green-600">gespart {PERIOD_LABELS[period]}</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-700">{data.projections.monthly ? data.projections.monthly.toFixed(2) + ' EUR' : '--'}</div>
          <div className="text-xs text-blue-600">Hochrechnung / Monat</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-purple-700">{data.projections.annual ? data.projections.annual.toFixed(2) + ' EUR' : '--'}</div>
          <div className="text-xs text-purple-600">Hochrechnung / Jahr</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{data.total.calls}</div>
          <div className="text-xs text-gray-600">lokale Anfragen</div>
        </div>
      </div>

      <details>
        <summary className="text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-800">
          Details pro Modell ({data.perModel.length})
        </summary>
        <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
          {data.perModel.map((m) => (
            <div key={m.model} className="flex justify-between text-xs py-1 border-b border-gray-100">
              <span className="font-mono text-gray-700 truncate max-w-[200px]" title={m.model}>
                {m.model.replace(':latest', '')}
              </span>
              <span className="text-gray-500">
                {m.calls}x | {m.cloudProvider} | {m.savings.toFixed(2)} EUR
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
