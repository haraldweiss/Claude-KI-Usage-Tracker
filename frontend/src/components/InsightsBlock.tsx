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

interface Insight {
  level: 'info' | 'good' | 'warn' | 'alert';
  title: string;
  body: string;
  action?: string;
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

const MIN_DAYS_FOR_PLAN_ADVICE = 14;
const MIN_DAYS_FOR_FORECAST = 3;
const FORECAST_SMOOTHING_DAYS = 7;

function buildInsights(
  combined: CombinedSpendBreakdown | null,
  allTime: SpendingTotal | null,
  plans: PlanPricingRow[],
  keys: ConsoleKeyRecord[]
): Insight[] {
  const insights: Insight[] = [];

  const claudeAi = combined?.claude_ai ?? null;
  const meta = claudeAi?.meta ?? null;
  const apiUsd = combined?.anthropic_api?.cost_usd ?? 0;
  const apiEur = combined?.anthropic_api?.cost_eur_equivalent ?? 0;
  const planEur = plans.find((p) => p.plan_name === meta?.plan_name)?.monthly_eur ?? 0;
  const additionalEur = claudeAi?.cost_eur ?? 0;
  const claudeAiTotalEur = planEur + additionalEur;
  const grandTotalEur = claudeAiTotalEur + apiEur;
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

    if (daysTracked < MIN_DAYS_FOR_PLAN_ADVICE) {
      insights.push({
        level: 'info',
        title: `${meta.plan_name}: noch keine Plan-Empfehlung`,
        body: `Aktuell ${pct}% des Wochenlimits. Für eine fundierte Empfehlung brauche ich mindestens ${MIN_DAYS_FOR_PLAN_ADVICE} Tage Tracking-Daten — bisher sind es ${daysTracked}.`
      });
    } else if (pct < 25 && cheaperPlan) {
      const savings = (planEur - cheaperPlan.monthly_eur) * 12;
      insights.push({
        level: 'good',
        title: `${meta.plan_name} ist evtl. zu groß`,
        body: `Du nutzt diese Woche nur ${pct}% deines Limits. Mit ${cheaperPlan.plan_name} (${formatEur(cheaperPlan.monthly_eur)}/Monat) hättest du immer noch Reserven und sparst ca. ${formatEur(savings)} pro Jahr.`,
        action: `Wenn das Muster anhält → auf ${cheaperPlan.plan_name} downgraden.`
      });
    } else if (pct >= 80 && expensiverPlan) {
      const extra = (expensiverPlan.monthly_eur - planEur) * 12;
      insights.push({
        level: 'warn',
        title: `${meta.plan_name} wird knapp`,
        body: `Du bist diese Woche schon bei ${pct}% deines Limits. ${expensiverPlan.plan_name} (${formatEur(expensiverPlan.monthly_eur)}/Monat) gibt dir mehr Spielraum für ca. ${formatEur(extra)} mehr pro Jahr.`,
        action: `Bei häufigen Limit-Annäherungen → ${expensiverPlan.plan_name} überlegen.`
      });
    } else {
      insights.push({
        level: 'good',
        title: `${meta.plan_name} passt zu deinem Verbrauch`,
        body: `Wochenlimit zu ${pct}% genutzt. Genug Reserve, kein Anlass zum Wechsel.`
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

  // -------- Cost source ratio --------
  if (claudeAiTotalEur + apiEur > 0) {
    const claudeShare = (claudeAiTotalEur / (claudeAiTotalEur + apiEur)) * 100;
    insights.push({
      level: 'info',
      title: 'Kosten-Verteilung',
      body: `${claudeShare.toFixed(0)}% deiner Kosten kommen aus claude.ai (Subscription + Zusatznutzung), ${(100 - claudeShare).toFixed(0)}% aus der Anthropic API.${
        apiUsd > 0
          ? ` API-Spend ${formatUsd(apiUsd)} ≈ ${formatEur(apiEur)}.`
          : ''
      }`
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
        usdPerLine: (k.cost_usd ?? 0) / (k.lines_accepted ?? 1)
      }))
      .sort((a, b) => a.usdPerLine - b.usdPerLine);
    const cheapest = ranked[0];
    const priciest = ranked[ranked.length - 1];
    if (cheapest && priciest && cheapest !== priciest) {
      const ratio = priciest.usdPerLine / cheapest.usdPerLine;
      if (ratio > 1.2) {
        insights.push({
          level: 'info',
          title: 'Claude Code Keys: Effizienz-Vergleich',
          body: `${cheapest.name}: ${formatUsd(cheapest.usdPerLine)}/Line. ${priciest.name}: ${formatUsd(priciest.usdPerLine)}/Line (${ratio.toFixed(1)}× teurer).`,
          action: 'Wenn beide Keys ähnliche Aufgaben machen, lohnt es sich vielleicht, vorrangig den günstigeren zu verwenden.'
        });
      }
    }
  }

  // -------- All-time grand total context --------
  // Use actual elapsed days for the average — counting "months" by number of
  // billing cycles touched is misleading when tracking just started (3 days
  // of data shouldn't extrapolate to a "monthly average").
  if (allTime && allTime.claude_ai.months.length > 0) {
    const cycles = allTime.claude_ai.months.length;
    const total = allTime.grand_total_eur ?? allTime.claude_ai.total_eur;
    const sinceLabel = allTime.since
      ? new Date(allTime.since).toLocaleDateString('de-DE')
      : '?';
    let body: string;
    if (daysTracked < 14) {
      body = `${formatEur(total)} über ${daysTracked} ${daysTracked === 1 ? 'Tag' : 'Tage'} Tracking — noch zu kurz für einen belastbaren Monatsschnitt.`;
    } else {
      const dailyAvg = total / Math.max(1, daysTracked);
      const monthlyExtrap = dailyAvg * 30;
      body = `${formatEur(total)} über ${daysTracked} Tage (${cycles} ${cycles === 1 ? 'Cycle' : 'Cycles'}). Tagesschnitt ${formatEur(dailyAvg)}, hochgerechnet ca. ${formatEur(monthlyExtrap)}/Monat.`;
    }
    insights.push({
      level: 'info',
      title: `Insgesamt seit ${sinceLabel}`,
      body
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
      body: `${formatEur(grandTotalEur)} (claude.ai ${formatEur(claudeAiTotalEur)} + API ≈ ${formatEur(apiEur)}).`
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
        setAllTime(total);
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
              <h3 className="font-semibold">{ins.title}</h3>
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
