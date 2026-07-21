// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { getSummary, getConsoleKeys, getSpendingTotal, getPlanPricing, getProviders } from '../services/api';
import {
  CombinedSpendBreakdown,
  ConsoleKeyRecord,
  OpenCodeGoSpend,
  ZaiSpend,
  ClineSpend,
  type PlanPricingRow,
  SpendingTotal,
  type ProviderInfo
} from '../types/api';
import { formatEur, formatUsd, formatRelativeTime, formatAbsoluteResetHint, subscriptionEur } from '../utils/format';
import ApiKeysDetailTable from './ApiKeysDetailTable';

export default function CombinedCostTab(): React.ReactElement {
  const [combined, setCombined] = useState<CombinedSpendBreakdown | null>(null);
  const [keys, setKeys] = useState<ConsoleKeyRecord[]>([]);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [allTime, setAllTime] = useState<SpendingTotal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [summary, consoleKeys, planRes, total, providerRes] = await Promise.all([
          getSummary('month'),
          getConsoleKeys(),
          getPlanPricing(),
          getSpendingTotal(),
          getProviders().catch(() => ({ providers: [] }))
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        setKeys(consoleKeys.keys);
        setPlans(planRes.plans);
        setAllTime(total);
        setProviders(providerRes.providers ?? []);
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
  // An explicitly selected plan (including the zero-cost "API Usage" plan)
  // determines which sources take part in current-month totals. When settings
  // cannot be loaded, retain the prior fail-open behaviour.
  const providerActive = (key: string): boolean =>
    providers.length === 0 || !!providers.find((provider) => provider.key === key)?.plan_name;

  const apiTotal = providerActive('anthropic_api') ? combined?.anthropic_api?.cost_usd ?? 0 : 0;
  const apiTotalEurEquiv = providerActive('anthropic_api')
    ? combined?.anthropic_api?.cost_eur_equivalent ?? 0
    : 0;
  const apiByWorkspace = combined?.anthropic_api?.by_workspace ?? [];
  const opencodeGo: OpenCodeGoSpend | null = combined?.opencode_go ?? null;
  const zai: ZaiSpend | null = combined?.zai ?? null;
  const additionalUsageEur = claudeAi?.cost_eur ?? 0;
  const planSubscriptionEur = subscriptionEur(plans, claudeAi?.meta?.plan_name);
  const claudeAiTotalEur = planSubscriptionEur + additionalUsageEur;
  const opencodeGoEur = subscriptionEur(plans, 'OpenCode Go');
  const zaiEur = subscriptionEur(plans, zai?.plan_name);
  const cline: ClineSpend | null = combined?.cline ?? null;
  const chatGptEur = subscriptionEur(plans, 'ChatGPT Plus');
  const clineEur = subscriptionEur(plans, cline?.plan_name) || (combined?.cline?.plan_cost_eur ?? 0);
  const exchangeRate = combined?.exchange_rate;
  const usdToEur = exchangeRate?.usd_to_eur ?? 0.92;
  const opencodeApiEur = providerActive('opencode_api')
    ? (combined?.opencode_api?.total_cost_usd ?? 0) * usdToEur
    : 0;
  const openAiApiEur = providerActive('openai_api')
    ? (combined?.openai_api?.cost_usd ?? 0) * usdToEur
    : 0;
  const grandTotalEur = claudeAiTotalEur + apiTotalEurEquiv + opencodeApiEur + openAiApiEur + opencodeGoEur + zaiEur + chatGptEur + clineEur;

  const noData = !claudeAi && apiTotal === 0;

  return (
    <div className="space-y-6 py-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
          Gesamtkosten diesen Monat
        </h2>
        <div className="mt-2">
          <span className="text-3xl font-bold text-gray-900">
            {formatEur(grandTotalEur)}
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          claude.ai {formatEur(claudeAiTotalEur)}
          {planSubscriptionEur > 0 && (
            <> (Plan-Abo {formatEur(planSubscriptionEur)} + Zusatznutzung {formatEur(additionalUsageEur)})</>
          )}
          <span className="mx-1">·</span>
          Anthropic API {formatUsd(apiTotal)} ≈ {formatEur(apiTotalEurEquiv)}
          {opencodeApiEur > 0 && <><span className="mx-1">·</span>OpenCode API {formatEur(opencodeApiEur)}</>}
          {openAiApiEur > 0 && <><span className="mx-1">·</span>OpenAI API {formatEur(openAiApiEur)}</>}
          {opencodeGoEur > 0 && (
            <><span className="mx-1">·</span>OpenCode Go {formatEur(opencodeGoEur)}</>
          )}
          {zaiEur > 0 && <><span className="mx-1">·</span>z.ai {formatEur(zaiEur)}</>}
          {chatGptEur > 0 && <><span className="mx-1">·</span>ChatGPT Plus {formatEur(chatGptEur)}</>}
          {clineEur > 0 && <><span className="mx-1">·</span>Cline {formatEur(clineEur)}</>}
        </p>
        {exchangeRate?.usd_to_eur && (
          <p className="mt-1 text-xs text-gray-400">
            Umrechnung: 1 USD = {exchangeRate.usd_to_eur.toFixed(4)} EUR
            {exchangeRate.rate_date && ` (Kurs vom ${exchangeRate.rate_date})`}
          </p>
        )}
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
              {formatEur(allTime.grand_total_eur ?? allTime.claude_ai.total_eur)}
            </span>
            <span className="text-sm text-gray-500">
              seit {/^\d{4}-\d{2}-\d{2}$/.test(allTime.since) ? new Date(allTime.since).toLocaleDateString('de-DE') : allTime.since}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            claude.ai {formatEur(allTime.claude_ai.total_eur)} (Plan-Abos{' '}
            {formatEur(allTime.claude_ai.subscription_eur)} + Zusatznutzung{' '}
            {formatEur(allTime.claude_ai.additional_eur)}) <span className="mx-1">·</span>
            Anthropic API {formatUsd(allTime.anthropic_api.total_usd)}
            {allTime.anthropic_api.total_eur_equivalent != null && (
              <> ≈ {formatEur(allTime.anthropic_api.total_eur_equivalent)}</>
            )}
          </p>
          {allTime.exchange_rate?.usd_to_eur && (
            <p className="mt-1 text-xs text-gray-400">
              Umrechnung: 1 USD = {allTime.exchange_rate.usd_to_eur.toFixed(4)} EUR
              {allTime.exchange_rate.rate_date &&
                ` (Kurs vom ${allTime.exchange_rate.rate_date})`}
            </p>
          )}
          {allTime.claude_ai.months.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-blue-600 hover:underline">
                Aufschlüsselung pro Abrechnungsperiode ({allTime.claude_ai.months.length}{' '}
                {allTime.claude_ai.months.length === 1 ? 'Periode' : 'Perioden'})
              </summary>
              <table className="w-full mt-3 text-sm">
                <thead className="text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left py-1">Reset am</th>
                    <th className="text-left py-1">Plan</th>
                    <th className="text-right py-1">Plan-Abo</th>
                    <th className="text-right py-1">Zusatz</th>
                    <th className="text-right py-1">Gesamt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {allTime.claude_ai.months.map((m) => (
                    <tr key={m.month}>
                      <td className="py-2 font-mono text-xs">
                        {new Date(m.month).toLocaleDateString('de-DE')}
                      </td>
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
              <p className="mt-2 text-xs text-gray-500">
                Eine Periode = ein Billing-Cycle (von „Reset" zu „Reset"). Das vermeidet
                Doppelzählungen, wenn ein Cycle die Monatsgrenze überschreitet.
              </p>
            </details>
          )}
        </div>
      )}

      <div className={`grid grid-cols-1 gap-6 ${opencodeGo ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
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

      {opencodeGo && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-gray-900">OpenCode Go</h3>
            {opencodeGo.plan_name && (
              <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
                {opencodeGo.plan_name}
              </span>
            )}
          </div>
          {opencodeGo.plan_name && (
            <p className="mt-1 text-sm text-gray-500">
              {opencodeGo.plan_name}-Abonnement
            </p>
          )}
          <div className="mt-4 space-y-4">
            {opencodeGo.continuous_pct != null && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Fortlaufende Nutzung</span>
                  <span className="font-medium">{opencodeGo.continuous_pct}%</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${opencodeGo.continuous_pct < 50 ? 'bg-emerald-500' : opencodeGo.continuous_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, opencodeGo.continuous_pct)}%` }}
                  />
                </div>
                {opencodeGo.continuous_reset_in && (
                  <p className="mt-1 text-xs text-gray-500">
                    Reset in {opencodeGo.continuous_reset_in}
                  </p>
                )}
              </div>
            )}
            {opencodeGo.weekly_pct != null && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Wöchentliche Nutzung</span>
                  <span className="font-medium">{opencodeGo.weekly_pct}%</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${opencodeGo.weekly_pct < 50 ? 'bg-emerald-500' : opencodeGo.weekly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, opencodeGo.weekly_pct)}%` }}
                  />
                </div>
                {opencodeGo.weekly_reset_in && (
                  <p className="mt-1 text-xs text-gray-500">
                    Reset in {opencodeGo.weekly_reset_in}
                  </p>
                )}
              </div>
            )}
            {opencodeGo.monthly_pct != null && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Monatliche Nutzung</span>
                  <span className="font-medium">{opencodeGo.monthly_pct}%</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${opencodeGo.monthly_pct < 50 ? 'bg-emerald-500' : opencodeGo.monthly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, opencodeGo.monthly_pct)}%` }}
                  />
                </div>
                {opencodeGo.monthly_reset_in && (
                  <p className="mt-1 text-xs text-gray-500">
                    Reset in {opencodeGo.monthly_reset_in}
                  </p>
                )}
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Letzter Sync: {formatRelativeTime(opencodeGo.last_synced)}
          </p>
        </div>
      )}

      {zai && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-gray-900">z.ai</h3>
            {zai.plan_name && (
              <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
                {zai.plan_name}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            GLM Coding Plan{zaiEur > 0 && <> · {formatEur(zaiEur)} / Monat</>}
            {zai.price_usd != null && <> ({formatUsd(zai.price_usd)})</>}
          </p>
          <div className="mt-4 space-y-4">
            {zai.five_hour_pct != null && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">5-Stunden-Limit</span>
                  <span className="font-medium">{zai.five_hour_pct}%</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${zai.five_hour_pct < 50 ? 'bg-emerald-500' : zai.five_hour_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, zai.five_hour_pct)}%` }}
                  />
                </div>
              </div>
            )}
            {zai.weekly_pct != null && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Wöchentliche Nutzung</span>
                  <span className="font-medium">{zai.weekly_pct}%</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${zai.weekly_pct < 50 ? 'bg-emerald-500' : zai.weekly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, zai.weekly_pct)}%` }}
                  />
                </div>
                {zai.weekly_reset && (
                  <p className="mt-1 text-xs text-gray-500">{formatAbsoluteResetHint(zai.weekly_reset)}</p>
                )}
              </div>
            )}
            {zai.monthly_pct != null && (
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Monatlich (Web/Reader/Zread)</span>
                  <span className="font-medium">{zai.monthly_pct}%</span>
                </div>
                <div className="mt-1 h-2 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${zai.monthly_pct < 50 ? 'bg-emerald-500' : zai.monthly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, zai.monthly_pct)}%` }}
                  />
                </div>
                {zai.monthly_reset && (
                  <p className="mt-1 text-xs text-gray-500">{formatAbsoluteResetHint(zai.monthly_reset)}</p>
                )}
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Letzter Sync: {formatRelativeTime(zai.last_synced)}
            {zai.auto_renew_date && <> · Auto-Renew: {zai.auto_renew_date}</>}
          </p>
        </div>
      )}

      {/* Cline coding assistant */}
      {(clineEur > 0 || cline?.five_hour_pct != null) && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Cline</h3>
            {cline?.plan_name && (
              <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
                {cline.plan_name}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            KI-Coding-Assistent (VS Code)
            {clineEur > 0 && <> · {formatEur(clineEur)} / Monat</>}
          </p>
          <div className="mt-4 space-y-3">
            {cline?.five_hour_pct != null && (
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-600">5-Std.-Limit</span>
                  <span className="font-medium">{cline.five_hour_pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${cline.five_hour_pct < 50 ? 'bg-emerald-500' : cline.five_hour_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, cline.five_hour_pct)}%` }}
                  />
                </div>
                {cline.five_hour_reset_in && (
                  <p className="mt-0.5 text-xs text-gray-500">Reset {cline.five_hour_reset_in}</p>
                )}
              </div>
            )}
            {cline?.weekly_pct != null && (
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-600">Wöchentlich</span>
                  <span className="font-medium">{cline.weekly_pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${cline.weekly_pct < 50 ? 'bg-emerald-500' : cline.weekly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, cline.weekly_pct)}%` }}
                  />
                </div>
                {cline.weekly_reset_in && (
                  <p className="mt-0.5 text-xs text-gray-500">Reset {cline.weekly_reset_in}</p>
                )}
              </div>
            )}
            {cline?.monthly_pct != null && (
              <div>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-gray-600">Monatlich</span>
                  <span className="font-medium">{cline.monthly_pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${cline.monthly_pct < 50 ? 'bg-emerald-500' : cline.monthly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, cline.monthly_pct)}%` }}
                  />
                </div>
                {cline.monthly_reset_in && (
                  <p className="mt-0.5 text-xs text-gray-500">Reset {cline.monthly_reset_in}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ApiKeysDetailTable keys={keys} />
    </div>
  );
}
