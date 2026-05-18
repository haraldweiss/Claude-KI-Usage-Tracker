// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useEffect, useRef, useState } from 'react';
import {
  getCurated,
  searchCatalog,
  getInstalled,
  isInstalled as checkInstalled,
  type CuratedResponse,
  type ModelCard as ModelCardType,
} from '../services/catalogApi';
import ModelCard from '../components/ModelCard';
import CatalogSection from '../components/CatalogSection';

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return iso;
  const diffMin = Math.round((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  return `vor ${diffD} ${diffD === 1 ? 'Tag' : 'Tagen'}`;
}

export default function CatalogPage(): React.ReactElement {
  const [curated, setCurated] = useState<CuratedResponse | null>(null);
  const [installedNames, setInstalledNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ModelCardType[] | null>(null);
  const [searchStale, setSearchStale] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    void Promise.all([getCurated(), getInstalled()]).then(([c, inst]) => {
      setCurated(c);
      setInstalledNames(inst.models);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setSearchResults(null);
      setSearchStale(false);
      setSearchError(null);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearching(true);
      setSearchError(null);
      searchCatalog(q, 50, ctrl.signal)
        .then((r) => {
          setSearchResults(r.results);
          setSearchStale(r.stale ?? false);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setSearchError((e as Error).message);
          setSearchResults([]);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Modell-Katalog</h1>
      <p className="text-sm text-gray-600 mb-4">
        Stöbere durch Hugging Face GGUF-Modelle und kopiere den{' '}
        <code className="font-mono">ollama run …</code>-Befehl, um sie auf
        deinem Ollama auszuprobieren.
      </p>

      <div className="mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Suche in HF GGUF Modellen…"
          className="w-full border rounded px-3 py-2 text-sm"
        />
      </div>

      <div className="mb-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">
        💡 <strong>Hinweis:</strong> Nicht alle{' '}
        <code className="font-mono">hf.co/…</code>-Pulls klappen sauber — wenn
        Ollama "not compatible with llama.cpp" meldet, gibt es das Modell oft
        auch direkt in der offiziellen{' '}
        <a
          href="https://ollama.com/library"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          Ollama-Library
        </a>{' '}
        (z.B. <code className="font-mono">ollama run deepseek-r1:8b</code>).
      </div>

      {searchStale && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs p-2 rounded mb-3">
          Daten älter als 30 min — HF gerade nicht erreichbar.
        </div>
      )}

      {searchResults !== null ? (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Such-Treffer für „{query}" ({searchResults.length})
          </h2>
          {searching && <div className="text-sm text-gray-500">Suche läuft…</div>}
          {searchError && (
            <div className="text-sm text-red-700">Fehler: {searchError}</div>
          )}
          {searchResults.length === 0 && !searching && (
            <div className="text-sm text-gray-500 italic">
              Keine Modelle gefunden.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults.map((card) => (
              <ModelCard
                key={card.repo}
                card={card}
                isInstalled={checkInstalled(installedNames, card.repo)}
              />
            ))}
          </div>
        </section>
      ) : curated ? (
        <>
          {curated.sections.map((s) => (
            <CatalogSection key={s.key} section={s} installedNames={installedNames} />
          ))}
        </>
      ) : (
        <div className="text-sm text-gray-500">Lade Katalog…</div>
      )}

      {curated?.fetched_at && (
        <div className="mt-8 text-xs text-gray-400 text-right">
          Daten von Hugging Face — letzte Aktualisierung: {relativeTime(curated.fetched_at)}
        </div>
      )}
    </div>
  );
}
