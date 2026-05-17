// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getLocalUsageSummary,
  getLocalUsageSyncStatus,
  type LocalUsageSummary,
  type SyncStatus,
} from '../services/localUsageApi';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
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
      .catch(() => {
        // Silent — card falls back to empty / unconfigured rendering.
      })
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

  const s = summary;
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Lokale LLM-Nutzung</h3>
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
            provider-service
          </span>
        </div>
      </div>

      {status.last_sync_error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-xs p-2 mb-3 rounded">
          Sync-Fehler: {status.last_sync_error}
        </div>
      )}

      {s && s.calls === 0 ? (
        <p className="text-sm text-gray-600">Noch keine Calls in diesem Monat.</p>
      ) : s ? (
        <>
          <div className="text-3xl font-bold text-blue-600 mb-1">
            {formatNumber(s.totalTokens)}{' '}
            <span className="text-base font-normal text-gray-700">Tokens</span>
          </div>
          <div className="text-sm text-gray-600 mb-1">
            In: {formatNumber(s.inputTokens)} · Out: {formatNumber(s.outputTokens)}
          </div>
          <div className="text-sm text-gray-600 mb-3">
            {formatNumber(s.calls)} Calls · ⌀ {formatNumber(s.avgTokensPerCall)} Tok/Call
          </div>

          {s.topModels.length > 0 && (
            <ul className="text-xs text-gray-700 space-y-0.5">
              {s.topModels.map((m) => (
                <li key={m.model}>
                  <span className="font-mono">{m.model}</span> · {formatNumber(m.calls)} Calls
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
