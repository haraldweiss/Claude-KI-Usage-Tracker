// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'production';

const { createApp } = await import('../app.js');
const { initDatabase, runQuery } = await import('../database/sqlite.js');
const { createSession } = await import('../services/authService.js');

const app = createApp();

let sessionCookie: string;

const RUN_ID = `test-run-${Date.now()}`;
const SAMPLE_PAYLOAD = {
  run_id: RUN_ID,
  machine_name: 'Test Machine',
  model_name: 'test-model:latest',
  mode: 'quick',
  results: [
    { category: 'coding', score: 80, tasks_total: 5, tasks_passed: 4, raw_results: '[]' },
    { category: 'general', score: 60, tasks_total: 5, tasks_passed: 3, raw_results: '[]' },
    { category: 'project', score: 100, tasks_total: 5, tasks_passed: 5, raw_results: '[]' },
    { category: 'speed', score: 42.5, tasks_total: 3, tasks_passed: 3, raw_results: '[]' },
  ],
};

beforeAll(async () => {
  await initDatabase();
  await runQuery(`INSERT OR IGNORE INTO users (id, email) VALUES (99, 'bench-test@x.com')`);
  const sid = await createSession(99, null, null);
  sessionCookie = `cut_session=${sid}`;
});

describe('POST /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/benchmarks').send(SAMPLE_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it('returns 400 with missing fields', async () => {
    const res = await request(app)
      .post('/api/benchmarks')
      .set('Cookie', sessionCookie)
      .send({ run_id: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 201 with valid payload', async () => {
    const res = await request(app)
      .post('/api/benchmarks')
      .set('Cookie', sessionCookie)
      .send(SAMPLE_PAYLOAD);
    expect(res.status).toBe(201);
    expect((res.body as { run_id: string }).run_id).toBe(RUN_ID);
  });
});

describe('GET /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/benchmarks');
    expect(res.status).toBe(401);
  });

  it('returns 200 with runs array', async () => {
    const res = await request(app)
      .get('/api/benchmarks')
      .set('Cookie', sessionCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { runs: unknown[] }).runs)).toBe(true);
  });
});
