// Simple Ollama benchmark script
const modelName = 'qwen3-coder-cc:latest';
const prompt = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';

fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: modelName,
    prompt: prompt,
    stream: false
  })
})
.then(response => response.json())
.then(data => {
  console.log('=== OLLAMA BENCHMARK RESULTS ===');
  console.log('Model:', modelName);
  console.log('Response:', data.response);
  console.log('Tokens:', data.response ? data.response.split(' ').length : 0);
  console.log('=== END BENCHMARK ===');
  
  if (data.response && data.response.trim().length > 10) {
    console.log('\n✅ BENCHMARK PASSED - Model responded successfully!');
  } else {
    console.log('\n❌ BENCHMARK FAILED - Model did not provide a valid response');
    process.exit(1);
  }
})
.catch(error => {
  console.error('Benchmark error:', error);
  process.exit(1);
});
