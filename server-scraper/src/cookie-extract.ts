/**
 * Extract cookies from Chrome's profile and save them for Playwright.
 * Uses Chrome's SQLite cookie database directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

const CHROME_PROFILES = [
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default'),
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Profile 1'),
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Profile 2'),
];

const TARGET_COOKIES: Record<string, string[]> = {
  'claude-ai': [
    'claude.ai', 'platform.claude.com', 'account.anthropic.com',
  ],
  'anthropic-console': [
    'platform.claude.com', 'console.anthropic.com',
  ],
  'claude-code': [
    'platform.claude.com',
  ],
  'opencode-go': [
    'opencode.ai',
  ],
  'zai': [
    'z.ai', 'bigmodel.cn',
  ],
  'codex': [
    'chatgpt.com', 'openai.com',
  ],
  'openai-api': [
    'platform.openai.com', 'openai.com',
  ],
};

function findChromeCookieFile(): string | null {
  for (const profile of CHROME_PROFILES) {
    const cookieFile = path.join(profile, 'Cookies');
    if (fs.existsSync(cookieFile)) {
      console.log(`[cookies] found Chrome profile: ${profile}`);
      return cookieFile;
    }
  }
  return null;
}

function extractCookies(cookieFile: string, domains: string[]): unknown[] {
  // Copy to temp to avoid SQLite locking issues
  const tmpFile = `/tmp/chrome-cookies-${Date.now()}.db`;
  fs.copyFileSync(cookieFile, tmpFile);

  try {
    // Use sqlite3 CLI to query cookies
    const domainFilter = domains.map((d) => `'%${d}%'`).join(', ');
    const query = `
      SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly
      FROM cookies
      WHERE ${domains.map((d) => `host_key LIKE '%${d}%'`).join(' OR ')}
      AND expires_utc > 0
    `;

    const output = execSync(
      `sqlite3 -json "${tmpFile}" "${query}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );

    return JSON.parse(output || '[]');
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function convertToPlaywright(chromeCookies: any[]): any[] {
  return chromeCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.host_key,
    path: c.path || '/',
    expires: c.expires_utc ? Math.round(c.expires_utc / 1000000 - 11644473600) : Math.round(Date.now() / 1000) + 86400,
    httpOnly: c.is_httponly === 1,
    secure: c.is_secure === 1,
    sameSite: 'Lax',
  }));
}

async function main() {
  const cookieFile = findChromeCookieFile();
  if (!cookieFile) {
    console.error('No Chrome profile found');
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'cookies');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, domains] of Object.entries(TARGET_COOKIES)) {
    const cookies = extractCookies(cookieFile, domains);
    const pwCookies = convertToPlaywright(cookies);

    const filePath = path.join(outDir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(pwCookies, null, 2), 'utf-8');
    console.log(`[cookies] ${key}: ${pwCookies.length} cookies → ${key}.json`);
  }

  console.log('\n✅ Done. Cookies saved to cookies/');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
