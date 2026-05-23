// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useState } from 'react';
import {
  getProviderServiceConfig,
  updateProviderServiceConfig,
  triggerLocalUsageSync,
  addProviderUserId,
  removeProviderUserId,
  updateProviderUserId,
  type ProviderServiceConfig,
  type ProviderUserIdRow,
} from '../../services/localUsageApi';

export default function ProviderServiceSettings(): React.ReactElement {
  const [cfg, setCfg] = useState<ProviderServiceConfig | null>(null);
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceToken, setServiceToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [newIdInput, setNewIdInput] = useState('');
  const [newLabelInput, setNewLabelInput] = useState('');
  const [addingId, setAddingId] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    void reload();
  }, []);

  async function reload(): Promise<void> {
    const c = await getProviderServiceConfig();
    setCfg(c);
    if (c.configured) {
      setServiceUrl(c.service_url ?? '');
      setEnabled(c.enabled ?? true);
    }
  }

  async function handleSaveConnection(): Promise<void> {
    setSaving(true);
    setFeedback(null);
    try {
      await updateProviderServiceConfig({
        service_url: serviceUrl.trim(),
        service_token: serviceToken || undefined,
        enabled,
      });
      setServiceToken('');
      await reload();
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
        const failedIds = r.perId.filter((p) => !p.ok).map((p) => p.providerUserId).join(', ');
        setFeedback(`Teilweise fehlgeschlagen: ${failedIds}`);
      }
      await reload();
    } catch (e) {
      setFeedback(`Fehler: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleAddId(): Promise<void> {
    if (!newIdInput.trim()) return;
    setAddingId(true);
    setAddError(null);
    try {
      await addProviderUserId({
        provider_user_id: newIdInput.trim(),
        label: newLabelInput.trim() || undefined,
      });
      setNewIdInput('');
      setNewLabelInput('');
      await reload();
    } catch (e) {
      const msg = (e as Error).message;
      setAddError(/409/.test(msg) ? 'Bereits konfiguriert.' : `Fehler: ${msg}`);
    } finally {
      setAddingId(false);
    }
  }

  async function handleDeleteId(row: ProviderUserIdRow): Promise<void> {
    if (!confirm(`user_id "${row.provider_user_id}" wirklich entfernen?`)) return;
    await removeProviderUserId(row.id);
    await reload();
  }

  async function handlePatchId(
    row: ProviderUserIdRow,
    patch: { label?: string | null; enabled?: boolean },
  ): Promise<void> {
    await updateProviderUserId(row.id, patch);
    await reload();
  }

  return (
    <section className="bg-white rounded-lg shadow p-4 mb-4">
      <h2 className="text-lg font-semibold mb-3">AI-Provider-Service</h2>
      <p className="text-xs text-gray-500 mb-3">
        Verbinde diesen Tracker mit deinem ai-provider-service, um lokale
        LLM-Aufrufe sichtbar zu machen.
      </p>

      {/* Connection */}
      <div className="space-y-3 mb-6">
        <h3 className="text-sm font-medium text-gray-700">Verbindung</h3>
        <div>
          <label className="block text-sm font-medium mb-1">Service-URL</label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1 text-sm"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            placeholder="http://127.0.0.1:8767"
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
            onClick={handleSaveConnection}
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
      </div>

      {/* user_ids list */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Verbundene user_ids</h3>

        <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="provider_user_id"
              className="flex-1 border rounded px-2 py-1 text-sm font-mono"
              value={newIdInput}
              onChange={(e) => setNewIdInput(e.target.value)}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              className="flex-1 border rounded px-2 py-1 text-sm"
              value={newLabelInput}
              onChange={(e) => setNewLabelInput(e.target.value)}
            />
            <button
              onClick={handleAddId}
              disabled={addingId || !newIdInput.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
            >
              + Hinzufügen
            </button>
          </div>
          {addError && (
            <div className="mt-2 text-red-700 text-xs">{addError}</div>
          )}
        </div>

        {cfg?.user_ids?.length === 0 && (
          <p className="text-sm text-gray-500 italic">
            Noch keine user_ids konfiguriert.
          </p>
        )}
        <ul className="space-y-2">
          {cfg?.user_ids?.map((row) => (
            <li key={row.id} className="border border-gray-200 rounded p-3 bg-white">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                  <input
                    type="text"
                    placeholder="Label"
                    className="w-full border rounded px-2 py-1 text-sm"
                    defaultValue={row.label ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (row.label ?? '')) {
                        void handlePatchId(row, { label: v.length > 0 ? v : null });
                      }
                    }}
                  />
                  <div className="text-xs font-mono text-gray-500 break-all">
                    {row.provider_user_id}
                  </div>
                  <div className="text-xs text-gray-500">
                    Letzter Sync: {row.last_sync_at ?? '—'}
                  </div>
                  {row.last_sync_error && (
                    <div className="text-xs text-red-600">
                      Fehler: {row.last_sync_error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        void handlePatchId(row, { enabled: e.target.checked })
                      }
                    />
                    Aktiv
                  </label>
                  <button
                    onClick={() => void handleDeleteId(row)}
                    className="text-red-600 hover:text-red-700 text-xs"
                    aria-label="Entfernen"
                  >
                    Entfernen
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
