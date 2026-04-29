import React, { useState, useEffect } from 'react';
import { getPricing, getPlanPricing } from '../services/api';
import PricingTable from '../components/PricingTable';
import PlanPricingTable from '../components/PlanPricingTable';
import { PricingData, PlanPricingRow } from '../types/api';

export default function Settings(): React.ReactElement {
  const [pricing, setPricing] = useState<PricingData[]>([]);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async (): Promise<void> => {
    try {
      setLoading(true);
      const [modelData, planData] = await Promise.all([getPricing(), getPlanPricing()]);
      setPricing(modelData.pricing || []);
      setPlans(planData.plans || []);
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

      {/* Plan subscription pricing section */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">claude.ai Plan-Abos</h2>
          <p className="text-gray-600 text-sm mt-1">
            Monatlicher Plan-Preis in EUR. Wird zu der Zusatznutzung addiert, um die echten
            monatlichen Gesamtkosten zu zeigen. Manuell editierte Werte überleben den täglichen
            Auto-Refresh.
          </p>
        </div>
        {loading ? (
          <div className="text-center py-6 text-gray-500">Lade Plan-Preise…</div>
        ) : (
          <PlanPricingTable plans={plans} onUpdate={loadPricing} />
        )}
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
          <li>• Prices sync daily from the LiteLLM community pricing index (covers all current Anthropic models)</li>
          <li>• When the extension reports a model that isn't priced yet, the system creates a tier-default placeholder; if it can't infer a tier, it shows <em>Needs review</em> — click "Confirm" to set the real price</li>
          <li>• You can manually override any price by clicking "Edit"; manual overrides are never auto-overwritten</li>
          <li>• Changes apply to all future calculations and trigger a recalculation of recent records</li>
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
