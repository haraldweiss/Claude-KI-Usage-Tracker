import React, { useState, useEffect } from 'react';
import { getPricing } from '../services/api';
import PricingTable from '../components/PricingTable';
import { PricingData } from '../types/api';

export default function Settings(): React.ReactElement {
  const [pricing, setPricing] = useState<PricingData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async (): Promise<void> => {
    try {
      setLoading(true);
      const data = await getPricing();
      setPricing(data.pricing || []);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error loading pricing:', err);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-semibold">Error loading settings:</p>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600">Manage pricing and configure the tracker</p>
      </div>

      {/* Pricing section */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Model Pricing</h2>
            <p className="text-gray-600 text-sm mt-1">
              Prices are in dollars per 1 million tokens. Edit to customize pricing.
            </p>
          </div>
          <button
            onClick={loadPricing}
            className="px-4 py-2 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            🔄 Reload
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading pricing...</div>
        ) : (
          <>
            {pricing.some((p) => p.status === 'pending_confirmation') && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-900">
                <strong>New models detected.</strong> Review and confirm pricing for the rows marked
                <em> Needs review</em> below.
              </div>
            )}
            <PricingTable pricing={pricing} onUpdate={loadPricing} />
          </>
        )}
      </div>

      {/* Information section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">About Pricing</h3>
        <ul className="text-blue-800 space-y-2 text-sm">
          <li>• Prices are fetched from Anthropic's official pricing page</li>
          <li>• You can manually override prices by clicking "Edit"</li>
          <li>• Changes will be applied to all future calculations</li>
          <li>• The system checks for pricing updates automatically</li>
        </ul>
      </div>

      {/* API Configuration section */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">API Configuration</h3>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Backend API</label>
            <p className="text-gray-600 mt-1">http://localhost:3000</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Status</label>
            <p className="text-green-600 mt-1 flex items-center gap-2">
              <span className="w-2 h-2 bg-green-600 rounded-full"></span>
              Connected
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
