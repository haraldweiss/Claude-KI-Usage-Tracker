// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getSummary,
  getSpendingTotal,
  getPlanPricing,
  getConsoleKeys
} from '../services/api';
import {
  CombinedSpendBreakdown,
  ConsoleKeyRecord,
  PlanPricingRow,
  SpendingTotal
} from '../types/api';

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

// Confidence tiers gate insight visibility by tracking duration.
// Days 0-6: early — first patterns visible, single insights tagged "vorläufig"
// Days 7-13: actionable — full week captures weekly variation, plan hints OK
// Days 14-29: confident — two weeks smooth anomalies, extrapolation stable
// Days 30+: established — full month, no disclaimers shown
export const INSIGHT_CONFIDENCE_TIERS = {
  early: 0,
  actionable: 7,
  confident: 14,
  established: 30
} as const;

export type ConfidenceLevel = keyof typeof INSIGHT_CONFIDENCE_TIERS;

/** Determine the confidence level for an insight based on days of tracking data.
 * Thresholds: early (<7), actionable (7+), confident (14+), established (30+)
 * @param daysTracked - Non-negative integer of days since tracking started
 * @returns The confidence level
 * @throws Error if daysTracked is not a non-negative integer */
export function getConfidenceLevel(daysTracked: number): ConfidenceLevel {
  if (!Number.isFinite(daysTracked) || daysTracked < 0 || !Number.isInteger(daysTracked)) {
    throw new Error(`Invalid daysTracked value: ${daysTracked}. Must be a non-negative integer.`);
  }
  if (daysTracked >= INSIGHT_CONFIDENCE_TIERS.established) return 'established';
  if (daysTracked >= INSIGHT_CONFIDENCE_TIERS.confident) return 'confident';
  if (daysTracked >= INSIGHT_CONFIDENCE_TIERS.actionable) return 'actionable';
  return 'early';
}

const CONFIDENCE_BADGE: Record<ConfidenceLevel, { label: string; emoji: string; classes: string } | null> = {
  early:       { label: 'Vorläufig (<7 Tage)',   emoji: '🌱', classes: 'bg-gray-200 text-gray-700' },
  actionable:  { label: 'Belastbar (7+ Tage)',   emoji: '📊', classes: 'bg-amber-100 text-amber-800' },
  confident:   { label: 'Stabil (14+ Tage)',     emoji: '✅', classes: 'bg-emerald-100 text-emerald-800' },
  established: null
};

interface Insight {
  level: 'info' | 'good' | 'warn' | 'alert';
  title: string;
  body: string;
  action?: string;
  confidence?: ConfidenceLevel;
}

const LEVEL_STYLES: Record<Insight['level'], string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  good: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  warn: 'bg-amber-50 border-amber-200 text-amber-900',
  alert: 'bg-red-50 border-red-200 text-red-900'
};

const LEVEL_ICON: Record<Insight['level'], string> = {
  info: 'ℹ️',
  good: '✅',
  warn: '⚠️',
  alert: '🚨'
};

function dayOfMonth(): number {
  return new Date().getDate();
}
function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate() + 1);
}

function daysSince(isoDate: string | null | undefined): number {
  if (!isoDate) return 0;
  const start = new Date(isoDate);
  if (isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));
}

/** Daily additional-spend rate of the last completed billing cycle, or null
 * if there's no prior cycle to reference. */
function priorCycleDailyRate(allTime: SpendingTotal | null): number | null {
  const cycles = allTime?.claude_ai.months ?? [];
  if (cycles.length < 2) return null;
  const prevCycle = cycles[1];
  const currentCycle = cycles[0];
  if (!prevCycle || !currentCycle) return null;
  const prevEnd = new Date(prevCycle.month).getTime();
  const refEnd = new Date(currentCycle.month).getTime();
  if (isNaN(prevEnd) || isNaN(refEnd)) return null;
  const cycleLen = Math.max(1, Math.round((refEnd - prevEnd) / 86_400_000));
  return prevCycle.additional_eur / cycleLen;
}

const MIN_DAYS_FOR_FORECAST = 3;
const FORECAST_SMOOTHING_DAYS = 7;

/** Resolve the monthly subscription EUR for a plan name from the pricing table. */
function subEur(plans: PlanPricingRow[], name: string | null | undefined): number {
  if (!name) return 0;
  return plans.find((p) => p.plan_name === name)?.monthly_eur ?? 0;
}

function buildInsights(
  combined: CombinedSpendBreakdown | null,
  allTime: SpendingTotal | null,
  plans: PlanPricingRow[],
  keys: ConsoleKeyRecord[]
): Insight[] {
  const insights: Insight[] = [];

  const claudeAi = combined?.claude_ai ?? null;
  const meta = claudeAi?.meta ?? null;
  const apiEur = combined?.anthropic_api?.cost_eur_equivalent ?? 0;
  const planEur = subEur(plans, meta?.plan_name);
  const additionalEur = claudeAi?.cost_eur ?? 0;
  const claudeAiTotalEur = planEur + additionalEur;

  // -------- All provider costs --------
  const opencodeGoEur = subEur(plans, 'OpenCode Go');
  const zaiSpend = combined?.zai ?? null;
  const zaiEur = subEur(plans, zaiSpend?.plan_name);
  const codexSpend = combined?.codex ?? null;
  const codexEur = codexSpend?.plan_cost_eur ?? subEur(plans, 'ChatGPT Plus');
  const usdToEur = combined?.exchange_rate?.usd_to_eur ?? 0.92;
  const opencodeApiEur = combined?.opencode_api?.total_cost_usd
    ? combined.opencode_api.total_cost_usd * usdToEur : 0;
  const openaiApiEur = combined?.openai_api?.cost_usd
    ? combined.openai_api.cost_usd * usdToEur : 0;
  const grandTotalEur = claudeAiTotalEur + apiEur + opencodeGoEur + zaiEur + codexEur + opencodeApiEur + openaiApiEur;
  const daysTracked = daysSince(allTime?.since);

  // -------- Plan right-sizing --------
  // A single week's % isn't enough — wait for at least ~2 weeks of tracking
  // before nudging the user to change plans, otherwise a quiet first week
  // recommends a downgrade prematurely.
  if (typeof meta?.weekly_all_models_pct === 'number' && meta.plan_name) {
    const pct = meta.weekly_all_models_pct;
    const singleUserPlans = plans.filter((p) => !p.min_seats || p.min_seats <= 1);
    const cheaperPlan = singleUserPlans
      .filter((p) => p.monthly_eur < planEur && p.monthly_eur > 0)
      .sort((a, b) => b.monthly_eur - a.monthly_eur)[0];
    const expensiverPlan = singleUserPlans
      .filter((p) => p.monthly_eur > planEur)
      .sort((a, b) => a.monthly_eur - b.monthly_eur)[0];

    const planConfidence = getConfidenceLevel(daysTracked);
    if (daysTracked < INSIGHT_CONFIDENCE_TIERS.actionable) {
      insights.push({
        level: 'info',
        title: `${meta.plan_name}: noch keine Plan-Empfehlung`,
        body: `Aktuell ${pct}% des Wochenlimits. Für eine fundierte Empfehlung brauche ich mindestens ${INSIGHT_CONFIDENCE_TIERS.actionable} Tage Tracking-Daten — bisher sind es ${daysTracked}.`,
        confidence: planConfidence
      });
    } else if (pct < 25 && cheaperPlan) {
      const savings = (planEur - cheaperPlan.monthly_eur) * 12;
      insights.push({
        level: 'good',
        title: `${meta.plan_name} ist evtl. zu groß`,
        body: `Du nutzt diese Woche nur ${pct}% deines Limits. Mit ${cheaperPlan.plan_name} (${formatEur(cheaperPlan.monthly_eur)}/Monat) hättest du immer noch Reserven und sparst ca. ${formatEur(savings)} pro Jahr.`,
        action: `Wenn das Muster anhält → auf ${cheaperPlan.plan_name} downgraden.`,
        confidence: planConfidence
      });
    } else if (pct >= 80 && expensiverPlan) {
      const extra = (expensiverPlan.monthly_eur - planEur) * 12;
      insights.push({
        level: 'warn',
        title: `${meta.plan_name} wird knapp`,
        body: `Du bist diese Woche schon bei ${pct}% deines Limits. ${expensiverPlan.plan_name} (${formatEur(expensiverPlan.monthly_eur)}/Monat) gibt dir mehr Spielraum für ca. ${formatEur(extra)} mehr pro Jahr.`,
        action: `Bei häufigen Limit-Annäherungen → ${expensiverPlan.plan_name} überlegen.`,
        confidence: planConfidence
      });
    } else {
      insights.push({
        level: 'good',
        title: `${meta.plan_name} passt zu deinem Verbrauch`,
        body: `Wochenlimit zu ${pct}% genutzt. Genug Reserve, kein Anlass zum Wechsel.`,
        confidence: planConfidence
      });
    }
  }

  // -------- Forecast monthly limit --------
  // claude.ai hard-caps additional usage at monthly_limit_eur, so a runaway
  // linear projection (e.g. "971€" on day 1) is meaningless. Use the same
  // smoothing approach as the overview forecast and frame the warning as
  // "limit reached on date X" once the cap is binding.
  if (typeof meta?.monthly_limit_eur === 'number' && additionalEur > 0 && daysTracked >= MIN_DAYS_FOR_FORECAST) {
    const day = dayOfMonth();
    const daysLeft = Math.max(0, daysRemainingInMonth() - 1);
    const currentDailyRate = additionalEur / Math.max(1, day);
    const priorRate = priorCycleDailyRate(allTime);
    const weight = Math.min(1, day / FORECAST_SMOOTHING_DAYS);
    const dailyRate = priorRate != null ? weight * currentDailyRate + (1 - weight) * priorRate : currentDailyRate;
    const limit = meta.monthly_limit_eur;
    const rawForecast = additionalEur + dailyRate * daysLeft;
    const forecastCapped = Math.min(rawForecast, limit);

    if (rawForecast > limit && dailyRate > 0) {
      // User will hit the cap before month-end. Compute the day they hit it.
      const daysToLimit = Math.ceil((limit - additionalEur) / dailyRate);
      const hitDate = new Date();
      hitDate.setDate(hitDate.getDate() + Math.max(0, daysToLimit));
      insights.push({
        level: 'alert',
        title: 'Monatslimit wird voraussichtlich erreicht',
        body: `Bei aktuellem Tempo (${formatEur(dailyRate)}/Tag) erreichst du dein ${formatEur(limit)}-Limit voraussichtlich am ${hitDate.toLocaleDateString('de-DE')}. Danach blockiert claude.ai weitere Zusatznutzung bis zum Reset.`,
        action:
          'Limit in claude.ai/settings/usage anheben, oder häufiger pausieren bis zum Reset.'
      });
    } else if (forecastCapped > limit * 0.8) {
      insights.push({
        level: 'warn',
        title: 'Monatslimit wird eng',
        body: `Hochrechnung: ${formatEur(forecastCapped)} bis Cycle-Ende, das sind ${Math.round((forecastCapped / limit) * 100)}% deines Limits (${formatEur(limit)}).`
      });
    }
  }

  // -------- Provider cost ranking --------
  if (grandTotalEur > 0) {
    const costs: { label: string; eur: number }[] = [
      { label: 'Claude.ai', eur: claudeAiTotalEur },
      { label: 'Anthropic API', eur: apiEur },
    ];
    if (opencodeGoEur > 0) costs.push({ label: 'OpenCode Go', eur: opencodeGoEur });
    if (zaiEur > 0) costs.push({ label: 'z.ai', eur: zaiEur });
    if (codexEur > 0) costs.push({ label: codexSpend?.plan_name && codexSpend.plan_name !== 'Unknown' ? codexSpend.plan_name : 'Codex', eur: codexEur });
    if (opencodeApiEur > 0) costs.push({ label: 'OpenCode API', eur: opencodeApiEur });
    if (openaiApiEur > 0) costs.push({ label: 'OpenAI API', eur: openaiApiEur });
    costs.sort((a, b) => b.eur - a.eur);

    const top = costs[0];
    const topShare = grandTotalEur > 0 ? (top.eur / grandTotalEur) * 100 : 0;
    const costLines = costs.map((c) => `${c.label} ${formatEur(c.eur)}`).join(' · ');

    insights.push({
      level: topShare > 50 ? 'warn' : 'info',
      title: `${top.label} ist der größte Kostenblock`,
      body: `${topShare.toFixed(0)}% der Gesamtkosten (${formatEur(grandTotalEur)}). Verteilung: ${costLines}.`,
      action: topShare > 50 ? `Fokus auf ${top.label} optimieren — hier liegt das meiste Potenzial.` : undefined,
    });
  }

  // -------- API key efficiency (Claude Code) --------
  const claudeCodeKeys = keys.filter(
    (k) => k.source === 'claude_code_sync' && (k.cost_usd ?? 0) > 0 && (k.lines_accepted ?? 0) > 0
  );
  if (claudeCodeKeys.length >= 2) {
    const ranked = claudeCodeKeys
      .map((k) => ({
        name: k.key_name ?? '?',
        cost: k.cost_usd ?? 0,
        lines: k.lines_accepted ?? 0,
        usdPerLine: (k.cost_usd ?? 0) / (k.lines_accepted ?? 1),
        last_synced: k.last_synced
      }))
      .sort((a, b) => a.usdPerLine - b.usdPerLine);
    const cheapest = ranked[0];
    const priciest = ranked[ranked.length - 1];
    if (cheapest && priciest && cheapest !== priciest) {
      const ratio = priciest.usdPerLine / cheapest.usdPerLine;
      if (ratio > 1.2) {
        const oldestSyncMs = Math.min(
          new Date(cheapest.last_synced).getTime(),
          new Date(priciest.last_synced).getTime()
        );
        const ageDays = Math.floor((Date.now() - oldestSyncMs) / 86_400_000);
        const staleNote = ageDays > 3
          ? ` (letzter Sync vor ${ageDays} Tagen — Werte ggf. veraltet)`
          : '';
        insights.push({
          level: 'info',
          title: 'Claude Code Keys: Effizienz-Vergleich',
          body: `${cheapest.name}: ${formatUsd(cheapest.usdPerLine)}/Line. ${priciest.name}: ${formatUsd(priciest.usdPerLine)}/Line (${ratio.toFixed(1)}× teurer)${staleNote}.`,
          action: 'Wenn beide Keys ähnliche Aufgaben machen, lohnt es sich vielleicht, vorrangig den günstigeren zu verwenden.'
        });
      }
    }
  }

  // -------- All-time grand total context --------
  if (allTime && allTime.claude_ai.months.length > 0) {
    const cycles = allTime.claude_ai.months.length;
    const total = allTime.grand_total_eur ?? allTime.claude_ai.total_eur;
    const claudeAiSub = allTime.claude_ai.subscription_eur ?? 0;
    const claudeAiAdd = allTime.claude_ai.additional_eur ?? 0;
    const apiAllTimeEur = allTime.anthropic_api?.total_eur_equivalent ?? 0;
    // Multi-provider totals not available in allTime — use current-month as proxy
    const otherMonthlyEur = opencodeGoEur + zaiEur + codexEur + opencodeApiEur + openaiApiEur;
    const breakdown = `Abo ${formatEur(claudeAiSub)} + Zusatznutzung ${formatEur(claudeAiAdd)}${apiAllTimeEur > 0 ? ` + API ${formatEur(apiAllTimeEur)}` : ''}`;
    const sinceLabel = allTime.since
      ? new Date(allTime.since).toLocaleDateString('de-DE')
      : '?';
    let body: string;
    if (daysTracked < INSIGHT_CONFIDENCE_TIERS.confident) {
      body = `${formatEur(total)} (${breakdown}) über ${daysTracked} ${daysTracked === 1 ? 'Tag' : 'Tage'} Tracking — noch zu kurz für einen belastbaren Monatsschnitt.${
        otherMonthlyEur > 0 ? ` Zusätzlich ca. ${formatEur(otherMonthlyEur)}/Monat aus anderen Providern (OpenCode Go, z.ai, Codex).` : ''
      }`;
    } else {
      const dailyAvg = total / Math.max(1, daysTracked);
      const monthlyExtrap = dailyAvg * 30;
      body = `${formatEur(total)} (${breakdown}) über ${daysTracked} Tage (${cycles} ${cycles === 1 ? 'Cycle' : 'Cycles'}). Tagesschnitt ${formatEur(dailyAvg)}, hochgerechnet ca. ${formatEur(monthlyExtrap)}/Monat.${
        otherMonthlyEur > 0 ? ` Zusätzlich ca. ${formatEur(otherMonthlyEur)}/Monat aus anderen Providern. Gesamt ca. ${formatEur(monthlyExtrap + otherMonthlyEur)}/Monat.` : ''
      }`;
    }
    insights.push({
      level: 'info',
      title: `Insgesamt seit ${sinceLabel}`,
      body,
      confidence: getConfidenceLevel(daysTracked)
    });
  }

  // -------- Subscription vs variable split --------
  const subTotal = planEur + opencodeGoEur + zaiEur + codexEur;
  const varTotal = additionalEur + apiEur + opencodeApiEur + openaiApiEur;
  if (subTotal + varTotal > 0) {
    const subShare = ((subTotal / (subTotal + varTotal)) * 100);
    insights.push({
      level: subShare > 70 ? 'info' : 'good',
      title: 'Fixkosten vs. variable Kosten',
      body: `${formatEur(subTotal)} fixe Abos (${subShare.toFixed(0)}%) · ${formatEur(varTotal)} variabel (${(100 - subShare).toFixed(0)}%).${
        varTotal > subTotal
          ? ' Variable Kosten dominieren — API-Nutzung im Auge behalten.'
          : ' Fixe Abos dominieren — die Kosten sind gut planbar.'
      }`
    });
  }

  // -------- Utilization cross-check --------
  const utilItems: string[] = [];
  if (typeof meta?.weekly_all_models_pct === 'number') utilItems.push(`Claude.ai: ${meta.weekly_all_models_pct}%`);
  const og = combined?.opencode_go;
  if (og?.continuous_pct != null) utilItems.push(`OpenCode Go: ${og.continuous_pct}%`);
  if (og?.weekly_pct != null) utilItems.push(`OpenCode Go Wo: ${og.weekly_pct}%`);
  const z = combined?.zai;
  if (z?.weekly_pct != null) utilItems.push(`z.ai Wo: ${z.weekly_pct}%`);
  if (z?.five_hour_pct != null) utilItems.push(`z.ai 5h: ${z.five_hour_pct}%`);
  const cx = combined?.codex;
  if (cx?.five_hour_remaining_pct != null) utilItems.push(`Codex 5h: ${100 - cx.five_hour_remaining_pct}%`);
  if (cx?.weekly_remaining_pct != null) utilItems.push(`Codex Wo: ${100 - cx.weekly_remaining_pct}%`);
  if (utilItems.length > 0) {
    const highUtil = utilItems.filter(i => {
      const m = i.match(/(\d+)%/);
      return m && parseInt(m[1]) >= 75;
    });
    insights.push({
      level: highUtil.length > 0 ? 'warn' : 'good',
      title: highUtil.length > 0
        ? `${highUtil.length} Limit${highUtil.length > 1 ? 's' : ''} zu >75% ausgelastet`
        : 'Alle Limits haben ausreichend Reserve',
      body: utilItems.join(' · ') + (highUtil.length > 0
        ? ' · Einige Kontingente sind knapp — Reset-Zeiten im Dashboard prüfen.'
        : ''),
    });
  }

  // -------- Hero summary if nothing else fired --------
  if (insights.length === 0) {
    insights.push({
      level: 'info',
      title: 'Noch nicht genug Daten',
      body: 'Sobald die Extension einen Sync gemacht hat, erscheinen hier konkrete Empfehlungen aus deinem tatsächlichen Verbrauch.'
    });
  }

  // Always include current-month grand total as a passive "context" insight
  if (grandTotalEur > 0) {
    insights.unshift({
      level: 'info',
      title: 'Diesen Monat',
      body: `Gesamt ${formatEur(grandTotalEur)} — ${[
        claudeAiTotalEur > 0 ? `Claude.ai ${formatEur(claudeAiTotalEur)}` : '',
        apiEur > 0 ? `API ${formatEur(apiEur)}` : '',
        opencodeGoEur > 0 ? `OpenCode Go ${formatEur(opencodeGoEur)}` : '',
        zaiEur > 0 ? `z.ai ${formatEur(zaiEur)}` : '',
        codexEur > 0 ? `${codexSpend?.plan_name && codexSpend.plan_name !== 'Unknown' ? codexSpend.plan_name : 'Codex'} ${formatEur(codexEur)}` : '',
        opencodeApiEur > 0 ? `OpenCode API ${formatEur(opencodeApiEur)}` : '',
        openaiApiEur > 0 ? `OpenAI API ${formatEur(openaiApiEur)}` : '',
      ].filter(Boolean).join(' · ')}.`
    });
  }

  return insights;
}

export default function InsightsBlock(): React.ReactElement {
  const [combined, setCombined] = useState<CombinedSpendBreakdown | null>(null);
  const [allTime, setAllTime] = useState<SpendingTotal | null>(null);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [keys, setKeys] = useState<ConsoleKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [summary, total, planRes, keyRes] = await Promise.all([
          getSummary('month'),
          getSpendingTotal(),
          getPlanPricing(),
          getConsoleKeys()
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        // TEST MODE: Allow overriding daysTracked via URL parameter for manual testing
        const params = new URLSearchParams(window.location.search);
        const testDaysTracked = params.get('testDaysTracked');
        if (testDaysTracked) {
          const days = parseInt(testDaysTracked, 10);
          if (!isNaN(days) && days >= 0) {
            // Create a mock allTime object with a since date that results in the test days value
            const since = new Date();
            since.setDate(since.getDate() - days);
            const mockAllTime = { ...total, since: since.toISOString().slice(0, 10) };
            setAllTime(mockAllTime);
          }
        } else {
          setAllTime(total);
        }
        setPlans(planRes.plans);
        setKeys(keyRes.keys);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Lade Insights…</div>;
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  const insights = buildInsights(combined, allTime, plans, keys);

  return (
    <div className="space-y-3">
      {insights.map((ins, i) => (
        <div
          key={i}
          className={`border-l-4 rounded-lg p-4 ${LEVEL_STYLES[ins.level]}`}
        >
          <div className="flex items-start gap-3">
            <span className="text-xl leading-none">{LEVEL_ICON[ins.level]}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{ins.title}</h3>
                {ins.confidence && CONFIDENCE_BADGE[ins.confidence] && (
                  <span className={`inline-block px-2 py-0.5 text-xs rounded whitespace-nowrap ${CONFIDENCE_BADGE[ins.confidence]!.classes}`}>
                    {CONFIDENCE_BADGE[ins.confidence]!.emoji} {CONFIDENCE_BADGE[ins.confidence]!.label}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm">{ins.body}</p>
              {ins.action && (
                <p className="mt-2 text-sm font-medium">→ {ins.action}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
