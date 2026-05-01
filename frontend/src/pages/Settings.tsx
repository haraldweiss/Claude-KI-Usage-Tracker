import React, { useState, useEffect } from 'react';
import { getPricing, getPlanPricing } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import AccountSection from '../components/settings/AccountSection';
import ApiTokenSection from '../components/settings/ApiTokenSection';
import PlanPricingTable from '../components/PlanPricingTable';
import PricingTable from '../components/PricingTable';
import type { PricingData, PlanPricingRow } from '../types/api';
import AdminUsersSection from '../components/settings/AdminUsersSection';
import AdminStatsSection from '../components/settings/AdminStatsSection';

export default function Settings(): React.ReactElement {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

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
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      <AccountSection />
      <ApiTokenSection />

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
          <PlanPricingTable plans={plans} onUpdate={loadPricing} readOnly={!isAdmin} />
        )}
      </div>

      {/* Model pricing section */}
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
            <PricingTable pricing={pricing} onUpdate={loadPricing} readOnly={!isAdmin} />
          </>
        )}
      </div>

      {isAdmin && <AdminUsersSection />}
      {isAdmin && <AdminStatsSection />}
    </div>
  );
}
