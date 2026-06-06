// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import express from 'express';
import type { Express, Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import usageRoutes from './routes/usage.js';
import pricingRoutes from './routes/pricing.js';
import recommendationRoutes from './routes/recommendation.js';
import localUsageRoutes from './routes/localUsage.js';
import catalogRoutes from './routes/catalog.js';
import authRouter from './routes/auth.js';
import accountRouter from './routes/account.js';
import adminRouter from './routes/admin.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';


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

  // Security headers (CSP relaxed for SPA + API)
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // Manual CORS middleware to allow credentials from dev & extension origins
  app.use((req: Request, res: Response, next): void => {
    const origin = req.get('origin') || '';
    const referer = req.get('referer') || '';
    const knownOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://claudetracker.wolfinisoftware.de'];
    const isKnownOrigin = knownOrigins.includes(origin) || origin.startsWith('chrome-extension://');
    const isProductionDomain = referer.includes('wolfinisoftware.de');

    if (isKnownOrigin) {
      // Known origin: allow credentials
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    } else if (!origin && isProductionDomain) {
      res.set('Access-Control-Allow-Origin', 'https://claudetracker.wolfinisoftware.de');
      res.set('Access-Control-Allow-Credentials', 'true');
    } else if (!origin) {
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
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

  // Request logging — quiet in test mode to keep output readable
  if (process.env.NODE_ENV !== 'test') {
    app.use((req: Request, _res: Response, next) => {
      logger.info({ method: req.method, path: req.path }, 'request');
      next();
    });
  }

  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/usage', usageRoutes);
  app.use('/api/pricing', pricingRoutes);
  app.use('/api/recommend', recommendationRoutes);
  app.use('/api/local-usage', localUsageRoutes);
  app.use('/api/catalog', catalogRoutes);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Global error handler must be LAST
  app.use(errorHandler);

  return app;
}
