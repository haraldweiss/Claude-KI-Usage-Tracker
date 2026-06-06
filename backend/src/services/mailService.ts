// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';

const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '25', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_ADDRESS = process.env.MAIL_FROM || 'Claude Usage Tracker <noreply@wolfinisoftware.de>';

// Talking to local Postfix on port 25 uses plaintext (Postfix's self-signed
// cert would fail STARTTLS validation); the Postfix → IONOS hop still uses
// proper TLS. Talking to a real SMTP submission service (e.g. smtp.ionos.de
// from inside a container) requires STARTTLS + SASL.
const isLocalRelay = SMTP_HOST === 'localhost' || SMTP_HOST === '127.0.0.1' || SMTP_HOST === '::1';

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  requireTLS: !isLocalRelay,
  ignoreTLS: isLocalRelay,
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
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

  try {
    logger.info(`[Email] Attempting to send magic link to ${email}`);
    const info = await transport.sendMail({
      from: FROM_ADDRESS,
      to: email,
      subject: 'Dein Login-Link für Claude Usage Tracker',
      text: body
    });
    logger.info(`[Email] Successfully sent to ${email}, response: ${info.response}`);
  } catch (error) {
logger.error({ err: error }, `[Email] Failed to send to ${email}`)
    throw error;
  }
}
