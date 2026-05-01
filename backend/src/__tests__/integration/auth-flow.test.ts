import { jest, describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';

const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'x' });
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}));

process.env.DATABASE_PATH = ':memory:';
process.env.VERIFY_BASE_URL = 'http://localhost/claudetracker/auth/verify';
process.env.COOKIE_PATH = '/';   // for supertest convenience (default cookie path)
process.env.NODE_ENV = 'test';

const { createApp } = await import('../../app.js');
const { initDatabase } = await import('../../database/sqlite.js');

const app = createApp();

beforeAll(async () => { await initDatabase(); });

describe('magic-link auth flow', () => {
  it('full happy path: request → verify → me → logout', async () => {
    // 1. Request link
    const reqRes = await request(app).post('/api/auth/request').send({ email: 'newuser@example.com' });
    expect(reqRes.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalled();
    const sentTo = sendMailMock.mock.calls[0][0];
    const tokenMatch = (sentTo as { text: string }).text.match(/token=([a-f0-9]{64})/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    // 2. Consume token
    const verifyRes = await request(app).post('/api/auth/verify').send({ token });
    expect(verifyRes.status).toBe(302);  // redirect
    const cookieHeader = verifyRes.headers['set-cookie'];
    expect(cookieHeader).toBeTruthy();
    const cookie = (cookieHeader as unknown as string[])[0];
    expect(cookie).toContain('cut_session=');

    // 3. /me with cookie
    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('newuser@example.com');

    // 4. Logout
    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(204);

    // 5. /me after logout → 401
    const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meAfter.status).toBe(401);
  });

  it('returns 200 even for invalid email (no enumeration)', async () => {
    const res = await request(app).post('/api/auth/request').send({ email: 'not-an-email' });
    expect(res.status).toBe(200);
  });
});
