import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsageNumber, parseOpenAiUsage } from './usage-parsers.js';

test('provider currency formats preserve decimal and thousands separators', () => {
  for (const text of ['$1,234.56', '1.234,56 €']) assert.equal(parseUsageNumber(text), 1234.56);
  assert.equal(parseUsageNumber('12,50'), 12.5);
  assert.equal(parseUsageNumber('2.5M'), 2500000);
  assert.equal(parseUsageNumber('Loading...'), null);
});
test('OpenAI parser requires spend, not a budget or percentage', () => {
  assert.equal(parseOpenAiUsage('Availability 99.9% Budget $100.00'), null);
  assert.equal(parseOpenAiUsage('Sign in Loading...'), null);
  assert.deepEqual(parseOpenAiUsage('Total spend\n$12.50\nTotal tokens\n1.5M\nRequests\n500'),
    { cost_usd: 12.5, total_tokens: 1500000, requests: 500 });
  assert.deepEqual(parseOpenAiUsage('Total spend $0.00'), { cost_usd: 0 });
});
