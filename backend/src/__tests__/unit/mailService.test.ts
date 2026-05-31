// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { jest } from '@jest/globals';

const sendMailMock = jest.fn();
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}));

const { sendMagicLinkMail } = await import('../../services/mailService.js');

describe('sendMagicLinkMail', () => {
  beforeEach(() => sendMailMock.mockReset());

  it('sends a plain-text mail with the verify URL', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc' });
    await sendMagicLinkMail('alice@example.com', 'token123', 'https://example.com/verify');

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com',
      from: expect.stringContaining('noreply@wolfinisoftware.de'),
      subject: expect.stringContaining('Login-Link'),
      text: expect.stringContaining('https://example.com/verify?token=token123')
    }));
  });
});

describe('createTransport options', () => {
  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  test('createTransport is called with auth + STARTTLS when SMTP_USER and SMTP_PASS are set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASS = 'sekret';

    let captured: unknown = null;
    jest.resetModules();
    jest.unstable_mockModule('nodemailer', () => ({
      default: {
        createTransport: (opts: unknown) => {
          captured = opts;
          return { sendMail: jest.fn() };
        },
      },
    }));
    await import('../../services/mailService.js');

    expect(captured).not.toBeNull();
    expect((captured as Record<string, unknown>).host).toBe('smtp.example.com');
    expect((captured as Record<string, unknown>).port).toBe(587);
    expect((captured as Record<string, unknown>).requireTLS).toBe(true);
    expect((captured as Record<string, unknown>).ignoreTLS).toBe(false);
    expect((captured as Record<string, unknown>).auth).toEqual({ user: 'mailer', pass: 'sekret' });
  });
});
