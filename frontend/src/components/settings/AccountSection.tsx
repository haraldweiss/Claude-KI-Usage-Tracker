import React, { useEffect, useState } from 'react';
import { getAccount, patchAccount, getPlanPricing } from '../../services/api';
import type { CurrentUser, PlanPricingRow } from '../../types/api';

export default function AccountSection(): React.ReactElement {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [planName, setPlanName] = useState('');
  const [limit, setLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getAccount().then((u) => {
      setMe(u);
      setDisplayName(u.display_name || '');
      setPlanName(u.plan_name || '');
      setLimit(u.monthly_limit_eur != null ? String(u.monthly_limit_eur) : '');
    });
    getPlanPricing().then((r) => setPlans(r.plans));
  }, []);

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      await patchAccount({
        display_name: displayName,
        plan_name: planName || null as unknown as string,
        monthly_limit_eur: limit === '' ? null as unknown as number : parseFloat(limit)
      });
      setStatus('Gespeichert ✓');
    } catch (e) {
      setStatus('Fehler: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!me) return <div className="text-gray-500">Lade…</div>;
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-gray-700">Email</label>
          <p className="mt-1 text-gray-900">{me.email}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Display-Name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Plan</label>
          <select value={planName} onChange={(e) => setPlanName(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded bg-white">
            <option value="">— kein Plan —</option>
            {plans.map((p) => <option key={p.plan_name} value={p.plan_name}>{p.plan_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Monatliches Limit (EUR)</label>
          <input type="number" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)}
            className="mt-1 w-full px-3 py-2 border rounded" placeholder="z.B. 50.00" />
        </div>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Speichern…' : 'Speichern'}
        </button>
        {status && <p className="text-sm text-gray-600">{status}</p>}
      </div>
    </div>
  );
}
