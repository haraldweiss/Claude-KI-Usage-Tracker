// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
const COOKIE_DIR = process.env.COOKIE_DIR || '/app/data/cookies';

/**
 * POST /api/cookies/upload
 *
 * Receives cookies from the Chrome extension (exported via chrome.cookies.getAll)
 * and saves them as per-service JSON files for the Playwright server-scraper.
 */
export async function uploadCookies(req: Request, res: Response): Promise<void> {
  try {
    const { cookies } = req.body;
    if (!Array.isArray(cookies) || cookies.length === 0) {
      res.status(400).json({ error: 'No cookies provided' });
      return;
    }

    // Group cookies by service domain
    const byService: Record<string, typeof cookies> = {};
    for (const c of cookies) {
      const domain = c.domain || '';
      let service: string | null = null;
      if (domain.includes('claude.ai') && !domain.includes('platform.claude')) service = 'claude-ai';
      else if (domain.includes('platform.claude.com')) service = 'claude-code';
      else if (domain.includes('console.anthropic')) service = 'anthropic-console';
      else if (domain.includes('opencode.ai')) service = 'opencode-go';
      else if (domain.includes('openrouter.ai')) service = 'openrouter';
      else if (domain.includes('cline.bot')) service = 'cline';
      else if (domain.includes('z.ai')) service = 'zai';
      else if (domain.includes('chatgpt.com')) service = 'codex';
      else if (domain.includes('openai.com')) service = 'openai-api';
      if (service) {
        if (!byService[service]) byService[service] = [];
        (byService[service] as typeof cookies).push(c);
      }
    }

    fs.mkdirSync(COOKIE_DIR, { recursive: true });
    let total = 0;
    for (const [service, serviceCookies] of Object.entries(byService)) {
      const filePath = path.join(COOKIE_DIR, `${service}.json`);
      fs.writeFileSync(filePath, JSON.stringify(serviceCookies, null, 2), 'utf-8');
      total += serviceCookies.length;
    }
    const combinedPath = path.join(COOKIE_DIR, 'combined.json');
    fs.writeFileSync(combinedPath, JSON.stringify(byService, null, 2), 'utf-8');

    console.log(`[cookies] saved ${total} cookies across ${Object.keys(byService).length} services`);
    res.json({ success: true, total, services: Object.keys(byService).length });
  } catch (err) {
    console.error('[cookies] upload error:', err);
    res.status(500).json({ error: String(err) });
  }
}
