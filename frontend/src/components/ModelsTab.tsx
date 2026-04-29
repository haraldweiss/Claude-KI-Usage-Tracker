import React from 'react';
import { ModelBreakdown } from '../types/api';
import ApiKeysDetailTable from './ApiKeysDetailTable';

interface ModelsTabProps {
  models: ModelBreakdown[];
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return (tokens / 1000000).toFixed(1) + 'M';
  }
  if (tokens >= 1000) {
    return (tokens / 1000).toFixed(1) + 'k';
  }
  return tokens.toString();
}

function formatCost(cost: number | undefined | null): string {
  return `$${(cost ?? 0).toFixed(4)}`;
}

export default function ModelsTab({ models }: ModelsTabProps): React.ReactElement {
  const hasModels = models && models.length > 0;

  return (
    <div className="py-6 space-y-6">
      {/* Token usage per model — populated only when something feeds the
          backend per-message data (which our three scrapers don't). For most
          users this section is empty; the per-key table below is the useful
          one. */}
      {hasModels ? (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="text-lg font-semibold text-gray-900">Token-Verbrauch pro Modell</h3>
            <p className="text-sm text-gray-500">
              Nur für Sources, die per-message Token-Counts liefern. Die drei
              Scraper-Quellen (claude.ai, Console, Claude Code) tauchen hier
              nicht auf — die kumulativen Kosten dieser stehen in der
              Per-Key-Tabelle weiter unten.
            </p>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Model</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Input Tokens</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Output Tokens</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Requests</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {models.map((model, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">{model.model}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{formatTokens(model.input_tokens)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{formatTokens(model.output_tokens)}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{model.request_count}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">{formatCost(model.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
          Keine per-message Token-Daten verfügbar. Das ist erwartet — die drei
          Scraper-Quellen (claude.ai, Anthropic Console, Claude Code) liefern
          nur kumulative Kosten pro Key, keine Token-Counts pro Modell-Call.
          Die Per-Key-Tabelle unten zeigt die echten Cost-Daten.
        </div>
      )}

      <ApiKeysDetailTable />
    </div>
  );
}
