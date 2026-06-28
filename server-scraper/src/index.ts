#!/usr/bin/env tsx
/**
 * KI Usage Tracker — Server-side Scraper
 *
 * Runs Playwright-based scrapers against all configured sources and posts
 * usage data to the backend API.
 *
 * Usage:
 *   tsx src/index.ts              # Run all scrapers once, then exit
 *   tsx src/index.ts --scraper console,zai  # Run specific scrapers
 *   tsx src/index.ts --list       # List available scrapers
 *
 * Cron (oracle-vm): every 15 min
 *   cd /opt/server-scraper && tsx src/index.ts
 */
import { runAll } from './runner.js';
import { closeBrowser } from './browser.js';
import { SCRAPER_REGISTRY } from './types.js';

function printUsage(): void {
  console.log(`Usage: tsx src/index.ts [options]
Options:
  --once                  Run all scrapers once (default)
  --scraper <k1,k2,...>   Run specific scrapers (comma-separated keys)
  --list                  List available scrapers
  --help                  Show this help
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.includes('--list')) {
    console.log('\nAvailable scrapers:');
    for (const [key, config] of Object.entries(SCRAPER_REGISTRY)) {
      console.log(`  ${key.padEnd(18)} ${config.label}`);
    }
    console.log();
    process.exit(0);
  }

  // Parse scraper filter
  const scraperIdx = args.indexOf('--scraper');
  const scrapers = scraperIdx !== -1 && scraperIdx + 1 < args.length
    ? args[scraperIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  console.log(`[scraper] starting at ${new Date().toISOString()}`);
  if (scrapers) {
    console.log(`[scraper] filtered scrapers: ${scrapers.join(', ')}`);
  } else {
    console.log(`[scraper] running all ${Object.keys(SCRAPER_REGISTRY).length} scrapers`);
  }

  try {
    const results = await runAll({ scrapers, closeOnFinish: true });

    // Print summary
    const ok = results.filter((r) => r.success).length;
    const fail = results.filter((r) => !r.success).length;
    console.log(`\n=== Summary: ${ok} ✅, ${fail} ❌ ===`);
    for (const r of results) {
      if (r.success) {
        const detail = r.skipped ? `skipped: ${r.reason}` : `posted: ${r.posted || 0} rows`;
        console.log(`  ✅ ${r.source}: ${detail}`);
      } else {
        console.log(`  ❌ ${r.source}: ${r.error || r.reason || 'unknown error'}`);
      }
    }

    process.exit(fail > 0 && ok === 0 ? 1 : 0);
  } catch (err) {
    console.error(`[scraper] FATAL:`, err);
    await closeBrowser().catch(() => {});
    process.exit(1);
  }
}

main();
