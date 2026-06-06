// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import cron from 'node-cron';
import logger from './utils/logger.js';
import { initDatabase, closeDatabase, runQuery } from './database/sqlite.js';
import {
  schedulePricingCheck,
  seedFromFallbackIfEmpty,
  seedOpenCodeGoPricing,
  checkAndUpdatePricing
} from './services/pricingService.js';
import { refreshModelAnalytics } from './services/modelRecommendationService.js';
import {
  seedPlanPricingIfEmpty,
  schedulePlanPricingRefresh,
  refreshOpenCodeGoPricing
} from './services/planPricingService.js';
import {
  refreshExchangeRate,
  scheduleExchangeRateRefresh
} from './services/exchangeRateService.js';
import { syncProviderServiceEvents } from './services/providerServiceSyncService.js';
import { listAllActiveProviderUserIds } from './data/localUsageRepo.js';
import { applyDuePlanChanges } from './services/planScheduleService.js';
import {
  refreshCuratedHfCache,
  refreshLatestUploads,
  isCacheEmpty,
  evictStaleSearchCacheRows,
} from './services/catalogCacheRefresh.js';
import { isLatestUploadsEmpty, listLatestUploads } from './data/latestUploadsRepo.js';
import {
  generateBatchProsCons,
  isProsConsEnabled,
} from './services/catalogProsConsService.js';
import { getCachedCard } from './data/catalogCacheRepo.js';
import type { ModelCard } from './services/catalogService.js';
import { createApp } from './app.js';

const app = createApp();
const PORT = process.env.PORT || 3001;

// Initialize database and start server
async function start(): Promise<void> {
  try {
    await initDatabase();
    logger.info('Database initialized');

    await seedFromFallbackIfEmpty();
    logger.info('Pricing seeded if empty');

    await seedPlanPricingIfEmpty();
    logger.info('Plan pricing seeded if empty');

    await seedOpenCodeGoPricing();
    logger.info('OpenCode Go model pricing seeded');

    // Kick off a one-time OpenCode Go price fetch at startup (non-blocking).
    refreshOpenCodeGoPricing()
      .then((r) =>
        logger.info(r.updated
          ? `Startup OpenCode Go pricing: ${r.monthly_usd} USD ≈ ${r.monthly_eur?.toFixed(2)} EUR`
          : `Startup OpenCode Go pricing skipped: ${r.error || 'no update'}`
        )
      )
      .catch((err: Error) => logger.error({ err }, 'Startup OpenCode Go pricing error'));

    // Kick off a one-time fetch at startup, but don't block the server on it.
    // If LiteLLM is unreachable, log and continue — the daily cron will retry.
    checkAndUpdatePricing()
      .then((updated) =>
        logger.info(updated ? 'Startup pricing fetch updated rows' : 'Startup pricing fetch found no changes')
      )
      .catch((err: Error) => logger.error({ err }, 'Startup pricing fetch error'));

    // Schedule daily pricing check (model prices via LiteLLM)
    schedulePricingCheck(cron);

    // Plan-schedule cron: flip users.plan_name when a scheduled change is due.
    cron.schedule('5 0 * * *', async () => {
      try {
        const synced = await applyDuePlanChanges();
        if (synced > 0) logger.info(`[planSchedule] ${synced} user(s) synced`);
      } catch (err) {
        logger.error({ err }, 'Scheduled plan-change apply failed');
      }
    });
    // Run once at startup in case the server was down during the cron tick.
    applyDuePlanChanges().catch((err: Error) =>
      logger.error({ err }, 'Startup plan-schedule apply failed')
    );

    // Schedule daily refresh of plan subscription pricing (best-effort)
    schedulePlanPricingRefresh(cron);

    // Daily USD/EUR exchange-rate refresh (Frankfurter / ECB). Also kick
    // off one fetch right at startup so a fresh install has a rate ready
    // before the first dashboard load — don't await it, the cron will
    // backfill if startup fails.
    scheduleExchangeRateRefresh(cron);
    refreshExchangeRate().catch((err: Error) =>
      logger.error({ err }, 'Startup exchange-rate refresh failed')
    );

    // Schedule daily model analytics refresh at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('Running scheduled model analytics refresh...');
        await refreshModelAnalytics();
      } catch (error) {
        logger.error({ err: error }, 'Scheduled analytics refresh failed');
      }
    });

    // Schedule hourly cleanup of expired sessions and magic-link tokens
    cron.schedule('0 * * * *', async () => {
      try {
        const sessions = await runQuery(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
        const tokens = await runQuery(`DELETE FROM magic_link_tokens WHERE expires_at < datetime('now')`);
        if (sessions.changes || tokens.changes) {
          logger.info(`[cleanup] sessions: ${sessions.changes}, magic_link_tokens: ${tokens.changes}`);
        }
      } catch (err) {
        logger.error({ err }, '[cleanup] error');
      }
    });
    logger.info('Hourly cleanup scheduled for expired sessions and magic-link tokens');

    // Pull usage events from each configured ai-provider-service every 15 min.
    // Iterates per tracker-user; sync internally fans out across that user's
    // provider_user_ids. Per-id failures are logged but do not abort the loop.
    async function runProviderServiceSyncTick(): Promise<void> {
      const active = await listAllActiveProviderUserIds();
      const userIds = Array.from(new Set(active.map((a) => a.user_id)));
      for (const uid of userIds) {
        try {
          const r = await syncProviderServiceEvents(uid);
          for (const p of r.perId) {
            if (p.newEvents > 0) {
              logger.info(`[provider-service-sync] user=${uid} providerUserId=${p.providerUserId} new=${p.newEvents}`);
            }
            if (!p.ok) {
              logger.warn(`[provider-service-sync] user=${uid} providerUserId=${p.providerUserId} error=${p.error}`);
            }
          }
        } catch (err) {
          logger.error({ uid, err }, '[provider-service-sync] unexpected');
        }
      }
    }
    cron.schedule('*/15 * * * *', () => {
      runProviderServiceSyncTick().catch((err) =>
        logger.error({ err }, '[provider-service-sync] cron tick error')
      );
    });
    // Kick off one tick on startup so the dashboard has data without waiting.
    runProviderServiceSyncTick().catch((err) =>
      logger.error({ err }, '[provider-service-sync] startup tick error')
    );
    logger.info('Provider-service sync scheduled every 15 minutes');

    // Sub-B.1: Daily refresh of HF metadata for curated catalog models at 04:00.
    // Offset from the 02:00 pricing cron to avoid network spikes.
    cron.schedule('0 4 * * *', async () => {
      try {
        logger.info('[catalog-cache] starting daily refresh');
        const r = await refreshCuratedHfCache();
        logger.info(`[catalog-cache] curated refreshed=${r.refreshed} failed=${r.failed}`);
        const l = await refreshLatestUploads();
        logger.info(`[catalog-cache] latest  refreshed=${l.refreshed} failed=${l.failed}`);
        // B.3: evict search-hit cache rows older than 90 days (curated/latest immune).
        const e = await evictStaleSearchCacheRows();
        logger.info(`[catalog-cache] evicted ${e.evicted} stale search rows`);
        for (const err of [...r.errors, ...l.errors]) {
          logger.warn(`[catalog-cache] ${err.repo}: ${err.error}`);
        }
      } catch (err) {
        logger.error({ err }, '[catalog-cache] cron error');
      }
    });
    logger.info('Catalog HF cache refresh scheduled daily at 04:00');

    // On startup: prime each table independently so the first page-load
    // doesn't have to fall back to live HF for every model. We check the
    // two tables separately because the upgrade path from B.1 → B.2 leaves
    // the curated cache populated but the latest_uploads table empty —
    // a combined empty-check would miss that case.
    Promise.all([isCacheEmpty(), isLatestUploadsEmpty()])
      .then(async ([curatedEmpty, latestEmpty]) => {
        if (curatedEmpty) {
          logger.info('[catalog-cache] curated empty on startup — priming');
          const rc = await refreshCuratedHfCache();
          logger.info(`[catalog-cache] primed curated=${rc.refreshed}/${rc.failed}`);
        }
        if (latestEmpty) {
          logger.info('[catalog-cache] latest empty on startup — priming');
          const rl = await refreshLatestUploads();
          logger.info(`[catalog-cache] primed latest=${rl.refreshed}/${rl.failed}`);
        } else if (isProsConsEnabled()) {
          // B.3 upgrade path: latest is already populated by B.2, but pros are
          // missing on the existing rows because B.3 wasn't yet deployed when
          // they were inserted. Backfill pros for any latest_upload that lacks
          // them, so the user doesn't have to wait until the next 04:00 cron.
          const latestRows = await listLatestUploads();
          const missing: ModelCard[] = [];
          for (const row of latestRows) {
            const cached = await getCachedCard(row.repo);
            if (cached && (!cached.card.pros || cached.card.pros.length === 0)) {
              missing.push(cached.card);
            }
          }
          if (missing.length > 0) {
            logger.info(`[catalog-pros] backfilling pros for ${missing.length} existing latest uploads`);
            const r = await generateBatchProsCons(missing);
            logger.info(`[catalog-pros] backfill: generated=${r.generated} failed=${r.failed} skipped=${r.skipped}`);
          }
        }
      })
      .catch((err) => logger.error({ err }, '[catalog-cache] prime error'));

    app.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT}`);
      logger.info('Available endpoints:');
      logger.info('  POST   /api/usage/track');
      logger.info('  GET    /api/usage/summary');
      logger.info('  GET    /api/usage/models');
      logger.info('  GET    /api/usage/history');
      logger.info('  GET    /api/pricing');
      logger.info('  PUT    /api/pricing/:model');
      logger.info('  POST   /api/recommend');
      logger.info('  GET    /api/recommend/analysis/models');
      logger.info('  GET    /api/recommend/analysis/opportunities');
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await closeDatabase();
  process.exit(0);
});

// Uncaught Exception Handler
process.on('uncaughtException', (err: Error) => {
  logger.error({ err }, 'Uncaught Exception');
  logger.error({ stack: err.stack }, 'Stack');
  process.exit(1);
});

// Unhandled Promise Rejection Handler
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error({ promise, reason }, 'Unhandled Rejection');
});

start();

export default app;
