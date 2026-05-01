import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '25', 10);
const FROM_ADDRESS = process.env.MAIL_FROM || 'Claude Usage Tracker <noreply@wolfinisoftware.de>';

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  // Talking to Postfix on localhost — STARTTLS would hit Postfix's self-signed
  // cert (cert validation fails). The relay path Postfix → Ionos still uses
  // proper TLS, only the localhost hop is plaintext.
  ignoreTLS: true
});

export async function sendMagicLinkMail(
  email: string,
  token: string,
  verifyBaseUrl: string
): Promise<void> {
  const link = `${verifyBaseUrl}?token=${encodeURIComponent(token)}`;
  const body = [
    'Hallo!',
    '',
    'Klicke den folgenden Link um dich einzuloggen:',
    '',
    link,
    '',
    'Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.',
    '',
    'Falls du diesen Login nicht angefordert hast, ignoriere diese Mail.',
    '',
    '—',
    'Claude Usage Tracker'
  ].join('\n');

  await transport.sendMail({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Dein Login-Link für Claude Usage Tracker',
    text: body
  });
}
