// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { getSummary, getSpendingTotal, getPlanPricing } from '../services/api';
import LocalUsageCard from './LocalUsageCard';
import { formatResetDateDisplay } from '../utils/resetDateDisplay';
import { formatEur, formatRelativeTime, formatAbsoluteResetHint, subscriptionEur } from '../utils/format';
import { CombinedSpendBreakdown, OpenCodeGoSpend, ZaiSpend, type PlanPricingRow, SpendingTotal } from '../types/api';

/** Days remaining in the current month, including today. */
function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate() + 1);
}

function dayOfMonth(): number {
  return new Date().getDate();
}

/**
 * Convert raw reset hint into a German label. Handles both short codes
 * ("1T", "4h", "30m") from OpenCode Go and prose ("ca. 4 Std.", "etwa 1 Tag",
 * "in 30 Minuten") from claude.ai. Returns undefined for null/empty so the
 * ProgressRow hides the hint row entirely.
 */
function formatResetHint(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // Short code format: "4h", "1T", "30m"
  const short = raw.match(/^(\d+)\s*([a-zA-Z])/);
  if (short) {
    const n = parseInt(short[1], 10);
    const unit = short[2].toLowerCase();
    if (unit === 't' || unit === 'd') return `Reset in ${n} ${n === 1 ? 'Tag' : 'Tagen'}`;
    if (unit === 'h') return `Reset in ${n} Std.`;
    if (unit === 'm') return `Reset in ${n} Min.`;
  }
  // Calendar-time format from claude.ai weekly: "Do., 00:00", "Thu., 00:00"
  if (/^[A-Za-zÄÖÜäöü]+[.,]\s*\d{1,2}:\d{2}/.test(raw.trim())) {
    return `Reset: ${raw.trim()}`;
  }
  // Prose format from claude.ai: already contains "Std.", "Tag", "Minuten" etc.
  // Strip common prefixes like "ca.", "etwa", "in" for cleaner display
  const cleaned = raw.replace(/^(ca\.?\s*|etwa\s*|in\s*)/i, '').trim();
  return `Reset in ${cleaned}`;
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
  const opencodeGo: OpenCodeGoSpend | null = combined?.opencode_go ?? null;
  const zai: ZaiSpend | null = combined?.zai ?? null;
  const apiTotalEur = combined?.anthropic_api?.cost_eur_equivalent ?? 0;
  const additionalEur = claudeAi?.cost_eur ?? 0;
  const planEur = subscriptionEur(plans, meta?.plan_name);
  const claudeAiTotalEur = planEur + additionalEur;
  const opencodeGoEur = subscriptionEur(plans, 'OpenCode Go');
  const zaiEur = subscriptionEur(plans, zai?.plan_name);
  const chatGptEur = subscriptionEur(plans, 'ChatGPT Plus');
  const grandTotalEur = claudeAiTotalEur + apiTotalEur + opencodeGoEur + zaiEur + chatGptEur;

  // Number of subscription side-cards shown to the right of the three core
  // claude.ai cards — drives the responsive grid column count.
  const statusCardCount = 3 + (opencodeGo ? 1 : 0) + (zai ? 1 : 0) + (chatGptEur > 0 ? 1 : 0);
  const statusGridCols =
    statusCardCount >= 5 ? 'md:grid-cols-5' : statusCardCount === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3';

  // Forecast: extrapolate today's spend rate to month end. Plan-Abo is fixed
  // (already counted), so we only forecast the variable parts (additional
  // EUR + API USD->EUR). Early in the month we blend with the previous month's
  // daily rate so a single high day doesn't produce a wild forecast.
  const variableSoFar = additionalEur + apiTotalEur;
  const day = dayOfMonth();
  const daysLeft = Math.max(0, daysRemainingInMonth() - 1); // -1 because today is partly done
  const currentDailyRate = day > 0 ? variableSoFar / day : 0;

  // Take the second-most-recent billing cycle as the reference for early-month
  // smoothing. months[0] is the current/in-progress cycle, months[1] is the
  // last completed one. Cycle length is derived from the gap between the two
  // cycle-end dates (defaults to 30 days if only one cycle exists).
  const cycles = allTime?.claude_ai.months ?? [];
  const prevCycle = cycles.length >= 2 ? cycles[1] : null;
  let priorDailyRate: number | null = null;
  if (prevCycle) {
    const prevEnd = new Date(prevCycle.month);
    const refEnd = cycles[0] ? new Date(cycles[0].month) : null;
    const cycleLengthDays = refEnd
      ? Math.max(1, Math.round((refEnd.getTime() - prevEnd.getTime()) / 86_400_000))
      : 30;
    priorDailyRate = prevCycle.additional_eur / cycleLengthDays;
  }

  const SMOOTHING_DAYS = 7;
  const weight = Math.min(1, day / SMOOTHING_DAYS);
  const isSmoothed = priorDailyRate != null && weight < 1;
  const dailyRate = priorDailyRate != null
    ? weight * currentDailyRate + (1 - weight) * priorDailyRate
    : currentDailyRate;

  const forecastVariable = variableSoFar + daysLeft * dailyRate;
  const forecastTotal = planEur + opencodeGoEur + zaiEur + chatGptEur + forecastVariable;

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
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
              Diesen Monat
            </h2>
            <div className="mt-2">
              <span className="text-3xl font-bold text-gray-900">{formatEur(grandTotalEur)}</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              claude.ai {formatEur(claudeAiTotalEur)} · Anthropic API ≈ {formatEur(apiTotalEur)}
              {opencodeGoEur > 0 && <> · OpenCode Go {formatEur(opencodeGoEur)}</>}
              {zaiEur > 0 && <> · z.ai {formatEur(zaiEur)}</>}
              {chatGptEur > 0 && <> · ChatGPT Plus {formatEur(chatGptEur)}</>}
            </p>
          </div>
          <div className="text-sm text-gray-500 sm:text-right">
            {formatResetDateDisplay(meta?.reset_date, claudeAi?.last_synced ?? new Date().toISOString())}
          </div>
        </div>
      </div>

      {/* Status row */}
      <div className={`grid grid-cols-1 gap-6 ${statusGridCols}`}>
        {/* Plan-Status */}
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Claude.ai</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{meta?.plan_name ?? '—'}</div>
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
            <ProgressRow label="Alle Modelle" pct={meta?.weekly_all_models_pct} hint={formatResetHint(meta?.weekly_all_models_reset_in)} />
            <ProgressRow label="Nur Sonnet" pct={meta?.weekly_sonnet_pct} hint={formatResetHint(meta?.weekly_sonnet_reset_in)} />
            <ProgressRow label="Aktuelle Sitzung" pct={meta?.session_pct} hint={formatResetHint(meta?.session_reset_in)} />
            {meta?.session_limit_hours && (
              <p className="mt-1 text-xs text-gray-500">
                Limit: {meta.session_limit_hours} Std.
              </p>
            )}
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

        {/* OpenCode Go */}
        {opencodeGo && (
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              OpenCode Go
            </div>
            <div className="mt-2 text-xl font-bold text-gray-900">
              {opencodeGo.plan_name ?? 'OpenCode Go'}
            </div>
            <div className="mt-3 space-y-2">
              {opencodeGo.continuous_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Fortlaufend</span>
                    <span className="font-medium">{opencodeGo.continuous_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${opencodeGo.continuous_pct < 50 ? 'bg-emerald-500' : opencodeGo.continuous_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, opencodeGo.continuous_pct)}%` }}
                    />
                  </div>
                  {opencodeGo.continuous_reset_in && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatResetHint(opencodeGo.continuous_reset_in)}
                    </p>
                  )}
                </div>
              )}
              {opencodeGo.weekly_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Wöchentlich</span>
                    <span className="font-medium">{opencodeGo.weekly_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${opencodeGo.weekly_pct < 50 ? 'bg-emerald-500' : opencodeGo.weekly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, opencodeGo.weekly_pct)}%` }}
                    />
                  </div>
                  {opencodeGo.weekly_reset_in && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatResetHint(opencodeGo.weekly_reset_in)}
                    </p>
                  )}
                </div>
              )}
              {opencodeGo.monthly_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Monatlich</span>
                    <span className="font-medium">{opencodeGo.monthly_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${opencodeGo.monthly_pct < 50 ? 'bg-emerald-500' : opencodeGo.monthly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, opencodeGo.monthly_pct)}%` }}
                    />
                  </div>
                  {opencodeGo.monthly_reset_in && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatResetHint(opencodeGo.monthly_reset_in)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ChatGPT Plus */}
        {chatGptEur > 0 && (
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              ChatGPT Plus
            </div>
            <div className="mt-2 text-xl font-bold text-gray-900">
              ChatGPT Plus
            </div>
            <div className="mt-1 text-sm text-gray-600">{formatEur(chatGptEur)} / Monat</div>
          </div>
        )}

        {/* z.ai GLM Coding Plan */}
        {zai && (
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              z.ai
            </div>
            <div className="mt-2 text-xl font-bold text-gray-900">
              {zai.plan_name ?? 'GLM Coding Plan'}
            </div>
            {zaiEur > 0 && <div className="text-sm text-gray-600">{formatEur(zaiEur)} / Monat</div>}
            <div className="mt-3 space-y-2">
              {zai.five_hour_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">5-Std.-Limit</span>
                    <span className="font-medium">{zai.five_hour_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${zai.five_hour_pct < 50 ? 'bg-emerald-500' : zai.five_hour_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, zai.five_hour_pct)}%` }}
                    />
                  </div>
                </div>
              )}
              {zai.weekly_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Wöchentlich</span>
                    <span className="font-medium">{zai.weekly_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${zai.weekly_pct < 50 ? 'bg-emerald-500' : zai.weekly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, zai.weekly_pct)}%` }}
                    />
                  </div>
                  {zai.weekly_reset && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatAbsoluteResetHint(zai.weekly_reset)}
                    </p>
                  )}
                </div>
              )}
              {zai.monthly_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Monatlich (Web/Reader)</span>
                    <span className="font-medium">{zai.monthly_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${zai.monthly_pct < 50 ? 'bg-emerald-500' : zai.monthly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, zai.monthly_pct)}%` }}
                    />
                  </div>
                  {zai.monthly_reset && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {formatAbsoluteResetHint(zai.monthly_reset)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
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
          {formatEur(dailyRate)} · {daysLeft} Tage verbleiben.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {isSmoothed ? (
            <>
              Geglättete Hochrechnung: in den ersten {SMOOTHING_DAYS} Tagen mit der Tagesrate der
              vorherigen Abrechnungsperiode ({formatEur(priorDailyRate ?? 0)}/Tag) gewichtet —
              {' '}{Math.round(weight * 100)}% aktueller Monat, {Math.round((1 - weight) * 100)}%
              Vorperiode. Plan-Abo ({formatEur(planEur)}) + OpenCode Go ({formatEur(opencodeGoEur)}) sind
              fix; nur Zusatznutzung + API werden hochgerechnet.
            </>
          ) : (
            <>
              Lineare Extrapolation des bisherigen Tagesverbrauchs. Plan-Abo ({formatEur(planEur)}) +
              OpenCode Go ({formatEur(opencodeGoEur)}) sind fix; nur Zusatznutzung + API werden
              hochgerechnet.
            </>
          )}
        </p>
      </div>

      {/* Local LLM usage (provider-service) */}
      <LocalUsageCard />

      {/* Trend over months */}
      {allTime && allTime.claude_ai.months.length > 1 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900">
            Kosten-Verlauf pro Abrechnungsperiode
          </h3>
          <p className="text-sm text-gray-500">
            claude.ai-Gesamtkosten je Billing-Cycle (Plan-Abo + Zusatznutzung).
          </p>
          <div className="mt-4 space-y-2">
            {allTime.claude_ai.months.map((m) => {
              const max = Math.max(...allTime.claude_ai.months.map((x) => x.total_eur), 1);
              const widthPct = (m.total_eur / max) * 100;
              const label = /^\d{4}-\d{2}-\d{2}$/.test(m.month)
                ? `Reset ${new Date(m.month).toLocaleDateString('de-DE')}`
                : m.month;
              return (
                <div key={m.month}>
                  <div className="flex justify-between text-sm">
                    <span className="font-mono">{label}</span>
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
      <div className="text-xs text-gray-500 text-right space-x-4">
        {claudeAi?.last_synced && (
          <span>claude.ai-Sync: {formatRelativeTime(claudeAi.last_synced)}</span>
        )}
        {opencodeGo?.last_synced && (
          <span>OpenCode Go-Sync: {formatRelativeTime(opencodeGo.last_synced)}</span>
        )}
        {chatGptEur > 0 && (
          <span>ChatGPT Plus: {formatEur(chatGptEur)}/Monat</span>
        )}
        {zai?.last_synced && (
          <span>z.ai-Sync: {formatRelativeTime(zai.last_synced)}</span>
        )}
      </div>
    </div>
  );
}
