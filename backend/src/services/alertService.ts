// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { allQuery, getQuery, runQuery } from '../database/sqlite.js';
import { sendAlertMail } from './mailService.js';

const API_SOURCES = `source IN ('anthropic_console_cost_day', 'anthropic_console_sync', 'claude_code_sync')`;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface AlertResult {
  low_balance: boolean;
  rate_alert: boolean;
  balance_usd: number | null;
  last_topup_usd: number | null;
  today_cost_usd: number;
  avg_daily_cost_usd: number;
}

async function getConfig(userId: number) {
  const row = await getQuery<{
    low_balance_threshold: number;
    rate_multiplier: number;
    alerts_enabled: number;
    last_low_balance_alert_at: string | null;
    last_rate_alert_at: string | null;
  }>(
    `SELECT low_balance_threshold, rate_multiplier, alerts_enabled,
            last_low_balance_alert_at, last_rate_alert_at
     FROM user_alert_config WHERE user_id = ?`,
    [userId]
  );
  return row ?? {
    low_balance_threshold: 0.20,
    rate_multiplier: 3.0,
    alerts_enabled: 1,
    last_low_balance_alert_at: null,
    last_rate_alert_at: null
  };
}

function cooldownElapsed(lastSentAt: string | null): boolean {
  if (!lastSentAt) return true;
  return Date.now() - new Date(lastSentAt).getTime() > ALERT_COOLDOWN_MS;
}

export async function checkAndFireAlerts(
  userId: number,
  userEmail: string
): Promise<AlertResult> {
  const config = await getConfig(userId);

  const snapshot = await getQuery<{ balance_usd: number; last_topup_usd: number | null }>(
    `SELECT balance_usd, last_topup_usd FROM billing_snapshots
     WHERE user_id = ? AND date(scraped_at) = date('now')
     ORDER BY scraped_at DESC LIMIT 1`,
    [userId]
  );

  const lowBalance =
    !!snapshot &&
    snapshot.last_topup_usd != null &&
    snapshot.last_topup_usd > 0 &&
    snapshot.balance_usd / snapshot.last_topup_usd < config.low_balance_threshold;

  const todayRow = await getQuery<{ today_cost: number }>(
    `SELECT COALESCE(SUM(cost_usd), 0) as today_cost
     FROM usage_records
     WHERE user_id = ? AND ${API_SOURCES} AND date(timestamp) = date('now')`,
    [userId]
  );
  const todayCost = todayRow?.today_cost ?? 0;

  const avgRows = await allQuery<{ daily_cost: number }>(
    `SELECT SUM(cost_usd) as daily_cost
     FROM usage_records
     WHERE user_id = ? AND ${API_SOURCES}
       AND date(timestamp) >= date('now', '-7 days')
       AND date(timestamp) < date('now')
     GROUP BY date(timestamp)`,
    [userId]
  );
  const avgCost =
    avgRows.length > 0
      ? avgRows.reduce((s, r) => s + (r.daily_cost ?? 0), 0) / avgRows.length
      : 0;

  const rateAlert =
    avgCost > 0 && todayCost > 1.0 && todayCost > config.rate_multiplier * avgCost;

  await runQuery(
    `INSERT OR IGNORE INTO user_alert_config (user_id) VALUES (?)`,
    [userId]
  );

  if (config.alerts_enabled) {
    if (lowBalance && cooldownElapsed(config.last_low_balance_alert_at)) {
      const pct = Math.round((snapshot!.balance_usd / snapshot!.last_topup_usd!) * 100);
      await sendAlertMail(
        userEmail,
        '⚠️ Claude API Credits fast leer',
        [
          `Dein API-Guthaben ist niedrig.`,
          ``,
          `Aktuell: $${snapshot!.balance_usd.toFixed(2)} (${pct}% des letzten Auflade-Betrags von $${snapshot!.last_topup_usd!.toFixed(2)})`,
          ``,
          `Öffne das Dashboard um aufzuladen: https://wolfinisoftware.de/claudetracker/`,
          ``,
          `— Claude Usage Tracker`
        ].join('\n')
      );
      await runQuery(
        `UPDATE user_alert_config SET last_low_balance_alert_at = datetime('now') WHERE user_id = ?`,
        [userId]
      );
    }

    if (rateAlert && cooldownElapsed(config.last_rate_alert_at)) {
      await sendAlertMail(
        userEmail,
        '⚠️ Ungewöhnlich hoher API-Verbrauch heute',
        [
          `Dein heutiger API-Verbrauch ist ungewöhnlich hoch.`,
          ``,
          `Heute: $${todayCost.toFixed(2)}`,
          `7-Tage-Schnitt: $${avgCost.toFixed(2)}/Tag`,
          `Faktor: ${(todayCost / avgCost).toFixed(1)}×`,
          ``,
          `Öffne das Dashboard für Details: https://wolfinisoftware.de/claudetracker/`,
          ``,
          `— Claude Usage Tracker`
        ].join('\n')
      );
      await runQuery(
        `UPDATE user_alert_config SET last_rate_alert_at = datetime('now') WHERE user_id = ?`,
        [userId]
      );
    }
  }

  return {
    low_balance: lowBalance,
    rate_alert: rateAlert,
    balance_usd: snapshot?.balance_usd ?? null,
    last_topup_usd: snapshot?.last_topup_usd ?? null,
    today_cost_usd: todayCost,
    avg_daily_cost_usd: avgCost
  };
}
