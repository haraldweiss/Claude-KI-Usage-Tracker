import React, { useEffect, useState } from 'react';
import { getSummary, getConsoleKeys, getSpendingTotal, getPlanPricing } from '../services/api';
import {
  CombinedSpendBreakdown,
  ConsoleKeyRecord,
  PlanPricingRow,
  SpendingTotal
} from '../types/api';
import ApiKeysDetailTable from './ApiKeysDetailTable';

// Resolve a plan name to its monthly EUR price using the live plan_pricing
// table from the backend (editable in Settings). Falls back to 0 if the plan
// isn't in the table — better to underreport than to fabricate a number.
function subscriptionEur(
  plans: PlanPricingRow[],
  planName: string | null | undefined
): number {
  if (!planName) return 0;
  return plans.find((p) => p.plan_name === planName)?.monthly_eur ?? 0;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return iso;
  const diffMin = Math.round((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  return new Date(iso).toLocaleString('de-DE');
}

export default function CombinedCostTab(): React.ReactElement {
  const [combined, setCombined] = useState<CombinedSpendBreakdown | null>(null);
  const [keys, setKeys] = useState<ConsoleKeyRecord[]>([]);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [allTime, setAllTime] = useState<SpendingTotal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [summary, consoleKeys, planRes, total] = await Promise.all([
          getSummary('month'),
          getConsoleKeys(),
          getPlanPricing(),
          getSpendingTotal()
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        setKeys(consoleKeys.keys);
        setPlans(planRes.plans);
        setAllTime(total);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Lade Kostendaten…</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Fehler: {error}
      </div>
    );
  }

  const claudeAi = combined?.claude_ai ?? null;
  const apiTotal = combined?.anthropic_api?.cost_usd ?? 0;
  const apiByWorkspace = combined?.anthropic_api?.by_workspace ?? [];
  const additionalUsageEur = claudeAi?.cost_eur ?? 0;
  const planSubscriptionEur = subscriptionEur(plans, claudeAi?.meta?.plan_name);
  const claudeAiTotalEur = planSubscriptionEur + additionalUsageEur;

  const noData = !claudeAi && apiTotal === 0;

  return (
    <div className="space-y-6 py-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
          Gesamtkosten diesen Monat
        </h2>
        <div className="mt-2 flex items-baseline gap-3 flex-wrap">
          <span className="text-3xl font-bold text-gray-900">
            {formatEur(claudeAiTotalEur)}
          </span>
          <span className="text-gray-400">+</span>
          <span className="text-3xl font-bold text-gray-900">
            {formatUsd(apiTotal)}
          </span>
        </div>
        {planSubscriptionEur > 0 && (
          <p className="mt-2 text-sm text-gray-600">
            Plan-Abo {formatEur(planSubscriptionEur)} + Zusatznutzung {formatEur(additionalUsageEur)}{' '}
            + Anthropic API {formatUsd(apiTotal)}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          claude.ai Subscription + Anthropic API. Beträge in unterschiedlichen Währungen, keine
          Umrechnung.
        </p>
        {noData && (
          <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Noch keine Sync-Daten. Die Extension synchronisiert claude.ai alle 10 Min und die
            Anthropic Console alle 24h.
          </p>
        )}
      </div>

      {allTime && allTime.since && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
            Insgesamt seit Tracking-Start
          </h2>
          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-bold text-gray-900">
              {formatEur(allTime.claude_ai.total_eur)}
            </span>
            <span className="text-gray-400">+</span>
            <span className="text-2xl font-bold text-gray-900">
              {formatUsd(allTime.anthropic_api.total_usd)}
            </span>
            <span className="text-sm text-gray-500">seit {allTime.since}</span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Plan-Abos {formatEur(allTime.claude_ai.subscription_eur)} + Zusatznutzung{' '}
            {formatEur(allTime.claude_ai.additional_eur)} + Anthropic API{' '}
            {formatUsd(allTime.anthropic_api.total_usd)}
          </p>
          {allTime.claude_ai.months.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-blue-600 hover:underline">
                Monatliche Aufschlüsselung ({allTime.claude_ai.months.length}{' '}
                {allTime.claude_ai.months.length === 1 ? 'Monat' : 'Monate'})
              </summary>
              <table className="w-full mt-3 text-sm">
                <thead className="text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left py-1">Monat</th>
                    <th className="text-left py-1">Plan</th>
                    <th className="text-right py-1">Plan-Abo</th>
                    <th className="text-right py-1">Zusatz</th>
                    <th className="text-right py-1">Gesamt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allTime.claude_ai.months.map((m) => (
                    <tr key={m.month}>
                      <td className="py-2 font-mono text-xs">{m.month}</td>
                      <td className="py-2">{m.plan_name ?? '—'}</td>
                      <td className="py-2 text-right">{formatEur(m.subscription_eur)}</td>
                      <td className="py-2 text-right">{formatEur(m.additional_eur)}</td>
                      <td className="py-2 text-right font-medium">
                        {formatEur(m.total_eur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-gray-900">claude.ai</h3>
            {claudeAi?.meta?.plan_name && (
              <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
                {claudeAi.meta.plan_name}
              </span>
            )}
          </div>
          {claudeAi ? (
            <>
              <p className="mt-3 text-2xl font-bold text-orange-600">
                {formatEur(claudeAiTotalEur)}
              </p>
              {planSubscriptionEur > 0 && (
                <p className="text-xs text-gray-500">
                  Plan {formatEur(planSubscriptionEur)} + Zusatz {formatEur(additionalUsageEur)}
                </p>
              )}
              <div className="mt-3 text-sm text-gray-700">
                <span>
                  Zusatznutzung: {formatEur(additionalUsageEur)}
                  {claudeAi.meta?.monthly_limit_eur != null && (
                    <span className="text-gray-500">
                      {' '}/ {formatEur(claudeAi.meta.monthly_limit_eur)}
                    </span>
                  )}
                  {claudeAi.meta?.spent_pct != null && (
                    <span className="text-gray-500">
                      {' '}({claudeAi.meta.spent_pct}%)
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {claudeAi.meta?.weekly_all_models_pct != null ? (
                  <div>
                    <div className="text-gray-500">Woche – alle Modelle</div>
                    <div className="font-medium">{claudeAi.meta.weekly_all_models_pct}%</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-gray-500">Wöchentlich genutzt</div>
                    <div className="font-medium">{claudeAi.weekly_used_pct}%</div>
                  </div>
                )}
                {claudeAi.meta?.weekly_sonnet_pct != null && (
                  <div>
                    <div className="text-gray-500">Woche – nur Sonnet</div>
                    <div className="font-medium">{claudeAi.meta.weekly_sonnet_pct}%</div>
                  </div>
                )}
                {claudeAi.meta?.balance_eur != null && (
                  <div>
                    <div className="text-gray-500">Aktuelles Guthaben</div>
                    <div className="font-medium">{formatEur(claudeAi.meta.balance_eur)}</div>
                  </div>
                )}
                {claudeAi.meta?.session_pct != null && (
                  <div>
                    <div className="text-gray-500">Aktuelle Sitzung</div>
                    <div className="font-medium">{claudeAi.meta.session_pct}%</div>
                  </div>
                )}
              </div>

              <p className="mt-4 text-xs text-gray-500">
                Letzter Sync: {formatRelativeTime(claudeAi.last_synced)}
                {claudeAi.meta?.reset_date && (
                  <> · Reset: {claudeAi.meta.reset_date}</>
                )}
              </p>
            </>
          ) : (
            <p className="mt-3 text-gray-500">Noch keine Daten</p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Anthropic API</h3>
          <p className="mt-3 text-2xl font-bold text-blue-600">{formatUsd(apiTotal)}</p>
          {apiByWorkspace.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-gray-700">
              {apiByWorkspace.map((w) => (
                <li key={w.workspace} className="flex justify-between">
                  <span>{w.workspace}</span>
                  <span className="font-medium">{formatUsd(w.cost_usd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-gray-500">Noch keine Daten</p>
          )}
        </div>
      </div>

      <ApiKeysDetailTable keys={keys} />
    </div>
  );
}
