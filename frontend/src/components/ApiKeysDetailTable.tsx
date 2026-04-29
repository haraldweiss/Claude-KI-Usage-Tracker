import React, { useEffect, useState } from 'react';
import { getConsoleKeys } from '../services/api';
import { ConsoleKeyRecord } from '../types/api';

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

interface Props {
  /**
   * Optional pre-fetched keys. If omitted, the component fetches them itself.
   * Lets the Combined Cost tab pass the data it already loaded for the
   * dashboard (avoids a duplicate request) while the Models tab can drop the
   * component in standalone.
   */
  keys?: ConsoleKeyRecord[];
}

/**
 * Renders the per-key snapshot table that lives on both the Combined Cost
 * and Models tabs. Self-loading when `keys` is not supplied.
 */
export default function ApiKeysDetailTable({ keys: keysProp }: Props): React.ReactElement {
  const [fetchedKeys, setFetchedKeys] = useState<ConsoleKeyRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (keysProp !== undefined) return;
    let cancelled = false;
    getConsoleKeys()
      .then((data) => {
        if (!cancelled) setFetchedKeys(data.keys);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Unknown error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [keysProp]);

  const keys = keysProp ?? fetchedKeys;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h3 className="text-lg font-semibold text-gray-900">API Keys (Detail)</h3>
        <p className="text-sm text-gray-500">
          Letzter Snapshot pro Key aus console.anthropic.com und platform.claude.com/claude-code.
        </p>
      </div>
      {loadError ? (
        <div className="px-6 py-8 text-center text-red-600">{loadError}</div>
      ) : keys === null ? (
        <div className="px-6 py-8 text-center text-gray-500">Lade…</div>
      ) : keys.length === 0 ? (
        <div className="px-6 py-8 text-center text-gray-500">
          Noch kein Sync gelaufen. Logge dich in console.anthropic.com bzw.
          platform.claude.com ein und warte bis zu 24h, oder löse manuell aus.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Key / Member
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Quelle
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Workspace
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                Kosten
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                Lines
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Letzter Sync
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {keys.map((k) => (
              <tr key={`${k.source}-${k.workspace}-${k.key_id_suffix}`} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">
                  {k.key_name || '(unbenannt)'}
                  {k.key_id_suffix && k.source === 'anthropic_console_sync' && (
                    <span className="ml-2 text-xs text-gray-400 font-mono">
                      …{k.key_id_suffix}
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-xs">
                  {k.source === 'claude_code_sync' ? (
                    <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                      Claude Code
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                      Console API
                    </span>
                  )}
                </td>
                <td className="px-6 py-3 text-gray-700">{k.workspace || '—'}</td>
                <td className="px-6 py-3 text-right font-medium text-blue-600">
                  {formatUsd(k.cost_usd ?? 0)}
                </td>
                <td className="px-6 py-3 text-right text-gray-700">
                  {k.lines_accepted != null ? k.lines_accepted.toLocaleString('de-DE') : '—'}
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
  );
}
