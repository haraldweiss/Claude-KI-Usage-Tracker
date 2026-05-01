import React, { useEffect, useState } from 'react';
import { getApiToken, rotateApiToken, revokeApiToken } from '../../services/api';
import type { ApiTokenInfo } from '../../types/api';

export default function ApiTokenSection(): React.ReactElement {
  const [token, setToken] = useState<ApiTokenInfo | null | undefined>(undefined);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => getApiToken().then(setToken);
  useEffect(() => { load(); }, []);

  const rotate = async () => {
    if (token && !window.confirm('Aktuellen Token rotieren? Bestehende Extension-Verbindungen brechen.')) return;
    setBusy(true);
    try {
      const r = await rotateApiToken('Browser Extension');
      setPlaintext(r.token);
      await load();
    } finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!window.confirm('Token endgültig widerrufen? Extension-Verbindung bricht.')) return;
    setBusy(true);
    try { await revokeApiToken(); setPlaintext(null); await load(); }
    finally { setBusy(false); }
  };

  if (token === undefined) return <div className="text-gray-500">Lade…</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">API-Token (für Extension)</h2>
      <p className="text-sm text-gray-600 mb-4">
        Die Browser-Extension nutzt diesen Token zum Authentifizieren am Backend.
        Nur ein aktiver Token pro User. Beim Rotieren bricht die alte Verbindung.
      </p>

      {plaintext && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded">
          <p className="text-sm text-amber-900 font-semibold mb-2">⚠️ Token nur jetzt sichtbar — kopieren!</p>
          <code className="block bg-white p-2 border rounded font-mono text-sm break-all">{plaintext}</code>
          <button onClick={() => navigator.clipboard.writeText(plaintext)}
            className="mt-2 text-xs text-blue-600 hover:underline">Kopieren</button>
        </div>
      )}

      {token ? (
        <div>
          <p className="text-sm">Status: <span className="text-green-600 font-medium">● Aktiv</span></p>
          <p className="text-sm text-gray-500">Erstellt: {new Date(token.created_at).toLocaleString('de-DE')}</p>
          <p className="text-sm text-gray-500">Zuletzt benutzt: {token.last_used_at ? new Date(token.last_used_at).toLocaleString('de-DE') : 'noch nie'}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={rotate} disabled={busy} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Rotieren</button>
            <button onClick={revoke} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700">Widerrufen</button>
          </div>
        </div>
      ) : (
        <button onClick={rotate} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Token erzeugen
        </button>
      )}
    </div>
  );
}
