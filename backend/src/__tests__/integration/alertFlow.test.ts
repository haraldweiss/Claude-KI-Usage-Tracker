import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import request from 'supertest';

const TMP_DB = path.join(os.tmpdir(), `alert-flow-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = TMP_DB;
process.env.NODE_ENV = 'production';

const { createApp } = await import('../../app.js');
const { initDatabase, closeDatabase, runQuery } = await import('../../database/sqlite.js');
const { seedFromFallbackIfEmpty } = await import('../../services/pricingService.js');
const { createSession } = await import('../../services/authService.js');

const app = createApp();
let cookie: string;

beforeAll(async () => {
  await initDatabase();
  await seedFromFallbackIfEmpty();
  await runQuery(`INSERT OR IGNORE INTO users (id, email, is_admin) VALUES (50, 'test@test.com', 1)`);
  const sid = await createSession(50, null, null);
  cookie = `cut_session=${sid}`;
});

afterAll(async () => {
  await closeDatabase();
  await rm(TMP_DB, { force: true });
});

beforeEach(async () => {
  await runQuery('DELETE FROM billing_snapshots WHERE user_id = 50');
  await runQuery('DELETE FROM user_alert_config WHERE user_id = 50');
  await runQuery('DELETE FROM usage_records WHERE user_id = 50');
});

describe('POST /api/usage/billing-sync', () => {
  it('stores snapshot and returns low_balance alert when balance < 20% of topup', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 0.39, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.alerts.low_balance).toBe(true);
    expect(res.body.alerts.rate_alert).toBe(false);
    expect(res.body.balance_usd).toBeCloseTo(0.39, 2);
  });

  it('does NOT trigger low_balance when balance >= 20% of topup', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 5.00, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.alerts.low_balance).toBe(false);
  });

  it('suppresses low_balance when last_topup_usd is missing', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 0.10 })
      .expect(200);

    expect(res.body.alerts.low_balance).toBe(false);
  });

  it('triggers rate_alert when today cost > 3x 7-day average', async () => {
    for (let i = 7; i >= 1; i--) {
      await runQuery(
        `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, cost, source, cost_usd, user_id, timestamp)
         VALUES ('claude-sonnet-4-5', 0, 0, 0, 1.0, 'anthropic_console_cost_day', 1.0, 50, datetime('now', '-' || ? || ' days'))`,
        [i]
      );
    }
    await runQuery(
      `INSERT INTO usage_records (model, input_tokens, output_tokens, total_tokens, cost, source, cost_usd, user_id, timestamp)
       VALUES ('claude-opus-4-5', 0, 0, 0, 5.0, 'anthropic_console_cost_day', 5.0, 50, datetime('now'))`,
      []
    );

    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 10.00, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.alerts.rate_alert).toBe(true);
  });

  it('suppresses rate_alert when avg_daily is 0 (no history)', async () => {
    const res = await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 5.00, last_topup_usd: 20.00 })
      .expect(200);

    expect(res.body.alerts.rate_alert).toBe(false);
  });
});

describe('GET /api/usage/alerts', () => {
  it('returns current alert state including config defaults', async () => {
    await request(app)
      .post('/api/usage/billing-sync')
      .set('Cookie', cookie)
      .send({ balance_usd: 0.39, last_topup_usd: 20.00 });

    const res = await request(app)
      .get('/api/usage/alerts')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.low_balance).toBe(true);
    expect(res.body.balance_usd).toBeCloseTo(0.39, 2);
    expect(res.body.last_topup_usd).toBeCloseTo(20.00, 2);
    expect(res.body.config.low_balance_threshold).toBe(0.20);
    expect(res.body.config.rate_multiplier).toBe(3.0);
  });
});

describe('PUT /api/usage/alerts/config', () => {
  it('updates thresholds', async () => {
    await request(app)
      .put('/api/usage/alerts/config')
      .set('Cookie', cookie)
      .send({ low_balance_threshold: 0.30, rate_multiplier: 5.0 })
      .expect(200);

    const res = await request(app)
      .get('/api/usage/alerts')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.config.low_balance_threshold).toBe(0.30);
    expect(res.body.config.rate_multiplier).toBe(5.0);
  });

  it('rejects invalid threshold (> 1.0)', async () => {
    await request(app)
      .put('/api/usage/alerts/config')
      .set('Cookie', cookie)
      .send({ low_balance_threshold: 1.5 })
      .expect(400);
  });
});
