import React, { useState } from 'react';
import { PlanPricingRow } from '../types/api';
import { updatePlanPricing } from '../services/api';

interface Props {
  plans: PlanPricingRow[];
  onUpdate: () => void;
  readOnly?: boolean;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function sourceBadge(source: PlanPricingRow['source']): React.ReactElement {
  const styles: Record<PlanPricingRow['source'], string> = {
    manual: 'bg-blue-100 text-blue-700',
    auto: 'bg-green-100 text-green-700',
    tier_default: 'bg-gray-100 text-gray-600'
  };
  const labels: Record<PlanPricingRow['source'], string> = {
    manual: 'manual',
    auto: 'auto',
    tier_default: 'default'
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[source]}`}>
      {labels[source]}
    </span>
  );
}

export default function PlanPricingTable({ plans, onUpdate, readOnly = false }: Props): React.ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const startEdit = (plan: PlanPricingRow): void => {
    setEditing(plan.plan_name);
    setDraft(String(plan.monthly_eur));
  };

  const cancelEdit = (): void => {
    setEditing(null);
    setDraft('');
  };

  const save = async (planName: string): Promise<void> => {
    const value = parseFloat(draft.replace(',', '.'));
    if (!isFinite(value) || value < 0) {
      // eslint-disable-next-line no-alert
      alert('Bitte einen positiven Eurobetrag eingeben');
      return;
    }
    try {
      setSaving(true);
      await updatePlanPricing(planName, value);
      setEditing(null);
      setDraft('');
      onUpdate();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('Speichern fehlgeschlagen: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  if (plans.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">Keine Plan-Preise gespeichert.</div>
    );
  }

  return (
    <table className="w-full">
      <thead className="bg-gray-50 border-b">
        <tr>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Plan</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Quelle</th>
          <th className="px-4 py-2 text-right text-xs font-medium text-gray-700 uppercase">
            Monatspreis
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">
            Geändert
          </th>
          <th className="px-4 py-2 text-right text-xs font-medium text-gray-700 uppercase">
            Aktion
          </th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {plans.map((plan) => (
          <tr key={plan.plan_name} className="hover:bg-gray-50">
            <td className="px-4 py-3 font-medium text-gray-900">{plan.plan_name}</td>
            <td className="px-4 py-3">{sourceBadge(plan.source)}</td>
            <td className="px-4 py-3 text-right">
              {editing === plan.plan_name && !readOnly ? (
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-24 border rounded px-2 py-1 text-right"
                  autoFocus
                />
              ) : (
                <span className="font-medium text-orange-600">{formatEur(plan.monthly_eur)}</span>
              )}
            </td>
            <td className="px-4 py-3 text-sm text-gray-500">
              {new Date(plan.last_updated).toLocaleDateString('de-DE')}
            </td>
            <td className="px-4 py-3 text-right">
              {editing === plan.plan_name && !readOnly ? (
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => save(plan.plan_name)}
                    disabled={saving}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '…' : 'Speichern'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Abbrechen
                  </button>
                </div>
              ) : (
                !readOnly && (
                  <button
                    onClick={() => startEdit(plan)}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Bearbeiten
                  </button>
                )
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
