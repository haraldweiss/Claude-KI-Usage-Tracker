// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useState } from 'react';
import type { LocalModelCard as LocalModelCardType, LocalModelFamily } from '../services/catalogApi';

const FAMILY_LABEL: Record<LocalModelFamily, string> = {
  chat: 'Chat',
  code: 'Code',
  embedding: 'Embedding',
  custom: 'Custom',
};

const FAMILY_BADGE: Record<LocalModelFamily, string> = {
  chat: 'bg-blue-100 text-blue-800',
  code: 'bg-green-100 text-green-800',
  embedding: 'bg-gray-100 text-gray-700',
  custom: 'bg-purple-100 text-purple-800',
};

export default function LocalModelCard({
  card,
}: {
  card: LocalModelCardType;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const runCommand = `ollama run ${card.name}`;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(runCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = runCommand;
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
        <span className="text-sm font-medium font-mono text-gray-900 break-all">
          {card.name}
        </span>
        <span
          className={`shrink-0 text-xs px-2 py-0.5 rounded ${FAMILY_BADGE[card.family]}`}
        >
          {FAMILY_LABEL[card.family]}
        </span>
      </div>

      {(card.pros?.length || card.cons?.length || card.setup_note) ? (
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
      ) : (
        <div className="mt-2 text-xs text-gray-500 italic">
          Pros/Cons werden im Hintergrund generiert — beim nächsten Laden verfügbar.
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all font-mono">
          {runCommand}
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
