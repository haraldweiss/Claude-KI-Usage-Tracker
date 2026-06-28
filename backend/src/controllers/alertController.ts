// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Request, Response } from 'express';
import { getQuery, allQuery, runQuery } from '../database/sqlite.js';
import { checkAndFireAlerts } from '../services/alertService.js';
import logger from '../utils/logger.js';

export async function postBillingSync(req: Request, res: Response): Promise<void> {
  try {
    const { balance_usd, last_topup_usd } = req.body as {
      balance_usd: unknown;
      last_topup_usd?: unknown;
    };

    if (typeof balance_usd !== 'number' || !isFinite(balance_usd) || balance_usd < 0) {
      res.status(400).json({ error: 'balance_usd must be a non-negative number' });
      return;
    }

    const topup =
      typeof last_topup_usd === 'number' && isFinite(last_topup_usd) && last_topup_usd > 0
        ? last_topup_usd
        : null;

    const userId = req.user!.id;
    await runQuery(
      `INSERT INTO billing_snapshots (user_id, balance_usd, last_topup_usd)
       VALUES (?, ?, ?)`,
      [userId, balance_usd, topup]
    );

    const userRow = await getQuery<{ email: string }>(
      `SELECT email FROM users WHERE id = ?`,
      [userId]
    );
    const alerts = await checkAndFireAlerts(userId, userRow?.email ?? '');

    res.json({ success: true, alerts, balance_usd, last_topup_usd: topup });
  } catch (err) {
    logger.error({ err }, 'postBillingSync error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getAlerts(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const snapshot = await getQuery<{ balance_usd: number; last_topup_usd: number | null }>(
      `SELECT balance_usd, last_topup_usd FROM billing_snapshots
       WHERE user_id = ? AND date(scraped_at) = date('now')
       ORDER BY scraped_at DESC LIMIT 1`,
      [userId]
    );

    const config = await getQuery<{ low_balance_threshold: number; rate_multiplier: number }>(
      `SELECT low_balance_threshold, rate_multiplier FROM user_alert_config WHERE user_id = ?`,
      [userId]
    );

    const threshold = config?.low_balance_threshold ?? 0.20;
    const multiplier = config?.rate_multiplier ?? 3.0;

    const lowBalance =
      !!snapshot &&
      snapshot.last_topup_usd != null &&
      snapshot.last_topup_usd > 0 &&
      snapshot.balance_usd / snapshot.last_topup_usd < threshold;

    const todayRow = await getQuery<{ today_cost: number }>(
      `SELECT COALESCE(SUM(cost_usd), 0) as today_cost
       FROM usage_records
       WHERE user_id = ? AND source IN ('anthropic_console_cost_day', 'anthropic_console_sync', 'claude_code_sync') AND date(timestamp) = date('now')`,
      [userId]
    );
    const todayCost = todayRow?.today_cost ?? 0;

    const avgRows = await allQuery<{ daily_cost: number }>(
      `SELECT SUM(cost_usd) as daily_cost
       FROM usage_records
       WHERE user_id = ? AND source IN ('anthropic_console_cost_day', 'anthropic_console_sync', 'claude_code_sync')
         AND date(timestamp) >= date('now', '-7 days')
         AND date(timestamp) < date('now')
       GROUP BY date(timestamp)`,
      [userId]
    );
    const avgCost = avgRows.length > 0
      ? avgRows.reduce((s, r) => s + (r.daily_cost ?? 0), 0) / avgRows.length
      : 0;

    const rateAlert = avgCost > 0 && todayCost > 1.0 && todayCost > multiplier * avgCost;

    res.json({
      low_balance: lowBalance,
      rate_alert: rateAlert,
      balance_usd: snapshot?.balance_usd ?? null,
      last_topup_usd: snapshot?.last_topup_usd ?? null,
      today_cost_usd: todayCost,
      avg_daily_cost_usd: avgCost,
      config: { low_balance_threshold: threshold, rate_multiplier: multiplier }
    });
  } catch (err) {
    logger.error({ err }, 'getAlerts error');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function putAlertsConfig(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { low_balance_threshold, rate_multiplier } = req.body as {
      low_balance_threshold?: unknown;
      rate_multiplier?: unknown;
    };

    if (
      low_balance_threshold !== undefined &&
      (typeof low_balance_threshold !== 'number' ||
        low_balance_threshold < 0.01 ||
        low_balance_threshold > 1.0)
    ) {
      res.status(400).json({ error: 'low_balance_threshold must be between 0.01 and 1.0' });
      return;
    }

    if (
      rate_multiplier !== undefined &&
      (typeof rate_multiplier !== 'number' || rate_multiplier < 1.0 || rate_multiplier > 10.0)
    ) {
      res.status(400).json({ error: 'rate_multiplier must be between 1.0 and 10.0' });
      return;
    }

    await runQuery(
      `INSERT INTO user_alert_config (user_id, low_balance_threshold, rate_multiplier)
       VALUES (?, COALESCE(?, 0.20), COALESCE(?, 3.0))
       ON CONFLICT(user_id) DO UPDATE SET
         low_balance_threshold = COALESCE(excluded.low_balance_threshold, low_balance_threshold),
         rate_multiplier = COALESCE(excluded.rate_multiplier, rate_multiplier)`,
      [userId, low_balance_threshold ?? null, rate_multiplier ?? null]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'putAlertsConfig error');
    res.status(500).json({ error: 'Internal server error' });
  }
}
