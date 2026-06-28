/**
 * Interactive login helper.
 * Usage: tsx src/login.ts <scraper-key>
 *
 * Opens a visible browser window, navigates to the login page, lets the user
 * log in manually, then saves cookies to disk for future use.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCRAPER_REGISTRY, AUTH_SHARED } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_DIR = path.resolve(__dirname, '..', 'cookies');

async function main() {
  const scraperKey = process.argv[2];
  if (!scraperKey) {
    console.error('Usage: tsx src/login.ts <scraper-key>');
    console.error('Available keys:', Object.keys(SCRAPER_REGISTRY).join(', '));
    process.exit(1);
  }

  const config = SCRAPER_REGISTRY[scraperKey];
  if (!config) {
    console.error(`Unknown scraper: ${scraperKey}`);
    process.exit(1);
  }

  console.log(`\n🔐 Login for: ${config.label}`);
  console.log(`   URL: ${config.loginUrl}`);
  console.log(`   Cookie key: ${config.cookieKey}`);
  console.log('\nA browser window will open. Please log in manually.');
  console.log('After successful login, press Enter in this terminal to save cookies.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  await page.goto(config.loginUrl, { waitUntil: "load" });

  // Wait for user to press Enter after successful login
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  // Save cookies
  const cookies = await context.cookies();
  const filePath = path.join(COOKIE_DIR, `${config.cookieKey}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf-8');
  console.log(`\n✅ Saved ${cookies.length} cookies to cookies/${config.cookieKey}.json`);

  // If this auth domain is shared, save under all related keys
  for (const [domain, keys] of Object.entries(AUTH_SHARED)) {
    if (keys.includes(scraperKey)) {
      for (const otherKey of keys) {
        if (otherKey !== scraperKey) {
          const otherPath = path.join(COOKIE_DIR, `${otherKey}.json`);
          fs.copyFileSync(filePath, otherPath);
          console.log(`   Also saved as ${otherKey}.json (shared auth domain ${domain})`);
        }
      }
    }
  }

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Login failed:', err);
  process.exit(1);
});
