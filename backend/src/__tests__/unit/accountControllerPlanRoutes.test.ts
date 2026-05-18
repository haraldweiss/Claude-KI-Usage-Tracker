// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
process.env.DATABASE_PATH = ':memory:';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const { initDatabase, runQuery } = await import('../../database/sqlite.js');
const {
  getPlanHistory: getPlanHistoryHandler,
  getPlanPending,
  postPlanSchedule,
  deletePlanSchedule,
} = await import('../../controllers/accountController.js');

beforeAll(async () => {
  await initDatabase();
  await runQuery(
    `INSERT OR IGNORE INTO users (id, email, plan_name) VALUES (701, 'route@x.com', 'Max (5x)')`
  );
  await runQuery(
    `INSERT OR IGNORE INTO plan_pricing (plan_name, monthly_eur) VALUES ('Pro', 20)`
  );
});

beforeEach(async () => {
  await runQuery('DELETE FROM plan_history WHERE user_id = 701');
});

function makeApp() {
  const app = express();
  app.use(express.json());
  // Inject fake user (id=701) onto req.user — replaces requireUser middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 701 } as never;
    next();
  });
  app.get('/plan-history', getPlanHistoryHandler);
  app.get('/plan-pending', getPlanPending);
  app.post('/plan-schedule', postPlanSchedule);
  app.delete('/plan-schedule', deletePlanSchedule);
  return app;
}

describe('plan routes', () => {
  it('GET /plan-history returns [] when empty', async () => {
    const res = await request(makeApp()).get('/plan-history');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /plan-pending returns null when nothing scheduled', async () => {
    const res = await request(makeApp()).get('/plan-pending');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('POST /plan-schedule with valid body returns 201', async () => {
    const res = await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Pro', effective_from: '2099-12-31', note: 'test' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('POST /plan-schedule with past date returns 400', async () => {
    const res = await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Pro', effective_from: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/today or later/);
  });

  it('POST /plan-schedule with unknown plan returns 400', async () => {
    const res = await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Bogus', effective_from: '2099-12-31' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown plan/);
  });

  it('DELETE /plan-schedule returns 204 even when nothing to cancel', async () => {
    const res = await request(makeApp()).delete('/plan-schedule');
    expect(res.status).toBe(204);
  });

  it('GET /plan-pending after POST returns the new entry', async () => {
    await request(makeApp())
      .post('/plan-schedule')
      .send({ plan_name: 'Pro', effective_from: '2099-12-31' });
    const res = await request(makeApp()).get('/plan-pending');
    expect(res.body.plan_name).toBe('Pro');
    expect(res.body.effective_from).toBe('2099-12-31');
  });
});
