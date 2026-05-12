// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express from 'express';
import type { Express, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import usageRoutes from './routes/usage.js';
import pricingRoutes from './routes/pricing.js';
import recommendationRoutes from './routes/recommendation.js';
import authRouter from './routes/auth.js';
import accountRouter from './routes/account.js';
import adminRouter from './routes/admin.js';
import errorHandler from './middleware/errorHandler.js';


/**
 * Build the Express app. No side effects: caller is responsible for
 * `initDatabase()` and `app.listen()`. Tests import this directly and pass
 * it to supertest without starting a real HTTP listener.
 */
export function createApp(): Express {
  const app: Express = express();

  // Behind Apache reverse-proxy on the VPS; 1 hop. Without this, req.ip is
  // always the loopback and per-IP rate limits become per-server limits.
  app.set('trust proxy', 'loopback');

  // Manual CORS middleware to allow credentials from dev & extension origins
  app.use((req: Request, res: Response, next): void => {
    const origin = req.get('origin') || '';
    const referer = req.get('referer') || '';
    const knownOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://wolfinisoftware.de'];
    const isKnownOrigin = knownOrigins.includes(origin) || origin.startsWith('chrome-extension://');
    const isProductionDomain = referer.includes('wolfinisoftware.de');

    if (isKnownOrigin) {
      // Known origin: allow credentials
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    } else if (!origin && isProductionDomain) {
      // No origin header but same-origin request (production domain): allow credentials
      res.set('Access-Control-Allow-Origin', 'https://wolfinisoftware.de');
      res.set('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
      // No origin header (form submissions, localhost same-origin requests): allow all without credentials
      res.set('Access-Control-Allow-Origin', '*');
    }
    // Unknown origin: don't set CORS headers at all (deny cross-origin access)

    res.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.set('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      return void res.sendStatus(204);
    }
    return void next();
  });

  app.use(cookieParser());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Request logging — quiet in test mode to keep output readable
  if (process.env.NODE_ENV !== 'test') {
    app.use((req: Request, _res: Response, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/usage', usageRoutes);
  app.use('/api/pricing', pricingRoutes);
  app.use('/api/recommend', recommendationRoutes);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Global error handler must be LAST
  app.use(errorHandler);

  return app;
}
