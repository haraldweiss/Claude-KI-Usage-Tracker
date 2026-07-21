const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadParser(file) {
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return context.module.exports;
}

function loadScripts(files) {
  const context = {
    module: { exports: {} },
    exports: {},
    Date,
    Number,
    JSON,
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return context.module.exports;
}

function loadOptionalScript(file) {
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), context);
  }
  return context.module.exports;
}

test('uses only explicitly configured providers for extension syncs', () => {
  const { getConfiguredProviderKeys } = loadOptionalScript('provider-sync-config.js');

  assert.equal(typeof getConfiguredProviderKeys, 'function');
  assert.deepEqual(
    Array.from(getConfiguredProviderKeys([
      { key: 'zai', plan_name: 'GLM Coding Lite-Monthly Plan' },
      { key: 'openai_api', plan_name: 'API Usage' },
      { key: 'codex', plan_name: null },
      { key: 'anthropic_api', plan_name: '' }
    ])).sort(),
    ['openai_api', 'zai']
  );
});

test('parses German Codex percentages as remaining capacity', () => {
  const { parseCodexUsageText } = loadParser('usage-parser-codex.js');
  const result = parseCodexUsageText(`
    5 Stunden Nutzungsgrenze 91 % verbleibend Zurücksetzungen 22.06.2026 04:36
    Wöchentliches Nutzungslimit 99 % verbleibend Zurücksetzungen 28.06.2026 23:36
    Monatliches Nutzungslimit 88 % verbleibend Zurücksetzungen 01.07.2026 00:00
    Verbleibende Credits 12,5 Interaktionen 7 Plugins calls 2 Skills used 3
  `);
  assert.equal(result.success, true);
  assert.equal(result.data.five_hour_remaining_pct, 91);
  assert.equal(result.data.weekly_remaining_pct, 99);
  assert.equal(result.data.monthly_remaining_pct, 88);
  assert.equal(result.data.credits_remaining, 12.5);
  assert.equal(result.data.interactions, 7);
  assert.equal(result.data.plugin_calls, 2);
  assert.equal(result.data.skills_used, 3);
});

test('parses English Codex labels', () => {
  const { parseCodexUsageText } = loadParser('usage-parser-codex.js');
  const result = parseCodexUsageText(`
    5 hour usage limit 42% remaining Resets Jun 22, 2026 4:36 AM
    Weekly usage limit 73% remaining Resets Jun 28, 2026 11:36 PM
    Monthly usage limit 64% remaining Resets Jul 1, 2026 12:00 AM
    Credits remaining 8 Interactions 4 Plugin calls 1 Skills used 2
  `);
  assert.equal(result.success, true);
  assert.equal(result.data.five_hour_remaining_pct, 42);
  assert.equal(result.data.weekly_remaining_pct, 73);
  assert.equal(result.data.monthly_remaining_pct, 64);
  assert.equal(result.data.credits_remaining, 8);
});

test('rejects Codex text without both required limit cards', () => {
  const { parseCodexUsageText } = loadParser('usage-parser-codex.js');
  const result = parseCodexUsageText('Codex Analytics');
  assert.equal(result.success, false);
  assert.equal(result.reason, 'usage_cards_not_found');
});

test('accepts zero API usage for a verified month-to-date period', () => {
  const { parseOpenAiApiUsageText } = loadParser('usage-parser-openai-api.js');
  const result = parseOpenAiApiUsageText(
    'Jun 1–Jun 22 Total spend $0.00 Total tokens 0 Requests 0 Organization wolfini',
    { start: '2026-06-01', end: '2026-06-22' }
  );
  assert.equal(result.success, true);
  assert.equal(result.data.cost_usd, 0);
  assert.equal(result.data.organization_name, 'wolfini');
  assert.equal(result.data.period_start, '2026-06-01');
  assert.equal(result.data.period_end, '2026-06-22');
});

test('parses nonzero API totals with abbreviated tokens', () => {
  const { parseOpenAiApiUsageText } = loadParser('usage-parser-openai-api.js');
  const result = parseOpenAiApiUsageText(
    'All API keys | 06/01/26-06/22/26 | Total Spend | $7.12 | Group by | 1d | June spend | Total tokens | 128K | Total requests | 9',
    { start: '2026-06-01', end: '2026-06-22' }
  );
  assert.equal(result.success, true);
  assert.equal(result.data.cost_usd, 7.12);
  assert.equal(result.data.input_tokens, 128000); // Total tokens used as fallback
  assert.equal(result.data.output_tokens, 0);
  assert.equal(result.data.requests, 9);
});

test('rejects API totals when the calendar period cannot be verified', () => {
  const { parseOpenAiApiUsageText } = loadParser('usage-parser-openai-api.js');
  const result = parseOpenAiApiUsageText(
    'May 23–Jun 22 Total spend $7.12 Total tokens 120K Requests 9 Organization wolfini',
    { start: '2026-06-01', end: '2026-06-22' }
  );
  assert.equal(result.success, false);
  assert.equal(result.reason, 'period_not_verified');
});

test('maps Codex remaining limits into one daily snapshot payload', () => {
  const { buildCodexTrackPayload } = loadScripts([
    'usage-parser-codex.js',
    'background-scraper-codex.js'
  ]);
  const payload = buildCodexTrackPayload({
    five_hour_remaining_pct: 91,
    five_hour_reset_at: '2026-06-22T02:36:00.000Z',
    weekly_remaining_pct: 99,
    weekly_reset_at: '2026-06-28T21:36:00.000Z',
    monthly_remaining_pct: 88,
    monthly_reset_at: '2026-06-30T22:00:00.000Z',
    credits_remaining: 0,
    interactions: 0,
    interactions_by_model: [],
    interactions_by_surface: [],
    plugin_calls: 0,
    skills_used: 0,
    credit_usage: []
  }, '2026-06-22T20:00:00.000Z');
  assert.equal(payload.model, 'OpenAI Codex');
  assert.equal(payload.source, 'codex_sync');
  assert.equal(payload.input_tokens, 0);
  assert.equal(payload.output_tokens, 0);
  assert.equal(payload.cost_usd, 0);
  assert.equal(payload.response_metadata.five_hour_remaining_pct, 91);
  assert.equal(payload.response_metadata.monthly_remaining_pct, 88);
  assert.equal(payload.response_metadata.scraped_at, '2026-06-22T20:00:00.000Z');
});

test('maps verified API usage into a monthly snapshot payload', () => {
  const { buildOpenAiApiTrackPayload } = loadScripts([
    'usage-parser-openai-api.js',
    'background-scraper-openai-api.js'
  ]);
  const payload = buildOpenAiApiTrackPayload({
    organization_name: 'wolfini',
    period_start: '2026-06-01',
    period_end: '2026-06-22',
    cost_usd: 7.12,
    input_tokens: 120000,
    output_tokens: 8000,
    requests: 9,
    by_project: [],
    by_model: []
  }, '2026-06-22T20:00:00.000Z');
  assert.equal(payload.model, 'OpenAI API');
  assert.equal(payload.source, 'openai_api_sync');
  assert.equal(payload.cost_usd, 7.12);
  assert.equal(payload.workspace, 'wolfini');
  assert.equal(payload.response_metadata.period_start, '2026-06-01');
  assert.equal(payload.response_metadata.scraped_at, '2026-06-22T20:00:00.000Z');
});

test('timeout helper rejects stuck sync steps with the step label', async () => {
  const { withTimeout } = loadScripts(['background-utils.js']);

  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 5, 'OpenAI API'),
    /OpenAI API timed out after 5ms/
  );
});

test('normalizes stale running sync-all state to done with an error step', () => {
  const { normalizeSyncAllState } = loadScripts(['background-utils.js']);

  const state = normalizeSyncAllState(
    { status: 'running', startedAt: 1000, steps: [{ label: 'Claude.ai', status: 'skipped', message: 'no_data' }] },
    1000 + 20 * 60 * 1000 + 1
  );

  assert.equal(state.status, 'done');
  assert.equal(state.finishedAt, 1000 + 20 * 60 * 1000 + 1);
  assert.equal(state.steps.at(-1).label, 'Sync');
  assert.equal(state.steps.at(-1).status, 'error');
  assert.match(state.steps.at(-1).message, /abgebrochen/);
});

test('detects Claude.ai upgrade redirect as no active plan', () => {
  const { isClaudeNoPlanUrl } = loadScripts(['background-scraper-claude.js']);

  assert.equal(isClaudeNoPlanUrl('https://claude.ai/upgrade'), true);
  assert.equal(isClaudeNoPlanUrl('https://claude.ai/upgrade?plan=pro'), true);
  assert.equal(isClaudeNoPlanUrl('https://claude.ai/settings/usage'), false);
});

test('detects missing Anthropic Console workspace discovery as no workspaces', () => {
  const { isNoWorkspaceDiscovery } = loadScripts(['background-scraper-console.js']);

  assert.equal(isNoWorkspaceDiscovery(['no workspace links found via observer']), true);
  assert.equal(isNoWorkspaceDiscovery(['inject: permission denied']), false);
});
