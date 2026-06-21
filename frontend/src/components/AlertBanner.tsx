// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { useEffect, useState } from 'react';
import type { AlertState } from '../types/api';

export function AlertBanner() {
  const [alerts, setAlerts] = useState<AlertState | null>(null);

  useEffect(() => {
    fetch('/claudetracker/api/usage/alerts', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data: AlertState | null) => data && setAlerts(data))
      .catch(() => {});
  }, []);

  if (!alerts || (!alerts.low_balance && !alerts.rate_alert)) return null;

  const pct =
    alerts.balance_usd != null && alerts.last_topup_usd != null && alerts.last_topup_usd > 0
      ? Math.round((alerts.balance_usd / alerts.last_topup_usd) * 100)
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
      {alerts.low_balance && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            fontSize: '0.875rem'
          }}
        >
          ⚠️ <strong>API Credits fast leer:</strong>{' '}
          Nur noch ${alerts.balance_usd?.toFixed(2)}
          {pct != null ? ` (${pct}% des letzten Auflade-Betrags von $${alerts.last_topup_usd?.toFixed(2)})` : ''}
        </div>
      )}
      {alerts.rate_alert && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            background: '#fff7ed',
            border: '1px solid #fdba74',
            color: '#9a3412',
            fontSize: '0.875rem'
          }}
        >
          ⚠️ <strong>Ungewöhnlich hoher Verbrauch heute:</strong>{' '}
          ${alerts.today_cost_usd?.toFixed(2)} (
          {alerts.avg_daily_cost_usd != null && alerts.avg_daily_cost_usd > 0
            ? `${(alerts.today_cost_usd! / alerts.avg_daily_cost_usd).toFixed(1)}× über dem 7-Tage-Schnitt von $${alerts.avg_daily_cost_usd.toFixed(2)}/Tag`
            : 'Schnitt unbekannt'}
          )
        </div>
      )}
    </div>
  );
}
