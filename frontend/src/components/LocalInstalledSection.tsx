// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React from 'react';
import LocalModelCard from './LocalModelCard';
import type { LocalModelCard as LocalModelCardType } from '../services/catalogApi';

export default function LocalInstalledSection({
  models,
}: {
  models: LocalModelCardType[];
}): React.ReactElement | null {
  if (models.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        Lokal installiert ({models.length})
      </h2>
      <p className="text-xs text-gray-600 mb-3">
        Aus <code className="font-mono">ollama list</code> — sortiert nach Kategorie.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {models.map((card) => (
          <LocalModelCard key={card.name} card={card} />
        ))}
      </div>
    </section>
  );
}
