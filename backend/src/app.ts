import express from 'express';
import type { Express, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import usageRoutes from './routes/usage.js';
import pricingRoutes from './routes/pricing.js';
import recommendationRoutes from './routes/recommendation.js';
import authRouter from './routes/auth.js';
import errorHandler from './middleware/errorHandler.js';

/**
 * Allowed CORS origins. Includes:
 *   - the local Vite dev server (port 5173)
 *   - any chrome-extension:// origin (the tracker extension calls in from
 *     the browser background, where the origin header is the extension id)
 *   - the production VPS subpath (whole-site CORS, the path doesn't matter
 *     to CORS — only the origin)
 *   - extra origins from CORS_ALLOWED_ORIGINS env var (comma-separated)
 *     for ad-hoc deploys.
 *
 * Same-origin requests (frontend served from the same Apache vhost) don't
 * trigger CORS at all.
 */
function buildCorsOptions(): cors.CorsOptions {
  const fromEnv = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const baseAllow = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://wolfinisoftware.de',
    ...fromEnv
  ]);

  return {
    origin(origin, callback) {
      // No origin = same-origin / curl / server-to-server. Always allow.
      if (!origin) return callback(null, true);
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (baseAllow.has(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: false
  };
}

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

  app.use(cors(buildCorsOptions()));
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
