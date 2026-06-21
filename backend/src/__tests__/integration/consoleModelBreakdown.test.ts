import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import request from 'supertest';

const TMP_DB = path.join(os.tmpdir(), `console-cost-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = TMP_DB;
process.env.NODE_ENV = 'production';

const { createApp } = await import('../../app.js');
const { initDatabase, closeDatabase, runQuery, allQuery } = await import('../../database/sqlite.js');
const { seedFromFallbackIfEmpty } = await import('../../services/pricingService.js');
const { createSession } = await import('../../services/authService.js');

const app = createApp();
let adminCookie: string;

beforeAll(async () => {
  await initDatabase();
  await seedFromFallbackIfEmpty();
  await runQuery(`INSERT OR IGNORE INTO users (id, email, is_admin) VALUES (50, 'admin@test.com', 1)`);
  const sid = await createSession(50, null, null);
  adminCookie = `cut_session=${sid}`;
});

afterAll(async () => {
  await closeDatabase();
  await rm(TMP_DB, { force: true });
});

beforeEach(async () => {
  await runQuery('DELETE FROM usage_records');
});

describe('POST /api/usage/track — console cost sources', () => {
  it('accepts anthropic_console_cost_day and stores model name', async () => {
    const res = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-opus-4-5',
        input_tokens: 120000,
        output_tokens: 8000,
        source: 'anthropic_console_cost_day',
        cost_usd: 17.86,
        workspace: 'Default'
      })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('accepts anthropic_console_cost_month and stores model name', async () => {
    const res = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-sonnet-4-5',
        input_tokens: 340000,
        output_tokens: 22000,
        source: 'anthropic_console_cost_month',
        cost_usd: 41.20,
        workspace: 'Default'
      })
      .expect(201);

    expect(res.body.success).toBe(true);
  });

  it('dedupes: second day POST replaces first for same source+day', async () => {
    const body = {
      model: 'claude-opus-4-5',
      input_tokens: 1000,
      output_tokens: 100,
      source: 'anthropic_console_cost_day',
      cost_usd: 5.00,
      workspace: 'Default'
    };
    await request(app).post('/api/usage/track').set('Cookie', adminCookie).send(body).expect(201);
    await request(app).post('/api/usage/track').set('Cookie', adminCookie).send({ ...body, cost_usd: 6.00 }).expect(201);

    const rows = await allQuery<{ cost_usd: number }>(
      `SELECT cost_usd FROM usage_records WHERE source = 'anthropic_console_cost_day' AND user_id = 50`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cost_usd).toBe(6.00);
  });
});

describe('GET /api/usage/summary — console_model_breakdown', () => {
  it('returns console_model_breakdown.day with rows from today', async () => {
    await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-opus-4-5',
        input_tokens: 120000,
        output_tokens: 8000,
        source: 'anthropic_console_cost_day',
        cost_usd: 17.86,
        workspace: 'wolfinisoftware_de'
      });

    const res = await request(app)
      .get('/api/usage/summary?period=day')
      .set('Cookie', adminCookie)
      .expect(200);

    const breakdown = res.body.combined.console_model_breakdown;
    expect(breakdown).toBeDefined();
    expect(breakdown.day).toHaveLength(1);
    expect(breakdown.day[0].model).toMatch(/claude-opus-4-5|Claude Opus 4\.5/i);
    expect(breakdown.day[0].cost_usd).toBeCloseTo(17.86, 2);
    expect(breakdown.month).toEqual([]);
  });

  it('returns console_model_breakdown.month with rows from this month', async () => {
    await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'claude-sonnet-4-5',
        input_tokens: 340000,
        output_tokens: 22000,
        source: 'anthropic_console_cost_month',
        cost_usd: 41.20,
        workspace: 'Default'
      });

    const res = await request(app)
      .get('/api/usage/summary?period=month')
      .set('Cookie', adminCookie)
      .expect(200);

    const breakdown = res.body.combined.console_model_breakdown;
    expect(breakdown.month).toHaveLength(1);
    expect(breakdown.month[0].model).toMatch(/claude-sonnet-4-5|Claude Sonnet 4\.5/i);
    expect(breakdown.month[0].cost_usd).toBeCloseTo(41.20, 2);
  });
});
