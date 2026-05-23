// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useState } from 'react';
import type { ModelCard as ModelCardType } from '../services/catalogApi';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('de-DE').format(n);
}

export default function ModelCard({
  card,
  isInstalled,
}: {
  card: ModelCardType;
  isInstalled: boolean;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(card.ollama_command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = card.ollama_command;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // user copies manually
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-start justify-between gap-2">
        <a
          href={`https://huggingface.co/${card.repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium font-mono text-blue-700 hover:underline break-all"
        >
          {card.repo}
        </a>
        {isInstalled ? (
          <span className="shrink-0 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
            ✓ installiert
          </span>
        ) : (
          <span className="shrink-0 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            – nicht inst.
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
        {card.size_b != null && <span>{card.size_b}B</span>}
        <span>{card.quant_count} quants</span>
        <span>{formatNumber(card.downloads)} DL</span>
        <span className="text-gray-500">{card.source_label}</span>
      </div>
      {card.description && (
        <p
          className="mt-2 text-xs text-gray-700 line-clamp-1"
          title={card.description}
        >
          {card.description}
        </p>
      )}
      {(card.pros?.length || card.cons?.length || card.setup_note) && (
        <div className="mt-2 space-y-1">
          {card.pros?.map((p, i) => (
            <div key={`p${i}`} className="text-xs text-green-800 flex gap-1">
              <span aria-hidden>✅</span>
              <span>{p}</span>
            </div>
          ))}
          {card.cons?.map((c, i) => (
            <div key={`c${i}`} className="text-xs text-amber-800 flex gap-1">
              <span aria-hidden>⚠️</span>
              <span>{c}</span>
            </div>
          ))}
          {card.setup_note && (
            <div className="text-xs text-blue-900 flex gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-1 mt-1">
              <span aria-hidden>🔧</span>
              <span>{card.setup_note}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all font-mono">
          {card.ollama_command}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded"
          aria-label="Kopieren"
        >
          {copied ? '✓ Kopiert' : '📋 Kopieren'}
        </button>
      </div>
    </div>
  );
}
