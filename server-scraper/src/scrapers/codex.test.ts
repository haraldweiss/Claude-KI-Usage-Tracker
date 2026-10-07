import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import type { ScraperConfig } from '../types.js';
import { scrape } from './codex.js';
function page(text: string): Page {
  return { goto: async (url: string) => { assert.equal(url,'https://chatgpt.com/settings/usage?tab=overview'); },
    waitForTimeout: async () => {}, url: () => 'https://chatgpt.com/settings/usage?tab=overview',
    locator: () => ({innerText: async () => text}) } as unknown as Page;
}
const config = {source:'codex_sync',label:'Codex',loginUrl:'https://chatgpt.com/login',cookieKey:'codex'} satisfies ScraperConfig;
test('server scraper preserves current remaining quota and resets',async()=>{
  const result = await scrape(page('5-hour limit\nResets in 5 hours\n98% left\nWeekly limit\nResets in 6d 15h\n99% left'),config);
  assert.equal(result.rows?.[0].response_metadata?.five_hour_remaining_pct,98);
  assert.equal(result.rows?.[0].response_metadata?.weekly_remaining_pct,99);
  assert.ok(result.rows?.[0].response_metadata?.weekly_reset_at);
});
test('server scraper skips historical analytics instead of posting it',async()=>{
  const result=await scrape(page('5-hour limits\n% of limit used\n71.8%\nWeekly limits\n22.2%'),config);
  assert.equal(result.skipped,true);
  assert.equal(result.rows,undefined);
});
