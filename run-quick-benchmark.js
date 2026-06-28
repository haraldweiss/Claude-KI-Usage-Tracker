// Quick Ollama benchmark for the new qwen3.6 model
const modelName = 'qwen3.6:latest';
const prompt = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';

console.log('=== OLLAMA BENCHMARK FOR NEW MODEL ===');
console.log('Model:', modelName);
console.log('Testing with prompt:', prompt);
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
  console.log('Tokens generated:', data.response ? data.response.split(' ').length : 0);
  console.log('---');
  
  if (data.response && data.response.trim().length > 10) {
    console.log('✅ BENCHMARK PASSED - Model responded successfully!');
    console.log('Response preview:', data.response.substring(0, 100) + '...');
  } else {
    console.log('❌ BENCHMARK FAILED - Model did not provide a valid response');
    process.exit(1);
  }
})
.catch(error => {
  console.error('Benchmark error:', error);
  process.exit(1);
});
