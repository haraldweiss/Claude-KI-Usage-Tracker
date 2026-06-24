import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_DIR = path.resolve(__dirname, '..', 'cookies');

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Get or create the shared Playwright browser instance.
 * Uses `headless: true` by default; set PLAYWRIGHT_HEADLESS=false to debug.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const headless = process.env.PLAYWRIGHT_HEADLESS !== 'false';
    console.log(`[browser] launching (headless=${headless})`);
    browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browser;
}

/**
 * Get or create a persistent context. When `cookieKey` is provided, loads
 * previously saved cookies (if any) so the session survives restarts.
 */
export async function getContext(cookieKey?: string): Promise<BrowserContext> {
  const b = await getBrowser();

  if (!context || !context.browser()) {
    // Proxy support: set PLAYWRIGHT_PROXY_URL=http://user:pass@host:port
    const proxyUrl = process.env.PLAYWRIGHT_PROXY_URL;
    const ctxOpts: Record<string, unknown> = {
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
    };
    if (proxyUrl) {
      ctxOpts.proxy = { server: proxyUrl };
      console.log(`[browser] using proxy: ${proxyUrl.replace(/:[^:@]+@/, ':****@')}`);
    }
    context = await b.newContext(ctxOpts);

    // Hide Playwright/webdriver automation indicators
    await context.addInitScript(() => {
      // @ts-expect-error override
      delete navigator.__proto__.webdriver;
      // Override chrome.runtime (headless detection)
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Override plugins length (headless has 0)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // Override languages (headless is empty)
      Object.defineProperty(navigator, 'languages', {
        get: () => ['de-DE', 'de', 'en-US', 'en'],
      });
    });

    // Load saved cookies. First try individual cookieKey file (login.ts format),
    // then fall back to the combined export file (extension export format).
    if (cookieKey) {
      await loadCookies(context, cookieKey);
    }
    // Always try the exported cookies file as a supplement (idempotent if missing)
    await loadExportedCookies(context);
  }

  return context;
}

/**
 * Save the current context's cookies to disk so they survive server restarts.
 */
export async function saveCookies(context: BrowserContext, cookieKey: string): Promise<void> {
  const cookies = await context.cookies();
  const filePath = path.join(COOKIE_DIR, `${cookieKey}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf-8');
  console.log(`[cookies] saved ${cookies.length} cookies to ${cookieKey}.json`);
}

/**
 * Load previously saved cookies into a context.
 * Supports two formats:
 *   1. Single-key file: an array of Cookie objects ([[Playwright's standard format]]).
 *   2. Exported file: an object mapping domain → array of Cookie objects
 *      (the format produced by the extension's cookie export).
 */
export async function loadCookies(context: BrowserContext, cookieKey: string): Promise<void> {
  const filePath = path.join(COOKIE_DIR, `${cookieKey}.json`);
  if (!fs.existsSync(filePath)) {
    console.log(`[cookies] no saved cookies for ${cookieKey} — first run?`);
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      // Format 1: direct array of Cookie objects
      if (parsed.length > 0) {
        await context.addCookies(parsed);
        console.log(`[cookies] loaded ${parsed.length} cookies for ${cookieKey}`);
      }
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Format 2: domain-keyed object from extension export
      let total = 0;
      for (const [domain, cookies] of Object.entries(parsed)) {
        if (Array.isArray(cookies) && cookies.length > 0) {
          await context.addCookies(cookies);
          total += cookies.length;
          console.log(`[cookies] added ${cookies.length} cookies for domain ${domain}`);
        }
      }
      console.log(`[cookies] loaded ${total} cookies total from exported file`);
    }
  } catch (err) {
    console.warn(`[cookies] failed to load ${cookieKey}.json:`, err);
  }
}

/**
 * Load the extension's multi-domain cookie export file into a context.
 * This is a convenience wrapper: reads the exported file once and sets all cookies.
 * Only call this ONCE per scraper run (after creating the context).
 */
export async function loadExportedCookies(context: BrowserContext, exportFilePath?: string): Promise<void> {
  const filePath = exportFilePath || path.join(COOKIE_DIR, 'exported-cookies.json');
  if (!fs.existsSync(filePath)) {
    console.log('[cookies] no exported cookies file found at', filePath);
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return;

    let total = 0;
    for (const [domain, cookies] of Object.entries(parsed)) {
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
        total += cookies.length;
        console.log(`[cookies] domain ${domain}: ${cookies.length} cookies loaded`);
      }
    }
    console.log(`[cookies] export file: ${total} cookies total across ${Object.keys(parsed).length} domains`);
  } catch (err) {
    console.warn(`[cookies] failed to load export file:`, err);
  }
}

/**
 * Create a new page, optionally navigate to a URL, and return it.
 */
export async function newPage(url?: string): Promise<Page> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  return page;
}

/**
 * Close the browser instance and free resources.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch { /* ignore */ }
    browser = null;
    context = null;
    console.log('[browser] closed');
  }
}

/**
 * Navigate to a URL and wait for the page to be fully loaded.
 */
export async function navigateAndWait(page: Page, url: string, timeoutMs = 30000): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
}
