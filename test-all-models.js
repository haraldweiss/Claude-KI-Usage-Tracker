// Test all Ollama models to find which ones work
const OLLAMA_BASE = 'http://localhost:11434';
const prompt = 'Explain renewable energy briefly.';

async function testModel(modelName) {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt: prompt,
        stream: false
      })
    });
    
    if (!response.ok) {
      return { model: modelName, status: response.status, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    const responseText = data.response || '';
    
    if (!responseText || responseText.trim().length < 10) {
      return { model: modelName, status: 'empty', error: 'Empty response' };
    }
    
    return { 
      model: modelName, 
      status: 'success', 
      tokens: responseText.split(' ').length,
      response: responseText.substring(0, 50) + '...' 
    };
    
  } catch (e) {
    return { model: modelName, status: 'error', error: e.message };
  }
}

async function main() {
  // Get available models
  const tagsResponse = await fetch(`${OLLAMA_BASE}/api/tags`);
  const tagsData = await tagsResponse.json();
  const allModels = tagsData.models?.map(m => m.name) || [];
  
  console.log('=== AVAILABLE MODELS ===');
  console.log('Total models:', allModels.length);
  console.log('Models:', allModels.join(', '));
  console.log('\n=== TESTING EACH MODEL ===');
  
  const results = [];
  
  for (const model of allModels) {
    console.log(`\nTesting: ${model}...`);
    const result = await testModel(model);
    results.push(result);
    
    if (result.status === 'success') {
      console.log(`✅ SUCCESS - ${result.tokens} tokens generated`);
      console.log(`Preview: ${result.response}`);
    } else {
      console.log(`❌ FAILED - ${result.error}`);
    }
  }
  
  console.log('\n=== SUMMARY ===');
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status !== 'success').length;
  
  console.log(`Total tested: ${allModels.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Fail: ${failCount}`);
  
  if (successCount > 0) {
    console.log('\n=== SUCCESSFUL MODELS ===');
    results.filter(r => r.status === 'success').forEach(r => {
      console.log(`${r.model} - ${r.tokens} tokens`);
    });
    return true;
  } else {
    console.log('\n=== NO SUCCESSFUL MODELS FOUND ===');
    return false;
  }
}

main().catch(console.error);
