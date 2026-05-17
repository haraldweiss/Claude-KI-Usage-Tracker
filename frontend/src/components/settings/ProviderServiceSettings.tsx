// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getProviderServiceConfig,
  updateProviderServiceConfig,
  triggerLocalUsageSync,
  type ProviderServiceConfig,
} from '../../services/localUsageApi';

export default function ProviderServiceSettings(): React.ReactElement {
  const [cfg, setCfg] = useState<ProviderServiceConfig | null>(null);
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceToken, setServiceToken] = useState('');
  const [providerUserId, setProviderUserId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void getProviderServiceConfig().then((c) => {
      setCfg(c);
      if (c.configured) {
        setServiceUrl(c.service_url ?? '');
        setProviderUserId(c.provider_user_id ?? '');
        setEnabled(c.enabled ?? true);
      }
    });
  }, []);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setFeedback(null);
    try {
      await updateProviderServiceConfig({
        service_url: serviceUrl.trim(),
        service_token: serviceToken || undefined,
        provider_user_id: providerUserId.trim(),
        enabled,
      });
      setServiceToken(''); // clear input — token is now stored encrypted
      const refreshed = await getProviderServiceConfig();
      setCfg(refreshed);
      setFeedback('Gespeichert ✓');
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    setFeedback(null);
    try {
      const r = await triggerLocalUsageSync();
      if (r.ok) {
        setFeedback(`Verbindung ok — ${r.newEvents} neue Events erhalten.`);
      } else {
        setFeedback(`Fehler: ${r.error ?? 'unbekannt'}`);
      }
      const refreshed = await getProviderServiceConfig();
      setCfg(refreshed);
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="bg-white rounded-lg shadow p-4 mb-4">
      <h2 className="text-lg font-semibold mb-3">AI-Provider-Service</h2>
      <p className="text-xs text-gray-500 mb-3">
        Verbinde diesen Tracker mit deinem `ai-provider-service`, damit lokale
        LLM-Aufrufe (Ollama / llama.cpp) in der Übersicht sichtbar werden.
      </p>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Service-URL</label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="https://bewerbungen.wolfinisoftware.de/ai-provider"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Service-Token{' '}
            {cfg?.service_token_set && (
              <span className="text-gray-500 font-normal">
                (gesetzt — leer lassen zum Beibehalten)
              </span>
            )}
          </label>
          <input
            type="password"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceToken}
            onChange={(e) => setServiceToken(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Meine user_id im Provider-Service
          </label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-sm"
            value={providerUserId}
            onChange={(e) => setProviderUserId(e.target.value)}
            placeholder="z.B. haraldweiss"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Aktiv
        </label>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !cfg?.configured}
            className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm disabled:opacity-50"
          >
            {testing ? 'Teste…' : 'Verbindung testen'}
          </button>
        </div>

        {feedback && <div className="text-sm text-gray-700">{feedback}</div>}

        {cfg?.configured && (
          <div className="text-xs text-gray-500 pt-2 border-t">
            Letzter Sync: {cfg.last_sync_at ?? '—'}
            {cfg.last_sync_error && (
              <div className="text-red-600 mt-1">Fehler: {cfg.last_sync_error}</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
