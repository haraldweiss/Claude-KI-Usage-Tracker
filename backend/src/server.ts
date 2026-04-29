import cron from 'node-cron';
import { initDatabase, closeDatabase } from './database/sqlite.js';
import {
  schedulePricingCheck,
  seedFromFallbackIfEmpty,
  checkAndUpdatePricing
} from './services/pricingService.js';
import { refreshModelAnalytics } from './services/modelRecommendationService.js';
import {
  seedPlanPricingIfEmpty,
  schedulePlanPricingRefresh
} from './services/planPricingService.js';
import {
  refreshExchangeRate,
  scheduleExchangeRateRefresh
} from './services/exchangeRateService.js';
import { createApp } from './app.js';

const app = createApp();
const PORT = process.env.PORT || 3000;

// Initialize database and start server
async function start(): Promise<void> {
  try {
    await initDatabase();
    console.log('Database initialized');

    await seedFromFallbackIfEmpty();
    console.log('Pricing seeded if empty');

    await seedPlanPricingIfEmpty();
    console.log('Plan pricing seeded if empty');

    // Kick off a one-time fetch at startup, but don't block the server on it.
    // If LiteLLM is unreachable, log and continue — the daily cron will retry.
    checkAndUpdatePricing()
      .then((updated) =>
        console.log(updated ? 'Startup pricing fetch updated rows' : 'Startup pricing fetch found no changes')
      )
      .catch((err) => console.error('Startup pricing fetch error:', (err as Error).message));

    // Schedule daily pricing check (model prices via LiteLLM)
    schedulePricingCheck(cron);

    // Schedule daily refresh of plan subscription pricing (best-effort)
    schedulePlanPricingRefresh(cron);

    // Daily USD/EUR exchange-rate refresh (Frankfurter / ECB). Also kick
    // off one fetch right at startup so a fresh install has a rate ready
    // before the first dashboard load — don't await it, the cron will
    // backfill if startup fails.
    scheduleExchangeRateRefresh(cron);
    refreshExchangeRate().catch((err) =>
      console.error('Startup exchange-rate refresh failed:', (err as Error).message)
    );

    // Schedule daily model analytics refresh at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('Running scheduled model analytics refresh...');
        await refreshModelAnalytics();
      } catch (error) {
        console.error('Scheduled analytics refresh failed:', error);
      }
    });

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
