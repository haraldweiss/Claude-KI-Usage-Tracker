// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getLocalUsageSummary,
  getLocalUsageSyncStatus,
  type LocalUsageSummary,
  type SyncStatus,
  type SourceSummary,
} from '../services/localUsageApi';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

// For 'user:<provider_user_id>' sources, return the matching per-id last_sync_error
// so we can render it inside that mini-card.
function syncErrorForSource(source: SourceSummary, status: SyncStatus | null): string | null {
  if (!status?.perId) return null;
  if (!source.source.startsWith('user:')) return null;
  const providerUserId = source.source.slice(5);
  const match = status.perId.find((p) => p.provider_user_id === providerUserId);
  return match?.last_sync_error ?? null;
}

function MiniCard({
  source, syncError,
}: { source: SourceSummary; syncError: string | null }): React.ReactElement {
  const isUserFallback = source.source.startsWith('user:');
  const displayLabel = source.label
    ?? (isUserFallback ? source.source.slice(5) : source.source);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate" title={source.source}>
        {displayLabel}
      </div>
      {syncError && (
        <div className="mt-2 bg-red-50 border border-red-200 text-red-800 text-xs p-2 rounded">
          Sync-Fehler: {syncError}
        </div>
      )}
      <div className="mt-2 text-2xl font-bold text-blue-600">
        {formatNumber(source.totalTokens)}
        <span className="text-sm font-normal text-gray-700 ml-1">Tokens</span>
      </div>
      <div className="mt-1 text-xs text-gray-600">
        In: {formatNumber(source.inputTokens)} · Out: {formatNumber(source.outputTokens)}
      </div>
      <div className="mt-1 text-xs text-gray-600">
        {formatNumber(source.calls)} Calls · ⌀ {formatNumber(source.avgTokensPerCall)} Tok/Call
      </div>
      {source.topModel && (
        <div className="mt-2 text-xs text-gray-700">
          <span className="font-mono">{source.topModel.model}</span>{' '}
          <span className="text-gray-500">· {formatNumber(source.topModel.calls)} Calls</span>
        </div>
      )}
    </div>
  );
}

export default function LocalUsageCard(): React.ReactElement {
  const [summary, setSummary] = useState<LocalUsageSummary | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      getLocalUsageSummary('month'),
      getLocalUsageSyncStatus(),
    ])
      .then(([s, st]) => {
        setSummary(s);
        setStatus(st);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-gray-400 text-sm">Lade Lokale LLM-Nutzung…</div>
      </div>
    );
  }

  if (!status || !status.configured) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
          <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">provider-service</span>
        </div>
        <p className="text-sm text-gray-600">
          Noch keine Daten —{' '}
          <a href="/claudetracker/settings" className="text-blue-600 underline">
            konfiguriere den AI-Provider-Service in den Einstellungen
          </a>
          .
        </p>
      </div>
    );
  }

  const hasSources = summary && summary.perSource.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
          provider-service
        </span>
      </div>

      {!hasSources ? (
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Noch keine Calls in diesem Monat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {summary!.perSource.map((s) => (
            <MiniCard
              key={s.source}
              source={s}
              syncError={syncErrorForSource(s, status)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
