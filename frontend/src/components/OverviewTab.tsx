import React, { useEffect, useState } from 'react';
import { getSummary, getSpendingTotal, getPlanPricing } from '../services/api';
import { CombinedSpendBreakdown, PlanPricingRow, SpendingTotal } from '../types/api';

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
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

function subscriptionEur(plans: PlanPricingRow[], planName: string | null | undefined): number {
  if (!planName) return 0;
  return plans.find((p) => p.plan_name === planName)?.monthly_eur ?? 0;
}

/** Days remaining in the current month, including today. */
function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate() + 1);
}

function dayOfMonth(): number {
  return new Date().getDate();
}

interface ProgressProps {
  label: string;
  pct: number | null | undefined;
  hint?: string;
}

function ProgressRow({ label, pct, hint }: ProgressProps): React.ReactElement {
  const value = typeof pct === 'number' ? Math.max(0, Math.min(100, pct)) : null;
  const color =
    value === null ? 'bg-gray-200' : value < 50 ? 'bg-emerald-500' : value < 80 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="font-medium text-gray-900">{value === null ? '—' : `${value}%`}</span>
      </div>
      <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${value ?? 0}%` }} />
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export default function OverviewTab(): React.ReactElement {
  const [combined, setCombined] = useState<CombinedSpendBreakdown | null>(null);
  const [allTime, setAllTime] = useState<SpendingTotal | null>(null);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [summary, total, planRes] = await Promise.all([
          getSummary('month'),
          getSpendingTotal(),
          getPlanPricing()
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        setAllTime(total);
        setPlans(planRes.plans);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
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
    return <div className="text-center py-12 text-gray-500">Lade Übersicht…</div>;
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 mt-6">
        Fehler: {error}
      </div>
    );
  }

  const claudeAi = combined?.claude_ai ?? null;
  const meta = claudeAi?.meta ?? null;
  const apiTotalUsd = combined?.anthropic_api?.cost_usd ?? 0;
  const apiTotalEur = combined?.anthropic_api?.cost_eur_equivalent ?? 0;
  const additionalEur = claudeAi?.cost_eur ?? 0;
  const planEur = subscriptionEur(plans, meta?.plan_name);
  const claudeAiTotalEur = planEur + additionalEur;
  const grandTotalEur = claudeAiTotalEur + apiTotalEur;

  // Forecast: extrapolate today's spend rate to month end. Plan-Abo is fixed
  // (already counted), so we only forecast the variable parts (additional
  // EUR + API USD->EUR).
  const variableSoFar = additionalEur + apiTotalEur;
  const day = dayOfMonth();
  const daysLeft = daysRemainingInMonth() - 1; // -1 because today is partly done
  const dailyRate = day > 0 ? variableSoFar / day : 0;
  const forecastVariable = variableSoFar + Math.max(0, daysLeft) * dailyRate;
  const forecastTotal = planEur + forecastVariable;

  // Limit forecast: at this weekly rate, when does the user hit 100%?
  const weeklyAllPct = meta?.weekly_all_models_pct ?? null;
  let limitWarning: string | null = null;
  if (typeof weeklyAllPct === 'number' && weeklyAllPct >= 70) {
    limitWarning = `Wochenlimit zu ${weeklyAllPct}% verbraucht — Reset folgt.`;
  }

  return (
    <div className="space-y-6 py-6">
      {/* Hero */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
          Diesen Monat
        </h2>
        <div className="mt-2">
          <span className="text-3xl font-bold text-gray-900">{formatEur(grandTotalEur)}</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          claude.ai {formatEur(claudeAiTotalEur)} · Anthropic API ≈ {formatEur(apiTotalEur)}
        </p>
      </div>

      {/* Status row: 3 cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Plan-Status */}
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Plan</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{meta?.plan_name ?? '—'}</div>
          <div className="text-sm text-gray-600">{formatEur(planEur)} / Monat</div>
          <div className="mt-3 text-xs text-gray-500">
            Zusatznutzung {formatEur(additionalEur)}
            {meta?.monthly_limit_eur != null && <> / {formatEur(meta.monthly_limit_eur)}</>}
            {meta?.spent_pct != null && <> · {meta.spent_pct}%</>}
          </div>
        </div>

        {/* Wochenlimits */}
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Wochenlimits
          </div>
          <div className="mt-3 space-y-3">
            <ProgressRow label="Alle Modelle" pct={meta?.weekly_all_models_pct} />
            <ProgressRow label="Nur Sonnet" pct={meta?.weekly_sonnet_pct} />
            <ProgressRow label="Aktuelle Sitzung" pct={meta?.session_pct} />
          </div>
          {limitWarning && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {limitWarning}
            </p>
          )}
        </div>

        {/* Budget */}
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Budget</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">
            {meta?.balance_eur != null ? formatEur(meta.balance_eur) : '—'}
          </div>
          <div className="text-sm text-gray-600">Aktuelles Guthaben</div>
          <div className="mt-3 text-xs text-gray-500 space-y-1">
            {meta?.monthly_limit_eur != null && (
              <div>Monatslimit: {formatEur(meta.monthly_limit_eur)}</div>
            )}
            {meta?.reset_date && <div>Reset: {meta.reset_date}</div>}
          </div>
        </div>
      </div>

      {/* Forecast */}
      <div className="bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
        <div className="text-xs font-medium text-blue-900 uppercase tracking-wide">
          Hochrechnung Monatsende
        </div>
        <div className="mt-2 flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-bold text-gray-900">≈ {formatEur(forecastTotal)}</span>
          <span className="text-sm text-gray-600">
            am {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleDateString('de-DE')}
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-700">
          Aktuell {formatEur(grandTotalEur)} nach Tag {day} · Tagesschnitt{' '}
          {formatEur(dailyRate)} · {Math.max(0, daysLeft)} Tage verbleiben.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Lineare Extrapolation des bisherigen Tagesverbrauchs. Plan-Abo ({formatEur(planEur)}) ist
          fix; nur Zusatznutzung + API werden hochgerechnet.
        </p>
      </div>

      {/* Trend over months */}
      {allTime && allTime.claude_ai.months.length > 1 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">Kosten-Verlauf pro Monat</h3>
          <p className="text-sm text-gray-500">
            claude.ai-Gesamtkosten je Monat (Plan-Abo + Zusatznutzung).
          </p>
          <div className="mt-4 space-y-2">
            {allTime.claude_ai.months.map((m) => {
              const max = Math.max(...allTime.claude_ai.months.map((x) => x.total_eur), 1);
              const widthPct = (m.total_eur / max) * 100;
              return (
                <div key={m.month}>
                  <div className="flex justify-between text-sm">
                    <span className="font-mono">{m.month}</span>
                    <span className="font-medium">{formatEur(m.total_eur)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1">
                    <div
                      className="h-full bg-blue-500 rounded"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sync status */}
      {claudeAi?.last_synced && (
        <div className="text-xs text-gray-500 text-right">
          claude.ai-Sync: {formatRelativeTime(claudeAi.last_synced)}
        </div>
      )}
    </div>
  );
}
