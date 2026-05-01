/**
 * Cross-user data isolation integration tests (C5 deliverable).
 *
 * Verifies that:
 *  - Each user only sees their own usage records in GET /api/usage/history
 *  - Unauthenticated requests are rejected with 401
 *  - Non-admin users cannot PUT /api/pricing/:model (403)
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.COOKIE_PATH = '/';

const { createApp } = await import('../../app.js');
const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const { createSession } = await import('../../services/authService.js');

const app = createApp();

beforeAll(async () => {
  await initDatabase();
  // Seed two test users — skip the auto-seeded id=1 (anubclaw@gmail.com)
  // from the seedInitialUser migration; use ids 10/11 to avoid conflict.
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email) VALUES (10, 'iso-a@x.com'), (11, 'iso-b@x.com')`
  );
  // Seed one record each for users 10 and 11.
  await runQuery(
    `INSERT INTO usage_records
       (model, input_tokens, output_tokens, total_tokens, cost, source, user_id)
     VALUES
       ('m', 100, 50, 150, 0.5, 'claude_ai', 10),
       ('m', 999, 999, 1998, 9.0, 'claude_ai', 11)`
  );
});

describe('cross-user isolation', () => {
  it('user A only sees their own records', async () => {
    const sidA = await createSession(10, null, null);
    const res = await request(app)
      .get('/api/usage/history?limit=50&offset=0')
      .set('Cookie', `cut_session=${sidA}`);

    expect(res.status).toBe(200);
    // getHistory returns { records: [...], limit, offset }
    const arr: Array<{ cost: number }> = res.body.records;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    expect(arr[0]!.cost).toBeCloseTo(0.5, 4);
  });

  it('user B only sees their own records', async () => {
    const sidB = await createSession(11, null, null);
    const res = await request(app)
      .get('/api/usage/history?limit=50&offset=0')
      .set('Cookie', `cut_session=${sidB}`);

    expect(res.status).toBe(200);
    const arr: Array<{ cost: number }> = res.body.records;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    expect(arr[0]!.cost).toBeCloseTo(9.0, 4);
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app).get('/api/usage/history?limit=50&offset=0');
    expect(res.status).toBe(401);
  });

  it('non-admin user cannot PUT pricing → 403', async () => {
    const sidA = await createSession(10, null, null);
    const res = await request(app)
      .put('/api/pricing/test-model')
      .set('Cookie', `cut_session=${sidA}`)
      .send({ input_price: 1, output_price: 2 });
    expect(res.status).toBe(403);
  });
});
