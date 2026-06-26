#!/usr/bin/env node

const modelName = 'qwen3.6:latest';
const prompt = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';

console.log('=== OLLAMA MODEL TEST ===');
console.log('Model:', modelName);
console.log('---');

fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: modelName,
    prompt: prompt,
    stream: false
  })
})
.then(response => {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
})
.then(data => {
  console.log('Response:', data.response);
  console.log('Tokens:', data.response ? data.response.split(' ').length : 0);
  
  if (data.response && data.response.trim().length > 10) {
    console.log('\n✅ SUCCESS: Model responded with valid content');
    console.log('\n=== SAMPLE RESPONSE ===');
    console.log(data.response.substring(0, 200) + '...');
    process.exit(0);
  } else {
    console.log('\n❌ FAILED: Model did not provide valid response');
    process.exit(1);
  }
})
.catch(error => {
  console.error('\n❌ ERROR:', error.message);
  process.exit(1);
});
