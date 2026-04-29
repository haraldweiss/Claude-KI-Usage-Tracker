import React, { useEffect, useState } from 'react';
import { getSummary, getConsoleKeys } from '../services/api';
import { CombinedSpendBreakdown, ConsoleKeyRecord } from '../types/api';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [summary, consoleKeys] = await Promise.all([
          getSummary('month'),
          getConsoleKeys()
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        setKeys(consoleKeys.keys);
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
  const claudeAiCost = claudeAi?.cost_eur ?? 0;

  const noData = !claudeAi && apiTotal === 0;

  return (
    <div className="space-y-6 py-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
          Gesamtkosten diesen Monat
        </h2>
        <div className="mt-2 flex items-baseline gap-3 flex-wrap">
          <span className="text-3xl font-bold text-gray-900">
            {formatEur(claudeAiCost)}
          </span>
          <span className="text-gray-400">+</span>
          <span className="text-3xl font-bold text-gray-900">
            {formatUsd(apiTotal)}
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-500">
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
                {formatEur(claudeAi.cost_eur)}
                {claudeAi.meta?.monthly_limit_eur != null && (
                  <span className="text-sm font-normal text-gray-500">
                    {' '}/ {formatEur(claudeAi.meta.monthly_limit_eur)}
                  </span>
                )}
              </p>
              {claudeAi.meta?.spent_pct != null && (
                <p className="text-xs text-gray-500">
                  {claudeAi.meta.spent_pct}% des Monatslimits verbraucht
                </p>
              )}

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

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">API Keys (Detail)</h3>
          <p className="text-sm text-gray-500">
            Letzter Snapshot pro Key aus console.anthropic.com.
          </p>
        </div>
        {keys.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            Noch kein Console-Sync gelaufen. Logge dich in console.anthropic.com ein und warte bis
            zu 24h, oder löse manuell aus.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Key
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Workspace
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Kosten
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Letzter Sync
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map((k) => (
                <tr key={`${k.workspace}-${k.key_id_suffix}`} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">
                    {k.key_name || '(unbenannt)'}
                    {k.key_id_suffix && (
                      <span className="ml-2 text-xs text-gray-400 font-mono">
                        …{k.key_id_suffix}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-700">{k.workspace || '—'}</td>
                  <td className="px-6 py-3 text-right font-medium text-blue-600">
                    {formatUsd(k.cost_usd ?? 0)}
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {formatRelativeTime(k.last_synced)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
