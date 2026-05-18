// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { getAccount, patchAccount, getPlanPricing, getPlanPending, getPlanHistory, postPlanSchedule, deletePlanSchedule } from '../../services/api';
import type { CurrentUser, PlanPricingRow, PendingPlanChange, PlanHistoryRow } from '../../types/api';

export default function AccountSection(): React.ReactElement {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [planName, setPlanName] = useState('');
  const [limit, setLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Task 14: pending plan change
  const [pending, setPending] = useState<PendingPlanChange | null>(null);

  // Task 15: schedule form
  const [schedPlan, setSchedPlan] = useState('');
  const [schedDate, setSchedDate] = useState('');
  const [schedNote, setSchedNote] = useState('');
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

  // Task 16: history
  const [history, setHistory] = useState<PlanHistoryRow[]>([]);

  useEffect(() => {
    getAccount().then((u) => {
      setMe(u);
      setDisplayName(u.display_name || '');
      setPlanName(u.plan_name || '');
      setLimit(u.monthly_limit_eur != null ? String(u.monthly_limit_eur) : '');
    });
    getPlanPricing().then((r) => setPlans(r.plans));
    getPlanPending().then(setPending).catch(console.error);
    getPlanHistory(5).then(setHistory).catch(console.error);
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

  // Task 14: cancel pending plan change
  async function handleCancelPending() {
    if (!pending) return;
    if (!confirm(`Plan-Wechsel am ${pending.effective_from} auf ${pending.plan_name} abbrechen?`)) return;
    try {
      await deletePlanSchedule();
      setPending(null);
      const freshHistory = await getPlanHistory(5);
      setHistory(freshHistory);
    } catch (err) {
      alert('Fehler: ' + (err as Error).message);
    }
  }

  // Task 15: submit schedule form
  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!schedPlan || !schedDate) return;
    try {
      await postPlanSchedule({
        plan_name: schedPlan,
        effective_from: schedDate,
        note: schedNote || undefined,
      });
      const fresh = await getPlanPending();
      setPending(fresh);
      const freshHistory = await getPlanHistory(5);
      setHistory(freshHistory);
      setSchedPlan(''); setSchedDate(''); setSchedNote('');
    } catch (err) {
      alert('Fehler: ' + (err as Error).message);
    }
  }

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

        {/* Task 14: Pending plan change banner */}
        {pending && (
          <div className="flex items-start justify-between gap-3 rounded border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="text-sm text-blue-800">
              <p className="font-medium">Geplanter Plan-Wechsel</p>
              <p className="mt-0.5">
                Am <span className="font-semibold">{pending.effective_from}</span> wechselst du zu{' '}
                <span className="font-semibold">{pending.plan_name}</span>.
              </p>
              {pending.note && (
                <p className="mt-0.5 text-blue-700 italic">{pending.note}</p>
              )}
            </div>
            <button
              onClick={handleCancelPending}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-blue-700 border border-blue-300 hover:bg-blue-100"
            >
              Abbrechen
            </button>
          </div>
        )}

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

        {/* Task 15: Schedule future plan change */}
        <details className="rounded border border-gray-200">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Plan-Wechsel vorplanen…
          </summary>
          <form onSubmit={handleSchedule} className="border-t border-gray-200 px-4 py-3 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Neuer Plan</label>
              <select
                value={schedPlan}
                onChange={(e) => setSchedPlan(e.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded bg-white"
                required
              >
                <option value="">— Plan wählen —</option>
                {plans.map((p) => (
                  <option key={p.plan_name} value={p.plan_name}>{p.plan_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Gültig ab</label>
              <input
                type="date"
                value={schedDate}
                min={tomorrow}
                onChange={(e) => setSchedDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Notiz (optional)</label>
              <input
                type="text"
                value={schedNote}
                onChange={(e) => setSchedNote(e.target.value)}
                className="mt-1 w-full px-3 py-2 border rounded"
                placeholder="z.B. Upgrade wegen neuem Projekt"
              />
            </div>
            <button
              type="submit"
              disabled={!schedPlan || !schedDate}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Plan-Wechsel einplanen
            </button>
          </form>
        </details>

        {/* Task 16: Plan change history */}
        <details className="rounded border border-gray-200">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Plan-Verlauf (letzte 5 Einträge)
          </summary>
          <div className="border-t border-gray-200 divide-y divide-gray-100">
            {history.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-500">Kein Verlauf vorhanden.</p>
            ) : (
              history.map((row) => (
                <div key={row.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium text-gray-900">{row.plan_name}</span>
                    <span className="ml-2 text-gray-500">ab {row.effective_from}</span>
                    {row.note && (
                      <span className="ml-2 text-gray-400 italic">{row.note}</span>
                    )}
                  </div>
                  <span className={`ml-3 shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                    row.source === 'scheduled'
                      ? 'bg-blue-100 text-blue-700'
                      : row.source === 'manual'
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {row.source}
                  </span>
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
