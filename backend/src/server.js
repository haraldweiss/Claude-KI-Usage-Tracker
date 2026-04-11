import express from 'express';
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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/usage', usageRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/recommend', recommendationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Global Error Handler (must be LAST middleware)
app.use(errorHandler);

// Initialize database and start server
async function start() {
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
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  // Note: After an uncaught exception, the process should be restarted
  // It's recommended to exit and let a process manager (PM2, systemd, etc.) restart it
  process.exit(1);
});

// Unhandled Promise Rejection Handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Note: We don't exit here, just log it
  // The error might be non-critical
});

start();
