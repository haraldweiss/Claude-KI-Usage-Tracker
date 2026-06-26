// Simple Ollama benchmark script
// Usage: node benchmark-test.js [--model MODEL_NAME]

import { randomUUID } from 'crypto';
import os from 'os';

const OLLAMA_BASE = 'http://localhost:11434';

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function discoverOllamaModels() {
  try {
    const data = await fetchWithRetry(`${OLLAMA_BASE}/api/tags`);
    return (data.models || []).map(m => m.name);
  } catch (e) {
    console.error('Failed to discover Ollama models:', e.message);
    return [];
  }
}

async function testModel(modelName, testIndex) {
  const prompt = `Write a short paragraph explaining why renewable energy is important for economic development. Keep it concise (2-3 sentences).`;
  
  try {
    const response = await fetchWithRetry(`${OLLAMA_BASE}/api/generate`, 2);
    
    if (response.error) {
      throw new Error(response.error || 'Model generation failed');
    }
    
    const responseText = response.response || response.text || '';
    
    if (!responseText || responseText.trim().length < 20) {
      throw new Error('Response too short or empty');
    }
    
    return {
      success: true,
      response: responseText,
      tokens: responseText.split(' ').length,
      model: modelName,
      testIndex: testIndex,
      timestamp: new Date().toISOString()
    };
    
  } catch (e) {
    return {
      success: false,
      error: e.message,
      model: modelName,
      testIndex: testIndex,
      timestamp: new Date().toISOString()
    };
  }
}

async function runBenchmark(modelName, quickCount = 2) {
  console.log(`\n🔍 Testing model: ${modelName}`);
  console.log('='.repeat(60));
  
  const results = [];
  const totalTests = quickCount;
  
  for (let i = 0; i < totalTests; i++) {
    console.log(`Test ${i + 1}/${totalTests}: ...`);
    process.stdout.write('  Running inference... ');
    
    const result = await testModel(modelName, i);
    
    if (result.success) {
      console.log('✓ Success');
      console.log(`    Tokens generated: ${result.tokens}\n`);
      results.push(result);
    } else {
      console.log('✗ Failed');
      console.log(`    Error: ${result.error}\n`);
      results.push(result);
    }
  }
  
  const successfulTests = results.filter(r => r.success);
  const failedTests = results.filter(r => !r.success);
  
  const stats = {
    model: modelName,
    totalTests: totalTests,
    successfulTests: successfulTests.length,
    failedTests: failedTests.length,
    successRate: (successfulTests.length / totalTests * 100).toFixed(1) + '%',
    avgTokens: successfulTests.length > 0 
      ? successfulTests.reduce((sum, r) => sum + r.tokens, 0) / successfulTests.length 
      : 0,
    timestamp: new Date().toISOString(),
    results: results
  };
  
  console.log('📊 Results Summary:');
  console.log(`  Success Rate: ${stats.successRate}`);
  console.log(`  Failed Tests: ${stats.failedTests}/${stats.totalTests}`);
  console.log(`  Avg Tokens/Test: ${stats.avgTokens.toFixed(1)}`);
  console.log('='.repeat(60));
  
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  
  let modelName = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && i + 1 < args.length) {
      modelName = args[i + 1];
      break;
    }
  }
  
  let modelsToTest = [];
  
  if (modelName) {
    modelsToTest = [modelName];
    console.log(`Specified model: ${modelName}`);
  } else {
    console.log('No model specified, discovering available Ollama models...');
    try {
      modelsToTest = await discoverOllamaModels();
      if (modelsToTest.length === 0) {
        console.error('No Ollama models found. Make sure Ollama is running and models are pulled.');
        process.exit(1);
      }
      console.log(`Found ${modelsToTest.length} model(s): ${modelsToTest.join(', ')}`);
    } catch (e) {
      console.error('Failed to discover models:', e.message);
      process.exit(1);
    }
  }
  
  const benchmarkId = randomUUID();
  const machineName = `${os.hostname()} (${os.cpus()[0]?.model?.split('@')[0]?.trim() || 'unknown'})`;
  const quickCount = 2;
  
  console.log(`\n🚀 Starting Ollama Benchmark - ${machineName}`);
  console.log(`Benchmark ID: ${benchmarkId}`);
  console.log(`Tests: ${quickCount} inference tasks per model`);
  
  const allResults = [];
  
  for (const model of modelsToTest) {
    const result = await runBenchmark(model, quickCount);
    allResults.push(result);
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n🎯 Final Benchmark Results:');
  console.log('='.repeat(60));
  
  const successfulModels = allResults.filter(r => r.successRate === '100.0%');
  const partialModels = allResults.filter(r => r.successRate !== '100.0%' && r.failedTests === 0);
  const failedModels = allResults.filter(r => r.failedTests === allResults[0]?.totalTests);
  
  console.log(`Models Tested: ${allResults.length}`);
  console.log(`✓ Fully Successful: ${successfulModels.length}`);
  console.log(`⚠️ Partially Successful: ${partialModels.length}`);
  console.log(`✗ Failed: ${failedModels.length}`);
  
  console.log('\n📱 Model Details:');
  allResults.forEach(result => {
    console.log(`\n🖥️ Model: ${result.model}`);
    console.log(`   Status: ${result.successRate === '100.0%' ? '✓ Success' : result.successRate === '0.0%' ? '✗ Failed' : '⚠️ Partial'}`);
    console.log(`   Success Rate: ${result.successRate}`);
    console.log(`   Avg Tokens: ${result.avgTokens.toFixed(1)}`);
  });
  
  console.log('\n✅ Benchmark complete!');
}

main().catch(console.error);
