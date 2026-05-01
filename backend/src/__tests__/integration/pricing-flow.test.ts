/**
 * End-to-end HTTP integration tests for the pricing flow:
 *   - POST /api/usage/track with a known display name → existing pricing used
 *   - POST /api/usage/track with an unknown Claude API id → row auto-created
 *     with tier-default pricing (source='tier_default', status='active')
 *   - POST /api/usage/track with an unrecognizable model → row auto-created
 *     with status='pending_confirmation' and zero prices
 *   - POST /api/pricing/:model/confirm → row flips to source='manual',
 *     status='active', and historical usage_records are recosted
 *
 * Each test starts with a fresh on-disk SQLite DB in os.tmpdir(). The fallback
 * snapshot is seeded explicitly so the suite runs without network access.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import os from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import request from 'supertest';

// Set DATABASE_PATH BEFORE importing anything that touches sqlite.ts.
const TMP_DB = path.join(os.tmpdir(), `usage-tracker-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = TMP_DB;
process.env.NODE_ENV = 'test';

const { createApp } = await import('../../app.js');
const { initDatabase, closeDatabase, runQuery } = await import('../../database/sqlite.js');
const { seedFromFallbackIfEmpty } = await import('../../services/pricingService.js');
const { createSession } = await import('../../services/authService.js');

const app = createApp();

let adminCookie: string;

beforeAll(async () => {
  await initDatabase();
  await seedFromFallbackIfEmpty();
  // Create an admin user for authenticated requests.
  // The seeded user is id=1 (anubclaw@gmail.com); use id=50 to avoid conflict.
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email, is_admin) VALUES (50, 'admin@test.com', 1)`
  );
  const sid = await createSession(50, null, null);
  adminCookie = `cut_session=${sid}`;
});

afterAll(async () => {
  await closeDatabase();
  await rm(TMP_DB, { force: true });
});

beforeEach(async () => {
  // Clear usage_records between tests so cost recalculation tests start clean.
  await runQuery('DELETE FROM usage_records');
});

describe('POST /api/usage/track', () => {
  it('uses existing pricing for a known display name', async () => {
    const res = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({
        model: 'Claude Opus 4.7',
        input_tokens: 1000,
        output_tokens: 500
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    // (1000 * 15 + 500 * 75) / 1_000_000 = 0.0525
    expect(parseFloat(res.body.cost)).toBeCloseTo(0.0525, 4);
  });

  it('auto-creates a tier_default row when the API id has a recognizable family', async () => {
    const futureModel = 'claude-future-haiku-9-9-20990101';
    const trackRes = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({ model: futureModel, input_tokens: 1000, output_tokens: 1000 })
      .expect(201);

    expect(trackRes.body.success).toBe(true);

    const pricingRes = await request(app)
      .get('/api/pricing')
      .set('Cookie', adminCookie)
      .expect(200);
    const rows = pricingRes.body.pricing as Array<Record<string, unknown>>;
    const created = rows.find((r) => r.api_id === futureModel);
    expect(created).toBeDefined();
    expect(created!.source).toBe('tier_default');
    expect(created!.status).toBe('active');
    expect(created!.tier).toBe('haiku');
    // Whatever the haiku-tier price is in the seed, both should be > 0 since
    // the fallback ships at least one active haiku model.
    expect(created!.input_price as number).toBeGreaterThan(0);
    expect(created!.output_price as number).toBeGreaterThan(0);
  });

  it('marks unrecognizable models pending_confirmation with zero prices', async () => {
    const trackRes = await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({ model: 'some-totally-novel-llm', input_tokens: 100, output_tokens: 100 })
      .expect(201);

    expect(trackRes.body.success).toBe(true);
    expect(parseFloat(trackRes.body.cost)).toBe(0);

    const pricingRes = await request(app)
      .get('/api/pricing')
      .set('Cookie', adminCookie)
      .expect(200);
    const rows = pricingRes.body.pricing as Array<Record<string, unknown>>;
    const created = rows.find((r) => r.model === 'some-totally-novel-llm');
    expect(created).toBeDefined();
    expect(created!.status).toBe('pending_confirmation');
    expect(created!.input_price).toBe(0);
    expect(created!.output_price).toBe(0);
  });
});

describe('POST /api/pricing/:model/confirm', () => {
  it('flips a pending row to manual+active and recalculates historical costs', async () => {
    const modelName = 'some-pending-model-for-confirm';

    // 1. Auto-create the pending row by tracking usage.
    await request(app)
      .post('/api/usage/track')
      .set('Cookie', adminCookie)
      .send({ model: modelName, input_tokens: 1000, output_tokens: 1000 })
      .expect(201);

    // The historical record should currently have cost=0 (no prices).
    const beforeHistory = await request(app)
      .get('/api/usage/history?limit=1')
      .set('Cookie', adminCookie)
      .expect(200);
    const beforeRecord = beforeHistory.body.records[0];
    expect(beforeRecord.cost).toBeCloseTo(0, 6);

    // 2. Confirm with explicit prices.
    const confirmRes = await request(app)
      .post(`/api/pricing/${encodeURIComponent(modelName)}/confirm`)
      .set('Cookie', adminCookie)
      .send({ inputPrice: 3, outputPrice: 15 })
      .expect(200);

    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.pricing.source).toBe('manual');
    expect(confirmRes.body.pricing.status).toBe('active');

    // 3. Verify the pricing row is now manual+active.
    const pricingRes = await request(app)
      .get('/api/pricing')
      .set('Cookie', adminCookie)
      .expect(200);
    const updated = (pricingRes.body.pricing as Array<Record<string, unknown>>).find(
      (r) => r.model === modelName
    );
    expect(updated).toBeDefined();
    expect(updated!.source).toBe('manual');
    expect(updated!.status).toBe('active');
    expect(updated!.input_price).toBe(3);
    expect(updated!.output_price).toBe(15);

    // 4. Historical record cost was recalculated.
    // (1000 * 3 + 1000 * 15) / 1_000_000 = 0.018
    const afterHistory = await request(app)
      .get('/api/usage/history?limit=1')
      .set('Cookie', adminCookie)
      .expect(200);
    const afterRecord = afterHistory.body.records[0];
    expect(afterRecord.cost).toBeCloseTo(0.018, 6);
  });

  it('returns 404 for a model that does not exist', async () => {
    const res = await request(app)
      .post('/api/pricing/nonexistent-model/confirm')
      .set('Cookie', adminCookie)
      .send({ inputPrice: 1, outputPrice: 1 })
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });
});
