// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { useState } from 'react';
import type { ConsoleModelBreakdown as BreakdownData } from '../types/api';
import { formatEur } from '../utils/format';

interface Props {
  data: BreakdownData | undefined;
  usdToEur: number;
}

export function ConsoleModelBreakdown({ data, usdToEur }: Props) {
  const [period, setPeriod] = useState<'day' | 'month'>('day');

  if (!data) return null;

  const rows = (period === 'day' ? (data.day ?? []) : (data.month ?? []))
    .slice()
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const hasData = rows.length > 0;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Model Breakdown</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['day', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              style={{
                padding: '0.2rem 0.6rem',
                fontSize: '0.78rem',
                borderRadius: '4px',
                border: '1px solid var(--border, #ccc)',
                background: period === p ? 'var(--accent, #4f46e5)' : 'transparent',
                color: period === p ? '#fff' : 'inherit',
                cursor: 'pointer'
              }}
            >
              {p === 'day' ? 'Letzte 24h' : 'Aktueller Monat'}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted, #888)', margin: 0 }}>
          Noch kein Model-Breakdown — Extension syncen
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border, #ccc)' }}>
              <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem' }}>Modell</th>
              <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Input</th>
              <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Output</th>
              <th style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>Kosten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model} style={{ borderBottom: '1px solid var(--border-subtle, #eee)' }}>
                <td style={{ padding: '0.3rem 0.5rem' }}>{row.model}</td>
                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                  {row.input_tokens.toLocaleString('de-DE')}
                </td>
                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                  {row.output_tokens.toLocaleString('de-DE')}
                </td>
                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                  {formatEur(row.cost_usd * usdToEur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
