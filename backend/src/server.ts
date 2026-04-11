import express from 'express';
import type { Express, Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import cron from 'node-cron';
import { initDatabase, closeDatabase } from './database/sqlite.js';
import { initializePricing } from './controllers/pricingController.js';
import { schedulePricingCheck } from './services/pricingService.js';
import { refreshModelAnalytics } from './services/modelRecommendationService.js';
import usageRoutes from './routes/usage.js';
import pricingRoutes from './routes/pricing.js';
import recommendationRoutes from './routes/recommendation.js';
import errorHandler from './middleware/errorHandler.js';

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, _res: Response, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/usage', usageRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/recommend', recommendationRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Global Error Handler (must be LAST middleware)
app.use(errorHandler);

// Initialize database and start server
async function start(): Promise<void> {
  try {
    await initDatabase();
    console.log('Database initialized');

    await initializePricing();
    console.log('Pricing initialized');

    // Schedule daily pricing check
    schedulePricingCheck(cron);
    console.log('Pricing check scheduled');

    // Schedule daily model analytics refresh at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('Running scheduled model analytics refresh...');
        await refreshModelAnalytics();
      } catch (error) {
        console.error('Error in scheduled analytics refresh:', error);
      }
    });
    console.log('Model analytics refresh scheduled');

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log('Available endpoints:');
      console.log('  POST   /api/usage/track');
      console.log('  GET    /api/usage/summary');
      console.log('  GET    /api/usage/models');
      console.log('  GET    /api/usage/history');
      console.log('  GET    /api/pricing');
      console.log('  PUT    /api/pricing/:model');
      console.log('  POST   /api/recommend');
      console.log('  GET    /api/recommend/analysis/models');
      console.log('  GET    /api/recommend/analysis/opportunities');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await closeDatabase();
  process.exit(0);
});

// Uncaught Exception Handler
process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

// Unhandled Promise Rejection Handler
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

start();

export default app;
