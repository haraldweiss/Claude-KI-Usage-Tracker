// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState, useCallback } from 'react';
import { getProviders, updateProvider, getPlanPricing } from '../../services/api';
import { ProviderInfo, PlanPricingRow } from '../../types/api';
import { formatEur, formatUsd, formatRelativeTime } from '../../utils/format';

/* ------------------------------------------------------------------ */
/*  Plan grouping helpers                                              */
/* ------------------------------------------------------------------ */

function planGroupName(plan: PlanPricingRow): string {
  if (plan.monthly_eur === 0) return 'free';
  if (plan.plan_name.startsWith('Cline Pass')) return 'cline_pass';
  if (plan.plan_name.startsWith('ChatGPT')) return 'chatgpt';
  if (plan.plan_name.startsWith('GLM Coding')) return 'zai';
  if (['Pro', 'Max (5x)', 'Max (20x)', 'Team'].includes(plan.plan_name)) return 'anthropic';
  return 'other';
}

const PLAN_GROUP_LABELS: Record<string, string> = {
  free: 'Kostenlos',
  cline_pass: 'Cline Pass',
  chatgpt: 'ChatGPT',
  zai: 'z.ai GLM',
  anthropic: 'Anthropic',
  other: 'Weitere',
};

const PLAN_GROUP_ORDER = ['free', 'cline_pass', 'chatgpt', 'zai', 'anthropic', 'other'];

/* ------------------------------------------------------------------ */
/*  Provider → allowed plan groups mapping                             */
/*  Each provider only shows plans relevant to it.                     */
/* ------------------------------------------------------------------ */

const PROVIDER_ALLOWED_PLAN_GROUPS: Record<string, string[]> = {
  claude_ai:       ['anthropic'],
  anthropic_api:   ['anthropic'],
  claude_code:     ['anthropic'],
  opencode_go:     ['free'],
  opencode_api:    ['free'],
  zai:             ['zai'],
  codex:           ['chatgpt'],
  openai_api:      ['free'],
  cline:           ['cline_pass'],
};

/* ------------------------------------------------------------------ */
/*  Provider definitions (icons + colors + group, rest comes from API) */
/* ------------------------------------------------------------------ */

const PROVIDER_META: Record<string, { icon: string; color: string; group: string; scrapeUrl?: string }> = {
  opencode_go:     { icon: '⚡', color: 'bg-emerald-600', group: 'free', scrapeUrl: 'https://opencode.ai/workspace/…/go' },
  claude_ai:       { icon: '☁️', color: 'bg-orange-500', group: 'subscription', scrapeUrl: 'https://claude.ai/settings/usage' },
  codex:           { icon: '💬', color: 'bg-green-600', group: 'subscription', scrapeUrl: 'https://chatgpt.com/codex/settings/usage' },
  zai:             { icon: '🧠', color: 'bg-purple-600', group: 'subscription', scrapeUrl: 'https://z.ai/manage-apikey/coding-plan/personal/my-plan' },
  cline:           { icon: '🤖', color: 'bg-violet-500', group: 'subscription', scrapeUrl: '' },
  anthropic_api:   { icon: '🔑', color: 'bg-blue-600', group: 'api', scrapeUrl: 'https://platform.claude.com/settings/keys' },
  claude_code:     { icon: '💻', color: 'bg-indigo-600', group: 'api', scrapeUrl: 'https://platform.claude.com/claude-code/usage' },
  opencode_api:    { icon: '🔌', color: 'bg-sky-600', group: 'api', scrapeUrl: 'https://opencode.ai/…/usage' },
  openai_api:      { icon: '🟢', color: 'bg-teal-600', group: 'api', scrapeUrl: 'https://platform.openai.com/usage' },
};

const PROVIDER_GROUP_LABELS: Record<string, string> = {
  free: 'Kostenlose Anbieter',
  subscription: 'Abonnement-Anbieter',
  api: 'API-Verbrauch',
};

const PROVIDER_GROUP_ORDER = ['free', 'subscription', 'api'];

/* ------------------------------------------------------------------ */
/*  Derived status → display helpers                                   */
/* ------------------------------------------------------------------ */

type DisplayStatus = 'active' | 'not_subscribed' | 'no_data' | 'no_plan';

function displayStatus(derived: ProviderInfo['derived_status'], planName: string | null): DisplayStatus {
  if (planName) return 'active';
  if (derived === 'active') return 'active';
  if (derived === 'no_plan') return 'not_subscribed';
  return 'no_data';
}

const STATUS_STYLES: Record<DisplayStatus, string> = {
  active:          'bg-emerald-100 text-emerald-700',
  not_subscribed:  'bg-gray-100 text-gray-500',
  no_data:         'bg-gray-100 text-gray-400',
  no_plan:         'bg-amber-100 text-amber-700',
};
const STATUS_LABELS: Record<DisplayStatus, string> = {
  active:          'Aktiv',
  not_subscribed:  'Nicht abonniert',
  no_data:         'Keine Daten',
  no_plan:         'Kein Plan',
};

/* ------------------------------------------------------------------ */
/*  Format scrape_summary into a readable detail string                */
/* ------------------------------------------------------------------ */

function formatDetail(key: string, summary: Record<string, unknown> | null): string {
  if (!summary) return '—';
  const s = summary;
  switch (key) {
    case 'claude_ai':
      return s.spent_eur != null
        ? `${formatEur(s.spent_eur as number)} · Session ${s.session_pct ?? '?'}%`
        : s.reset_date ? `Reset ${s.reset_date}` : '—';
    case 'anthropic_api':
      return s.total_cost_usd != null
        ? `${formatUsd(s.total_cost_usd as number)} · ${s.workspace_count ?? 0} Workspaces`
        : '—';
    case 'claude_code':
      return s.total_cost_usd != null
        ? `${formatUsd(s.total_cost_usd as number)} · ${s.keys_count ?? 0} Keys`
        : '—';
    case 'opencode_go':
      return `Cont ${s.continuous_pct ?? '?'}% · Wo ${s.weekly_pct ?? '?'}% · Mo ${s.monthly_pct ?? '?'}%`;
    case 'opencode_api':
      return s.total_cost_usd != null
        ? `${formatUsd(s.total_cost_usd as number)} · ${s.total_requests ?? 0} Requests`
        : '—';
    case 'zai':
      return `5h ${s.five_hour_pct ?? 0}% · Wo ${s.weekly_pct ?? 0}%`;
    case 'codex':
      return s.five_hour_remaining_pct != null
        ? `5h ${100 - (s.five_hour_remaining_pct as number)}% · Wo ${100 - (s.weekly_remaining_pct as number ?? 100)}% · Mo ${100 - (s.monthly_remaining_pct as number ?? 100)}%`
        : '—';
    case 'openai_api':
      return s.total_cost_usd != null
        ? `${formatUsd(s.total_cost_usd as number)} · ${s.organization ?? '—'}`
        : '—';
    default:
      return '—';
  }
}

/* ------------------------------------------------------------------ */
/*  Cost extraction from scrape_summary + plan_pricing                 */
/* ------------------------------------------------------------------ */

function formatCost(
  summary: Record<string, unknown> | null,
  allPlans: PlanPricingRow[],
  configPlanName: string | null
): string {
  // First: try user-set plan_name → plan_pricing lookup
  if (configPlanName) {
    const match = allPlans.find((p) => p.plan_name === configPlanName);
    if (match && match.monthly_eur > 0) return `${formatEur(match.monthly_eur)}/Monat`;
  }

  // Second: try scrape_summary cost fields
  if (!summary) return '—';
  const s = summary;
  const usd = s.total_cost_usd as number | undefined;
  if (usd && usd > 0) return `${formatUsd(usd)} MTD`;
  const eur = s.spent_eur as number | undefined;
  if (eur && eur > 0) return `${formatEur(eur)} MTD`;
  const priceUsd = s.price_usd as number | undefined;
  if (priceUsd && priceUsd > 0) return `${formatUsd(priceUsd)}/Monat`;

  return '—';
}

/* ------------------------------------------------------------------ */
/*  Single provider card                                               */
/* ------------------------------------------------------------------ */

function ProviderCard({
  provider,
  allPlans,
  onPlanChange,
  saving,
}: {
  provider: ProviderInfo;
  allPlans: PlanPricingRow[];
  onPlanChange: (key: string, planName: string | null) => void;
  saving: boolean;
}): React.ReactElement {
  const meta = PROVIDER_META[provider.key] ?? { icon: '❓', color: 'bg-gray-500' };
  const dStatus = displayStatus(provider.derived_status, provider.plan_name);
  const detail = formatDetail(provider.key, provider.scrape_summary);
  const cost = formatCost(provider.scrape_summary, allPlans, provider.plan_name);

  // Remove duplicates and group plans for dropdown
  const uniquePlans = allPlans.filter((p, i, a) => a.findIndex((x) => x.plan_name === p.plan_name) === i);
  const groupedPlans = uniquePlans.reduce((acc, p) => {
    const g = planGroupName(p);
    (acc[g] = acc[g] || []).push(p);
    return acc;
  }, {} as Record<string, PlanPricingRow[]>);
  // Sort within each group by price ascending
  for (const g of Object.keys(groupedPlans)) {
    groupedPlans[g].sort((a, b) => a.monthly_eur - b.monthly_eur);
  }

  const currentPlan = provider.plan_name || '';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
      {/* Header */}
      <div className={`${meta.color} px-4 py-2.5 flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2 text-white min-w-0">
          <span className="text-lg shrink-0">{meta.icon}</span>
          <span className="font-semibold text-sm truncate">{provider.display_name}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_STYLES[dStatus]}`}>
          {STATUS_LABELS[dStatus]}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-2 text-sm flex-1 flex flex-col justify-between">
        {/* Plan selector */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Plan</label>
          <div className="flex gap-1">
            <select
              value={currentPlan}
              onChange={(e) => {
                const val = e.target.value || null;
                if (val !== provider.plan_name) onPlanChange(provider.key, val);
              }}
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 bg-white disabled:opacity-50"
              title={currentPlan || '—'}
              disabled={saving}
            >
              <option value="">— Kein Plan —</option>
              {(PROVIDER_ALLOWED_PLAN_GROUPS[provider.key] ?? PLAN_GROUP_ORDER).map((g) => {
                const plans = groupedPlans[g];
                if (!plans || plans.length === 0) return null;
                return (
                  <optgroup key={g} label={PLAN_GROUP_LABELS[g] ?? g}>
                    {plans.map((p) => (
                      <option key={p.plan_name} value={p.plan_name}>
                        {p.plan_name} ({formatEur(p.monthly_eur)}/M)
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        </div>

        {/* Cost */}
        <div className="flex justify-between gap-2">
          <span className="text-gray-500 shrink-0">Kosten</span>
          <span className="font-medium text-gray-900 text-right truncate max-w-[160px]" title={cost}>
            {cost}
          </span>
        </div>

        {/* Detail (scraped data) */}
        <div className="flex justify-between gap-2">
          <span className="text-gray-500 shrink-0">Nutzung</span>
          <span className="text-gray-700 text-right truncate max-w-[160px]" title={detail}>
            {detail}
          </span>
        </div>

        {/* Last sync */}
        {provider.last_sync && (
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 shrink-0">Sync</span>
            <span className="text-gray-600 text-xs text-right">
              {formatRelativeTime(provider.last_sync)}
            </span>
          </div>
        )}

        {/* Scrape URL */}
        {meta.scrapeUrl && (
          <div className="pt-1">
            <a href={meta.scrapeUrl} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-blue-500 hover:underline truncate block"
              title={meta.scrapeUrl}>
              {meta.scrapeUrl}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main section component                                             */
/* ------------------------------------------------------------------ */

export default function ProviderSettingsSection(): React.ReactElement {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // provider key being saved
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [provRes, planRes] = await Promise.all([getProviders(), getPlanPricing()]);
      setProviders(provRes.providers);
      setPlans(planRes.plans);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePlanChange = useCallback(async (key: string, planName: string | null) => {
    setSaving(key);
    try {
      await updateProvider(key, { plan_name: planName });
      // Reload to get fresh data from backend
      await load();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('Fehler beim Speichern: ' + (err instanceof Error ? err.message : 'unbekannt'));
    } finally {
      setSaving(null);
    }
  }, [load]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Fehler beim Laden: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Provider-Übersicht</h2>
        <p className="text-sm text-gray-500 mb-4">Status, Pläne und Konfiguration aller angebundenen KI-Dienste.</p>
        <div className="text-center py-8 text-gray-500">Lade Provider-Daten…</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Provider-Übersicht</h2>
        <p className="text-gray-600 text-sm mt-1">
          Pro Provider den gebuchten Plan auswählen. Der Status wird aus den aktuell gescrapten
          Daten ermittelt. Die Preise kommen aus der Plan-Tabelle weiter unten.
        </p>
      </div>

      {PROVIDER_GROUP_ORDER.map((g) => {
        const groupProviders = providers.filter((p) => (PROVIDER_META[p.key]?.group ?? 'api') === g);
        if (groupProviders.length === 0) return null;
        return (
          <div key={g} className="mb-6 last:mb-0">
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
              {PROVIDER_GROUP_LABELS[g] ?? g}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {groupProviders.map((provider) => (
                <ProviderCard
                  key={provider.key}
                  provider={provider}
                  allPlans={plans}
                  onPlanChange={handlePlanChange}
                  saving={saving === provider.key}
                />
              ))}
            </div>
          </div>
        );
      })}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
          Datenquellen-Legende
        </summary>
        <div className="mt-2 space-y-1 text-xs text-gray-500">
          <p><strong>Status</strong> — Grün = aktiv (Plan zugewiesen oder Kosten vorhanden). Grau "Nicht abonniert" = kein aktiver Plan. Grau "Keine Daten" = noch nie gesynct.</p>
          <p><strong>Plan</strong> — Dropdown mit allen bekannten Abos. Auswahl wird in der Datenbank gespeichert und beim nächsten Dashboard-Besuch verwendet.</p>
          <p><strong>Nutzung</strong> — Live-Daten aus dem letzten Scrape. "—" bedeutet keine Nutzungsdaten in der aktuellen Abrechnungsperiode.</p>
        </div>
      </details>
    </div>
  );
}
