/**
 * Export cookies from the user's real Chrome profile using Playwright.
 * Opens a non-headless browser with the default Chrome profile,
 * navigates to each service, reads cookies, saves to disk.
 *
 * Usage: npx tsx src/export-cookies-local.ts
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CHROME_PROFILE = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome/Default'
);

const COOKIE_DIR = path.resolve(import.meta.dirname, '..', 'cookies');
const DOMAINS = [
  'https://claude.ai',
  'https://platform.claude.com',
  'https://opencode.ai',
  'https://z.ai',
  'https://chatgpt.com',
  'https://platform.openai.com',
];

async function main() {
  console.log('🚀 Starting Chrome with your default profile…');
  console.log(`   Profile: ${CHROME_PROFILE}`);
  console.log('');

  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 720 },
  });

  const allCookies: Record<string, unknown[]> = {};

  for (const url of DOMAINS) {
    const domain = new URL(url).hostname;
    console.log(`\n📄 Opening ${url}…`);
    
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Read cookies from the page context
      const cookies = await page.evaluate(() => {
        return document.cookie.split(';').map(c => c.trim()).filter(Boolean);
      });
      console.log(`   document.cookie: ${cookies.length} entries`);
      
      // Also get all browser cookies for this domain
      const browserCookies = await context.cookies(url);
      console.log(`   browser cookies: ${browserCookies.length}`);
      
      allCookies[domain] = browserCookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ⚠️  ${msg.substring(0, 100)}`);
      allCookies[domain] = [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  // Save combined cookies
  fs.mkdirSync(COOKIE_DIR, { recursive: true });
  const combinedPath = path.join(COOKIE_DIR, 'combined.json');
  fs.writeFileSync(combinedPath, JSON.stringify(allCookies, null, 2));
  console.log(`\n✅ Combined cookies saved to cookies/combined.json`);

  // Also save per-service files for the server scraper
  for (const [domain, cookies] of Object.entries(allCookies)) {
    if (cookies.length === 0) continue;
    const key = domain.replace(/^www\./, '').split('.')[0];
    const filePath = path.join(COOKIE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
    console.log(`   → ${key}.json (${cookies.length} cookies)`);
  }

  await context.close();
  console.log('\n✨ Done. Rsync cookies/ to the server to activate scrapers.');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
