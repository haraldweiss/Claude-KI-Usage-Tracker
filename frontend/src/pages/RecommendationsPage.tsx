import React, { useState, useEffect } from 'react';
import ModelSuggester from '../components/ModelSuggester';
import OpportunitiesCard from '../components/OpportunitiesCard';
import OpportunitiesTable from '../components/OpportunitiesTable';
import { getOptimizationOpportunities } from '../services/api';
import { Period } from '../types/api';

interface OpportunitiesResponse {
  success?: boolean;
  error?: string;
  opportunities?: Array<Record<string, unknown>>;
  total_potential_savings?: number;
  period?: string;
  [key: string]: unknown;
}

export default function RecommendationsPage(): React.ReactElement {
  const [opportunities, setOpportunities] = useState<OpportunitiesResponse | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOpportunities();
  }, [period]);

  const loadOpportunities = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await getOptimizationOpportunities(period);
      if (response && 'success' in response && response.success) {
        setOpportunities(response as OpportunitiesResponse);
      } else if (response && 'error' in response) {
        setError(response.error || 'Failed to load opportunities');
      } else {
        setOpportunities(response as OpportunitiesResponse);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-8 rounded-lg shadow-lg">
        <h1 className="text-3xl font-bold mb-2">🎯 Smart Model Recommendations</h1>
        <p className="text-blue-100">
          Get intelligent recommendations for which Claude model to use based on your task complexity,
          safety requirements, and budget. Save money while maintaining quality.
        </p>
      </div>

      {/* Model Suggester Section */}
      <div>
        <ModelSuggester />
      </div>

      {/* Separator */}
      <div className="border-t-2 border-slate-200 my-4" />

      {/* Optimization Opportunities Section */}
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <h2 className="text-2xl font-bold text-slate-800">
            📊 Optimization Opportunities
          </h2>

          {/* Period Selector */}
          <div className="flex gap-2">
            {(['day', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  period === p
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                }`}
              >
                {p === 'day' ? '24h' : p === 'week' ? '7d' : '30d'}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
            <p className="mt-4 text-slate-600">Loading opportunities...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="p-6 bg-red-50 border-l-4 border-red-500 rounded-lg">
            <p className="text-red-800 font-semibold">⚠️ Error loading opportunities</p>
            <p className="text-red-700 text-sm mt-2">{error}</p>
          </div>
        )}

        {/* Opportunities Display */}
        {!loading && !error && opportunities && (
          <div className="space-y-6">
            {/* Summary Card */}
            <OpportunitiesCard opportunities={opportunities as unknown as Record<string, unknown>} period={period} />

            {/* Details Table */}
            <OpportunitiesTable opportunities={opportunities as unknown as Record<string, unknown>} />
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && !opportunities && (
          <div className="text-center py-12 text-slate-500">
            <p>💡 Data loading... Check back after using Claude on claude.ai</p>
          </div>
        )}
      </div>

      {/* Info Footer */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-lg">
        <h3 className="font-semibold text-slate-800 mb-2">💡 How it works</h3>
        <ul className="text-sm text-slate-700 space-y-2">
          <li>✓ Our AI analyzes your task descriptions to estimate complexity</li>
          <li>✓ We compare safety scores, costs, and model capabilities</li>
          <li>✓ We identify where you could save money without sacrificing quality</li>
          <li>✓ All recommendations respect safety constraints and breaking-error prevention</li>
        </ul>
      </div>
    </div>
  );
}
