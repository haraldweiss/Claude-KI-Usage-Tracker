// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import { getSummary, getPlanPricing, getAlerts } from '../../services/api';
import {
  CombinedSpendBreakdown,
  PlanPricingRow,
  AlertInfo,
  OpenCodeGoSpend,
  ZaiSpend,
  CodexSpend,
  OpenAiApiSpend,
  OpenCodeApiSpend,
  ClaudeAiSpend
} from '../../types/api';
import { formatEur, formatUsd, formatRelativeTime } from '../../utils/format';

/* ------------------------------------------------------------------ */
/*  Provider definitions                                               */
/* ------------------------------------------------------------------ */

interface ProviderConfig {
  id: string;
  label: string;
  icon: string;
  color: string;
  source: 'server-scraper' | 'extension-sync';
  scrapeUrl?: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'claude_ai', label: 'Claude.ai', icon: '☁️', color: 'bg-orange-500', source: 'server-scraper', scrapeUrl: 'https://claude.ai/settings/usage' },
  { id: 'anthropic_api', label: 'Anthropic API', icon: '🔑', color: 'bg-blue-600', source: 'extension-sync', scrapeUrl: 'https://platform.claude.com/settings/keys' },
  { id: 'opencode_go', label: 'OpenCode Go', icon: '⚡', color: 'bg-emerald-600', source: 'extension-sync', scrapeUrl: 'https://opencode.ai/workspace/…/go' },
  { id: 'zai', label: 'z.ai (GLM)', icon: '🧠', color: 'bg-purple-600', source: 'extension-sync', scrapeUrl: 'https://z.ai/manage-apikey/coding-plan/personal/my-plan' },
  { id: 'codex', label: 'Codex (ChatGPT)', icon: '💬', color: 'bg-green-600', source: 'server-scraper', scrapeUrl: 'https://chatgpt.com/codex/settings/usage' },
  { id: 'openai_api', label: 'OpenAI API', icon: '🟢', color: 'bg-teal-600', source: 'server-scraper', scrapeUrl: 'https://platform.openai.com/usage' },
  { id: 'opencode_api', label: 'OpenCode API', icon: '🔌', color: 'bg-sky-600', source: 'extension-sync', scrapeUrl: 'https://opencode.ai/…/usage' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type ProviderStatus = 'active' | 'not_subscribed' | 'no_data' | 'no_plan' | 'login_required';

interface ProviderState {
  planName: string | null;
  status: ProviderStatus;
  monthlyEur: number;
  monthlyUsd?: number;
  lastSynced: string | null;
  detail: string;
}

function providerStatus(
  claudeAi: ClaudeAiSpend | null | undefined,
  opencodeGo: OpenCodeGoSpend | null | undefined,
  zai: ZaiSpend | null | undefined,
  codex: CodexSpend | null | undefined,
  openaiApi: OpenAiApiSpend | null | undefined,
  opencodeApi: OpenCodeApiSpend | null | undefined,
  alerts: AlertInfo | null | undefined
): Record<string, ProviderState> {
  const meta = claudeAi?.meta;
  const claudeStatus: ProviderStatus = meta?.plan_name
    ? 'active'
    : claudeAi?.cost_eur != null
      ? 'active'
      : 'not_subscribed';

  return {
    claude_ai: {
      planName: meta?.plan_name ?? null,
      status: claudeStatus,
      monthlyEur: claudeAi?.cost_eur ?? 0,
      lastSynced: claudeAi?.last_synced ?? null,
      detail: meta?.spent_pct != null ? `${meta.spent_pct}% genutzt`
            : meta?.balance_eur != null ? `Guthaben ${formatEur(meta.balance_eur)}`
            : 'Kein aktives Abo',
    },
    anthropic_api: {
      planName: 'API (Pay-as-you-go)',
      status: 'active',
      monthlyEur: 0,
      monthlyUsd: 0,
      lastSynced: null,
      detail: alerts
        ? `Guthaben ${formatUsd(alerts.balance_usd ?? 0)} · Heute ${formatUsd(alerts.today_cost_usd)}`
        : 'Nutzungsdaten vorhanden',
    },
    opencode_go: {
      planName: opencodeGo?.plan_name && opencodeGo.plan_name !== 'Unknown' ? opencodeGo.plan_name : 'OpenCode Go',
      status: opencodeGo ? 'active' : 'no_data',
      monthlyEur: 0,
      lastSynced: opencodeGo?.last_synced ?? null,
      detail: opencodeGo
        ? `Fortlaufend ${opencodeGo.continuous_pct ?? '?'}% · Wöchentlich ${opencodeGo.weekly_pct ?? '?'}%`
        : 'Keine Sync-Daten',
    },
    zai: {
      planName: zai?.plan_name ?? 'GLM Coding Plan',
      status: zai ? 'active' : 'no_data',
      monthlyEur: 0,
      lastSynced: zai?.last_synced ?? null,
      detail: zai
        ? `5h ${zai.five_hour_pct ?? 0}% · Wöchentlich ${zai.weekly_pct ?? 0}%`
        : 'Keine Sync-Daten',
    },
    codex: {
      planName: codex?.plan_name && codex.plan_name !== 'Unknown' ? codex.plan_name : 'ChatGPT Plus',
      status: codex ? 'active' : 'no_data',
      monthlyEur: codex?.plan_cost_eur ?? 0,
      lastSynced: codex?.last_synced ?? null,
      detail: codex
        ? `5h ${100 - (codex.five_hour_remaining_pct ?? 100)}% · Wöchentlich ${100 - (codex.weekly_remaining_pct ?? 100)}%`
        : 'Keine Sync-Daten',
    },
    openai_api: {
      planName: openaiApi?.organization_name || 'OpenAI',
      status: openaiApi ? 'active' : 'no_data',
      monthlyEur: 0,
      monthlyUsd: openaiApi?.cost_usd,
      lastSynced: openaiApi?.last_synced ?? null,
      detail: openaiApi
        ? `${(openaiApi.total_input_tokens / 1000).toFixed(0)}K In · ${(openaiApi.total_output_tokens / 1000).toFixed(0)}K Out`
        : 'Keine Daten',
    },
    opencode_api: {
      planName: 'OpenCode API',
      status: opencodeApi ? 'active' : 'no_data',
      monthlyEur: 0,
      monthlyUsd: opencodeApi?.total_cost_usd,
      lastSynced: null,
      detail: opencodeApi
        ? `${opencodeApi.by_key.length} Keys · ${(opencodeApi.total_input_tokens / 1000).toFixed(0)}K Tokens`
        : 'Keine Daten',
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Single provider card                                               */
/* ------------------------------------------------------------------ */

function ProviderCard({
  provider,
  state,
  allPlans,
}: {
  provider: ProviderConfig;
  state: ProviderState;
  allPlans: PlanPricingRow[];
}): React.ReactElement {
  const statusColors: Record<ProviderStatus, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    not_subscribed: 'bg-gray-100 text-gray-500',
    no_data: 'bg-gray-100 text-gray-400',
    no_plan: 'bg-amber-100 text-amber-700',
    login_required: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<ProviderStatus, string> = {
    active: 'Aktiv',
    not_subscribed: 'Nicht abonniert',
    no_data: 'Keine Daten',
    no_plan: 'Kein Plan',
    login_required: 'Anmeldung nötig',
  };

  const matchingPlan = state.planName
    ? allPlans.find((p) => p.plan_name === state.planName)
    : null;
  const displayEur = state.monthlyEur > 0 ? state.monthlyEur : matchingPlan?.monthly_eur ?? 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className={`${provider.color} px-4 py-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2 text-white min-w-0">
          <span className="text-lg shrink-0">{provider.icon}</span>
          <span className="font-semibold text-sm truncate">{provider.label}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColors[state.status]}`}>
          {statusLabels[state.status]}
        </span>
      </div>

      <div className="p-4 space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-gray-500 shrink-0">Plan</span>
          <span className="font-medium text-gray-900 truncate text-right" title={state.planName ?? undefined}>
            {state.planName || '—'}
          </span>
        </div>

        <div className="flex justify-between gap-2">
          <span className="text-gray-500 shrink-0">Kosten</span>
          <span className="font-medium text-gray-900 text-right">
            {displayEur > 0
              ? `${formatEur(displayEur)}/Monat`
              : state.monthlyUsd != null && state.monthlyUsd > 0
                ? `${formatUsd(state.monthlyUsd)} MTD`
                : '—'}
          </span>
        </div>

        {state.detail && (
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 shrink-0">Status</span>
            <span className="text-gray-700 truncate text-right max-w-[180px]" title={state.detail}>
              {state.detail}
            </span>
          </div>
        )}

        {state.lastSynced && (
          <div className="flex justify-between gap-2">
            <span className="text-gray-500 shrink-0">Letzter Sync</span>
            <span className="text-gray-600 text-xs text-right">{formatRelativeTime(state.lastSynced)}</span>
          </div>
        )}

        <div className="flex justify-between gap-2">
          <span className="text-gray-500 shrink-0">Quelle</span>
          <span className="text-xs text-gray-400 text-right">
            {provider.source === 'server-scraper' ? '🤖 Server' : '🔐 Extension'}
          </span>
        </div>

        {provider.scrapeUrl && (
          <div className="pt-1">
            <a
              href={provider.scrapeUrl}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline truncate block"
              title={provider.scrapeUrl}
            >
              {provider.scrapeUrl}
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
  const [combined, setCombined] = useState<CombinedSpendBreakdown | null>(null);
  const [plans, setPlans] = useState<PlanPricingRow[]>([]);
  const [alerts, setAlerts] = useState<AlertInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [summary, planRes, alertInfo] = await Promise.all([
          getSummary('month'),
          getPlanPricing(),
          getAlerts(),
        ]);
        if (cancelled) return;
        setCombined(summary.combined ?? null);
        setPlans(planRes.plans);
        setAlerts(alertInfo);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Fehler beim Laden: {error}
      </div>
    );
  }

  const claudeAi = combined?.claude_ai ?? null;
  const opencodeGo = combined?.opencode_go ?? null;
  const zai = combined?.zai ?? null;
  const codex = combined?.codex ?? null;
  const openaiApi = combined?.openai_api ?? null;
  const opencodeApi = combined?.opencode_api ?? null;
  const anthropicApiCost = combined?.anthropic_api?.cost_usd ?? 0;

  const states = providerStatus(claudeAi, opencodeGo, zai, codex, openaiApi, opencodeApi, alerts);

  if (anthropicApiCost > 0) {
    states.anthropic_api.monthlyUsd = anthropicApiCost;
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Provider-Übersicht</h2>
        <p className="text-sm text-gray-500 mb-4">
          Status, Pläne und Konfiguration aller angebundenen KI-Dienste.
        </p>
        <div className="text-center py-8 text-gray-500">Lade Provider-Daten…</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Provider-Übersicht</h2>
        <p className="text-gray-600 text-sm mt-1">
          Alle angebundenen KI-Dienste auf einen Blick. Status wird aus aktuell gescrapten
          Daten ermittelt. Pläne können unten in den Plan-Preisen konfiguriert werden.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {PROVIDERS.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            state={states[provider.id]}
            allPlans={plans}
          />
        ))}
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
          Datenquellen-Legende
        </summary>
        <div className="mt-2 space-y-1 text-xs text-gray-500">
          <p>🤖 <strong>Server (Playwright)</strong> — Läuft auf der Oracle-VM, nutzt exportierte Cookies. Taktrate: alle 2h via systemd-Timer.</p>
          <p>🔐 <strong>Extension (Tab)</strong> — Läuft im Chrome-Browser, öffnet kurz ein Tab, scraped via executeScript. Per Klick auf "Sync geschützte Quellen" im Popup.</p>
        </div>
      </details>
    </div>
  );
}
