/**
 * Export cookies using system Chrome (not Playwright Chromium).
 * System Chrome has proper macOS entitlements to access the user profile.
 */
import { chromium } from "playwright";
import os from "node:os";
import path from 'node:path';
import fs from 'node:fs';

const COOKIE_DIR = path.resolve(import.meta.dirname, '..', 'cookies');
const DOMAINS = [
  'https://claude.ai',
  'https://platform.claude.com',
  'https://opencode.ai',
  'https://z.ai',
  'https://chatgpt.com',
  'https://platform.openai.com',
];

// Cookie key mapping (domain → server-scraper cookie key)
const KEY_MAP: Record<string, string> = {
  'claude.ai': 'claude-ai',
  'www.claude.ai': 'claude-ai',
  'platform.claude.com': 'anthropic-console',
  'opencode.ai': 'opencode-go',
  'z.ai': 'zai',
  'chatgpt.com': 'codex',
  'platform.openai.com': 'openai-api',
};

async function main() {
  console.log('🚀 Launching system Chrome…');
  console.log('   A browser window will open and close quickly.');
  console.log('');

  const context = await chromium.launchPersistentContext(
    path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default'),
    {
      channel: 'chrome',  // Use system Chrome, not Playwright Chromium
      headless: false,
      viewport: { width: 1280, height: 720 },
    }
  );

  const allCookies: Record<string, unknown[]> = {};
  let totalCookies = 0;

  for (const url of DOMAINS) {
    const domain = new URL(url).hostname;
    try {
      const cookies = await context.cookies(url);
      allCookies[domain] = cookies;
      totalCookies += cookies.length;

      const key = KEY_MAP[domain] || domain.split('.')[0];
      const filePath = path.join(COOKIE_DIR, `${key}.json`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
      console.log(`   ${domain}: ${cookies.length} cookies → ${key}.json`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ${domain}: ERROR - ${msg.substring(0, 80)}`);
      allCookies[domain] = [];
    }
  }

  // Save combined
  const combinedPath = path.join(COOKIE_DIR, 'combined.json');
  fs.writeFileSync(combinedPath, JSON.stringify(allCookies, null, 2));
  console.log(`\n✅ Total: ${totalCookies} cookies across ${DOMAINS.length} domains`);
  console.log('   Saved to cookies/');

  await context.close();
  console.log('✨ Done');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
