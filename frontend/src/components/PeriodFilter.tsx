import React from 'react';
import { PeriodFilterProps, PeriodType } from '../types/components';

interface Period {
  id: PeriodType;
  label: string;
}

const periods: Period[] = [
  { id: 'all', label: 'Alle' },
  { id: '30d', label: '30d' },
  { id: '7d', label: '7d' }
];

export default function PeriodFilter({ activePeriod, onPeriodChange }: PeriodFilterProps): React.ReactElement {
  return (
    <div
      className="flex gap-2"
      role="group"
      aria-label="Time period filter"
    >
      {periods.map((period) => (
        <button
          key={period.id}
          onClick={() => onPeriodChange(period.id)}
          role="radio"
          aria-checked={activePeriod === period.id}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
            activePeriod === period.id
              ? 'bg-gray-200 text-gray-900'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-150'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
