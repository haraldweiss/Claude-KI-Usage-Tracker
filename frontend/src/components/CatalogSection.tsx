// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import React, { useState } from 'react';
import ModelCard from './ModelCard';
import {
  isInstalled as checkInstalled,
  type CuratedSection as CuratedSectionType,
} from '../services/catalogApi';

export default function CatalogSection({
  section,
  installedNames,
}: {
  section: CuratedSectionType;
  installedNames: string[];
}): React.ReactElement {
  const [open, setOpen] = useState(true);

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left mb-2"
      >
        <h2 className="text-lg font-semibold text-gray-900">{section.label}</h2>
        <span className="text-sm text-gray-500">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {section.models.map((card) => (
            <ModelCard
              key={card.repo}
              card={card}
              isInstalled={checkInstalled(installedNames, card.repo)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
