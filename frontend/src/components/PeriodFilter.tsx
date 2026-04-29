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
  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number): void => {
    let nextIndex = currentIndex;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        nextIndex = currentIndex === 0 ? periods.length - 1 : currentIndex - 1;
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextIndex = currentIndex === periods.length - 1 ? 0 : currentIndex + 1;
        break;
      default:
        return;
    }

    onPeriodChange(periods[nextIndex].id);
  };

  return (
    <div
      className="flex gap-2"
      role="group"
      aria-label="Time period filter"
    >
      {periods.map((period, index) => (
        <button
          key={period.id}
          onClick={() => onPeriodChange(period.id)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          role="radio"
          aria-checked={activePeriod === period.id}
          tabIndex={activePeriod === period.id ? 0 : -1}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
            activePeriod === period.id
              ? 'bg-gray-200 text-gray-900'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
