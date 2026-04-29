// Diagnostic script to test extension fetch interception
// Run this in browser console on ANY page with extension active

console.log('🧪 Starting extension diagnostic test...\n');

// Simulate various Claude API call patterns to see which ones work

const testCalls = [
  {
    name: 'POST with init object',
    url: 'https://claude.ai/api/messages',
    init: { method: 'POST', body: JSON.stringify({ text: 'test' }) }
  },
  {
    name: 'POST with Request object',
    url: new Request('https://claude.ai/api/messages', { method: 'POST' })
  },
  {
    name: 'POST without explicit method (should default)',
    url: 'https://claude.ai/api/messages',
    init: { body: JSON.stringify({ text: 'test' }) }
  },
  {
    name: 'PUT with init object',
    url: 'https://claude.ai/api/conversations/abc123/messages',
    init: { method: 'PUT', body: JSON.stringify({ text: 'update' }) }
  }
];

async function runTests() {
  for (const test of testCalls) {
    console.log(`\n📋 Test: ${test.name}`);
    console.log(`   URL: ${test.url}`);

    try {
      // This will be intercepted by the extension
      if (test.init) {
        await fetch(test.url, test.init);
      } else {
        await fetch(test.url);
      }
      console.log('   ✅ Fetch called');
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}`);
    }
  }

  console.log('\n✅ All tests complete. Check console for 🔍 Claude API call logs.');
}

runTests();
