import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  process.env.DATABASE_PATH = ':memory:';
  const { default: init } = await import('../database/sqlite.js');
  await init();
  app = await createApp();
});

describe('GET /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/benchmarks');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/benchmarks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/benchmarks').send({});
    expect(res.status).toBe(401);
  });
});
