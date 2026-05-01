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
