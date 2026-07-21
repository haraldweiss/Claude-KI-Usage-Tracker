// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { getSummary, getSpendingTotal, getPlanPricing, getProviders } from '../services/api';
import LocalUsageCard from './LocalUsageCard';
import { formatResetDateDisplay } from '../utils/resetDateDisplay';
import { formatEur, formatRelativeTime, formatAbsoluteResetHint, subscriptionEur } from '../utils/format';
import { CombinedSpendBreakdown, OpenCodeGoSpend, ZaiSpend, ClineSpend, type PlanPricingRow, SpendingTotal, type ProviderInfo } from '../types/api';

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
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [summary, total, planRes, provRes] = await Promise.all([
          getSummary('month'),
          getSpendingTotal(),
          getPlanPricing(),
          getProviders().catch(() => ({ providers: [] }))
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        setAllTime(total);
        setPlans(planRes.plans);
        setProviders(provRes.providers ?? []);
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
  const cline: ClineSpend | null = combined?.cline ?? null;

  // Provider Settings are the source of truth for what the user wants to
  // track. A configured zero-cost "API Usage" plan activates API providers;
  // a missing plan excludes stale historical snapshots. Until the request is
  // available, fail open so existing installations keep rendering data.
  const providerActive = (key: string): boolean => {
    if (providers.length === 0) return true;
    const p = providers.find((x) => x.key === key);
    return !!p?.plan_name;
  };
  const configuredPlan = (key: string, fallback: string | null | undefined): string | null => {
    if (providers.length === 0) return fallback ?? null;
    return providers.find((x) => x.key === key)?.plan_name ?? null;
  };

  const showClaudeAi = providerActive('claude_ai');
  const rawApiTotalEur = combined?.anthropic_api?.cost_eur_equivalent ?? 0;
  const showAnthropicApi = providerActive('anthropic_api') || rawApiTotalEur > 0;
  const apiTotalEur = showAnthropicApi ? rawApiTotalEur : 0;
  const opencodeApiEur = providerActive('opencode_api')
    ? (combined?.opencode_api?.total_cost_usd ?? 0) * (combined?.exchange_rate?.usd_to_eur ?? 0.92)
    : 0;
  const openAiApiEur = providerActive('openai_api')
    ? (combined?.openai_api?.cost_usd ?? 0) * (combined?.exchange_rate?.usd_to_eur ?? 0.92)
    : 0;
  const additionalEur = showClaudeAi ? claudeAi?.cost_eur ?? 0 : 0;
  const planEur = subscriptionEur(plans, configuredPlan('claude_ai', meta?.plan_name));
  const claudeAiTotalEur = planEur + additionalEur;
  const opencodeGoEur = subscriptionEur(plans, configuredPlan('opencode_go', opencodeGo?.plan_name ?? 'OpenCode Go'));
  const zaiEur = subscriptionEur(plans, configuredPlan('zai', zai?.plan_name));
  const chatGptEur = subscriptionEur(plans, configuredPlan('codex', combined?.codex?.plan_name));
  const configuredClinePlan = configuredPlan('cline', cline?.plan_name);
  const clineEur = subscriptionEur(plans, configuredClinePlan) || (configuredClinePlan ? combined?.cline?.plan_cost_eur ?? 0 : 0);
  const grandTotalEur = claudeAiTotalEur + apiTotalEur + opencodeApiEur + openAiApiEur + opencodeGoEur + zaiEur + chatGptEur + clineEur;

  // Subscription side-cards shown to the right of the three core claude.ai
  // cards. Each is gated on provider active status when "only active" is on.
  const showOpenCodeGo = !!opencodeGo && (!showOnlyActive || providerActive('opencode_go'));
  const showChatGpt = chatGptEur > 0 && (!showOnlyActive || providerActive('codex'));
  const showZai = !!zai && (!showOnlyActive || providerActive('zai'));
  const showCline = (clineEur > 0 || cline?.five_hour_pct != null) && (!showOnlyActive || providerActive('cline'));
  const statusCardCount = (showClaudeAi ? 3 : 0) + (showOpenCodeGo ? 1 : 0) + (showChatGpt ? 1 : 0) + (showZai ? 1 : 0) + (showCline ? 1 : 0);
  const statusGridCols =
    statusCardCount >= 5 ? 'md:grid-cols-5' : statusCardCount === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3';

  // Forecast: extrapolate today's spend rate to month end. Plan-Abo is fixed
  // (already counted), so we only forecast the variable parts (additional
  // EUR + all configured API spend). Early in the month we blend with the previous month's
  // daily rate so a single high day doesn't produce a wild forecast.
  const variableSoFar = additionalEur + apiTotalEur + opencodeApiEur + openAiApiEur;
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
  const forecastTotal = planEur + opencodeGoEur + zaiEur + chatGptEur + clineEur + forecastVariable;

  // Limit forecast: at this weekly rate, when does the user hit 100%?
  const weeklyAllPct = meta?.weekly_all_models_pct ?? null;
  let limitWarning: string | null = null;
  if (typeof weeklyAllPct === 'number' && weeklyAllPct >= 70) {
    limitWarning = `Wochenlimit zu ${weeklyAllPct}% verbraucht — Reset folgt.`;
  }

  const currentSpendBreakdown = [
    showClaudeAi ? `claude.ai ${formatEur(claudeAiTotalEur)}` : null,
    showAnthropicApi ? `Anthropic API ≈ ${formatEur(apiTotalEur)}` : null,
    opencodeApiEur > 0 ? `OpenCode API ${formatEur(opencodeApiEur)}` : null,
    openAiApiEur > 0 ? `OpenAI API ${formatEur(openAiApiEur)}` : null,
    opencodeGoEur > 0 ? `OpenCode Go ${formatEur(opencodeGoEur)}` : null,
    zaiEur > 0 ? `z.ai ${formatEur(zaiEur)}` : null,
    chatGptEur > 0 ? `ChatGPT Plus ${formatEur(chatGptEur)}` : null,
    clineEur > 0 ? `Cline ${formatEur(clineEur)}` : null,
  ].filter((item): item is string => item !== null);

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
              {currentSpendBreakdown.map((item, index) => (
                <React.Fragment key={item}>
                  {index > 0 && ' · '}
                  {item}
                </React.Fragment>
              ))}
            </p>
          </div>
          {showClaudeAi && (
            <div className="text-sm text-gray-500 sm:text-right">
              {formatResetDateDisplay(meta?.reset_date, claudeAi?.last_synced ?? new Date().toISOString())}
            </div>
          )}
        </div>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-600">Anbieter-Status</span>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOnlyActive}
            onChange={(e) => setShowOnlyActive(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Nur aktive Pläne
        </label>
      </div>
      <div className={`grid grid-cols-1 gap-6 ${statusGridCols}`}>
        {showClaudeAi && (
          <>
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
          </>
        )}

        {/* OpenCode Go */}
        {showOpenCodeGo && (
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
        {showChatGpt && (() => {
          const codexMeta = combined?.codex;
          const fiveHrUsed = codexMeta?.five_hour_remaining_pct != null ? 100 - codexMeta.five_hour_remaining_pct : null;
          const weeklyUsed = codexMeta?.weekly_remaining_pct != null ? 100 - codexMeta.weekly_remaining_pct : null;
          const monthlyUsed = codexMeta?.monthly_remaining_pct != null ? 100 - codexMeta.monthly_remaining_pct : null;
          return (
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              ChatGPT Plus
            </div>
            <div className="mt-2 text-xl font-bold text-gray-900">
              ChatGPT Plus
            </div>
            <div className="mt-1 text-sm text-gray-600">{formatEur(chatGptEur)} / Monat</div>
            <div className="mt-3 space-y-2">
              {fiveHrUsed != null && (
                <ProgressRow label="5-Std.-Limit" pct={fiveHrUsed} />
              )}
              {weeklyUsed != null && (
                <ProgressRow label="Wöchentlich" pct={weeklyUsed} hint={codexMeta?.weekly_reset_at ? formatAbsoluteResetHint(codexMeta.weekly_reset_at) : undefined} />
              )}
              {monthlyUsed != null && (
                <ProgressRow label="Monatlich" pct={monthlyUsed} hint={codexMeta?.monthly_reset_at ? formatAbsoluteResetHint(codexMeta.monthly_reset_at) : undefined} />
              )}
            </div>
          </div>
          );
        })()}

        {/* z.ai GLM Coding Plan */}
        {showZai && (
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

        {/* Cline coding assistant */}
        {showCline && (
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Cline
            </div>
            <div className="mt-2 text-xl font-bold text-gray-900">
              {cline?.plan_name ?? 'Cline'}
            </div>
            {clineEur > 0 && <div className="text-sm text-gray-600">{formatEur(clineEur)} / Monat</div>}
            <div className="mt-3 space-y-2">
              {cline?.five_hour_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">5-Std.-Limit</span>
                    <span className="font-medium">{cline.five_hour_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${cline.five_hour_pct < 50 ? 'bg-emerald-500' : cline.five_hour_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, cline.five_hour_pct)}%` }}
                    />
                  </div>
                  {cline.five_hour_reset_in && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      Reset {cline.five_hour_reset_in}
                    </p>
                  )}
                </div>
              )}
              {cline?.weekly_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Wöchentlich</span>
                    <span className="font-medium">{cline.weekly_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${cline.weekly_pct < 50 ? 'bg-emerald-500' : cline.weekly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, cline.weekly_pct)}%` }}
                    />
                  </div>
                  {cline.weekly_reset_in && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      Reset {cline.weekly_reset_in}
                    </p>
                  )}
                </div>
              )}
              {cline?.monthly_pct != null && (
                <div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Monatlich</span>
                    <span className="font-medium">{cline.monthly_pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 bg-gray-100 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${cline.monthly_pct < 50 ? 'bg-emerald-500' : cline.monthly_pct < 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, cline.monthly_pct)}%` }}
                    />
                  </div>
                  {cline.monthly_reset_in && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      Reset {cline.monthly_reset_in}
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
              Vorperiode. Plan-Abo ({formatEur(planEur)}) + OpenCode Go ({formatEur(opencodeGoEur)}){clineEur > 0 && <> + Cline ({formatEur(clineEur)})</>} sind
              fix; nur Zusatznutzung + API werden hochgerechnet.
            </>
          ) : (
            <>
              Lineare Extrapolation des bisherigen Tagesverbrauchs. Plan-Abo ({formatEur(planEur)}) +
              OpenCode Go ({formatEur(opencodeGoEur)}){clineEur > 0 && <> · Cline ({formatEur(clineEur)})</>} sind fix; nur Zusatznutzung + API werden
              hochgerechnet.
            </>
          )}
        </p>
      </div>

      {/* Local LLM usage (provider-service) */}
      <LocalUsageCard />

      {/* Trend over months */}
      {showClaudeAi && allTime && allTime.claude_ai.months.length > 1 && (
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
        {showClaudeAi && claudeAi?.last_synced && (
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
        {clineEur > 0 && (
          <span>Cline: {formatEur(clineEur)}/Monat</span>
        )}
      </div>
    </div>
  );
}
