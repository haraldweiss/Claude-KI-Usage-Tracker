import express from 'express';
import type { Express, Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import usageRoutes from './routes/usage.js';
import pricingRoutes from './routes/pricing.js';
import recommendationRoutes from './routes/recommendation.js';
import errorHandler from './middleware/errorHandler.js';

/**
 * Build the Express app. No side effects: caller is responsible for
 * `initDatabase()` and `app.listen()`. Tests import this directly and pass
 * it to supertest without starting a real HTTP listener.
 */
export function createApp(): Express {
  const app: Express = express();

  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Request logging — quiet in test mode to keep output readable
  if (process.env.NODE_ENV !== 'test') {
    app.use((req: Request, _res: Response, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

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
