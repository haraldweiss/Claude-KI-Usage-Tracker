// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { Request, Response } from 'express';
import { getQuery, runQuery } from '../database/sqlite.js';
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

    res.json({
      low_balance: lowBalance,
      rate_alert: false,
      balance_usd: snapshot?.balance_usd ?? null,
      last_topup_usd: snapshot?.last_topup_usd ?? null,
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
