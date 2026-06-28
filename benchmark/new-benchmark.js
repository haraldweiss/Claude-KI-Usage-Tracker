#!/usr/bin/env node
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import os from 'os';

const OLLAMA_BASE = 'http://localhost:11434';
const TIMEOUT_MS = 60000;
const MODEL_NAME = 'hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M';

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      console.log(`Attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

async function pullModel() {
  console.log('Pulling new model:', MODEL_NAME);
  try {
    execSync(`ollama pull ${MODEL_NAME}`, { stdio: 'inherit', timeout: 300000 });
    console.log('Model pulled successfully');
  } catch (error) {
    console.error('Failed to pull model:', error.message);
    process.exit(1);
  }
}

async function testGenerate(model, prompt, testCaseName) {
  console.log(`  Testing ${testCaseName}...`);
  
  const startTime = Date.now();
  try {
    const requestBody = {
      model: model,
      prompt: prompt,
      stream: false,
      options: {
        num_predict: 500,
        temperature: 0.7,
        num_ctx: 2048
      }
    };

    const response = await fetchWithRetry(`${OLLAMA_BASE}/api/generate`, 3);
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    if (!data.response || data.response.trim().length === 0) {
      throw new Error('No response generated');
    }
    
    console.log(`    ✓ Completed in ${duration}ms (${(duration/1000).toFixed(2)}s)`);
    return {
      success: true,
      response: data.response,
      duration: duration,
      tokensPerSecond: data.response.length / (duration / 1000)
    };
  } catch (error) {
    console.error(`    ✗ Failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

async function runBenchmark() {
  console.log('=== DeepSeek-R1-Distill-Qwen-7B-GGUF Benchmark ===\n');
  
  const machineName = `${os.hostname()} (${os.cpus()[0]?.model?.split('@')[0]?.trim() || 'unknown'})`;
  const runId = randomUUID();
  const results = [];
  
  // Pull model if not available
  try {
    await fetchWithRetry(`${OLLAMA_BASE}/api/tags`);
    try {
      const tagsResponse = await fetchWithRetry(`${OLLAMA_BASE}/api/tags`);
      const tagsData = await tagsResponse.json();
      const availableModels = tagsData.models?.map(m => m.name) || [];
      if (!availableModels.includes(MODEL_NAME)) {
        await pullModel();
      }
    } catch (error) {
      await pullModel();
    }
  } catch (error) {
    console.error('Ollama is not running or reachable:', error.message);
    console.log('Start Ollama with: ollama serve');
    process.exit(1);
  }
  
  // Test cases
  const testCases = [
    {
      name: 'FizzBuzz Logic',
      prompt: 'Write JavaScript fizzbuzz function that returns array with Fizz/Buzz for multiples of 3 and 5. Return only function.',
      category: 'coding'
    },
    {
      name: 'Binary Search',
      prompt: 'Implement binary search for sorted array. Return only function code.',
      category: 'coding'
    },
    {
      name: 'Palindrome Check',
      prompt: 'Write isPalindrome function that ignores case and non-alphanumeric characters. Return only function.',
      category: 'coding'
    },
    {
      name: 'Quick Math Problem',
      prompt: 'Solve: If 2x + 5 = 21, what is x? Show your work.',
      category: 'general'
    },
    {
      name: 'Explain CPU Architecture',
      prompt: 'Explain how CPU cache works in simple terms, under 100 words.',
      category: 'general'
    },
    {
      name: 'Summarize AI Concepts',
      prompt: 'Summarize the differences between AI, ML, and Deep Learning in 3 sentences.',
      category: 'general'
    },
    {
      name: 'Debug Common Error',
      prompt: 'Debug this code: function add(a, b) { return a + b }; console.log(add(5, 10)); why might it fail?',
      category: 'debugging'
    },
    {
      name: 'Software Architecture',
      prompt: 'Recommend a microservices architecture for an e-commerce platform, mention key components and trade-offs.',
      category: 'project'
    },
    {
      name: 'API Security Best Practices',
      prompt: 'List 5 API security best practices for web applications in bullet points.',
      category: 'security'
    },
    {
      name: 'System Design Question',
      prompt: 'How would you design a URL shortening service like bit.ly? Focus on scalability and uniqueness.',
      category: 'project'
    }
  ];
  
  console.log(`Starting benchmark for model: ${MODEL_NAME}\n`);
  
  for (const testCase of testCases) {
    console.log(`${testCase.category.toUpperCase()}: ${testCase.name}`);
    const result = await testGenerate(MODEL_NAME, testCase.prompt, testCase.name);
    results.push({
      model: MODEL_NAME,
      testCase: testCase.name,
      category: testCase.category,
      success: result.success,
      duration: result.duration,
      tokensPerSecond: result.tokensPerSecond || 0,
      error: result.error || null,
      responseLength: result.response?.length || 0
    });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Small delay between tests
  }
  
  // Summary
  console.log('\n=== BENCHMARK SUMMARY ===');
  const successfulTests = results.filter(r => r.success);
  const failedTests = results.filter(r => !r.success);
  
  console.log(`Successful: ${successfulTests.length}/${results.length}`);
  console.log(`Failed: ${failedTests.length}/${results.length}`);
  
  if (successfulTests.length > 0) {
    const avgDuration = successfulTests.reduce((sum, r) => sum + r.duration, 0) / successfulTests.length;
    const avgTokensPerSec = successfulTests.reduce((sum, r) => sum + r.tokensPerSecond, 0) / successfulTests.length;
    const totalTokens = successfulTests.reduce((sum, r) => sum + r.responseLength, 0);
    
    console.log(`Average response time: ${(avgDuration/1000).toFixed(2)}s`);
    console.log(`Average tokens/second: ${avgTokensPerSec.toFixed(2)}`);
    console.log(`Total tokens generated: ${totalTokens}`);
    
    const successfulByCategory = {};
    for (const test of successfulTests) {
      if (!successfulByCategory[test.category]) {
        successfulByCategory[test.category] = 0;
      }
      successfulByCategory[test.category]++;
    }
    
    console.log('\nSuccess by category:');
    for (const [category, count] of Object.entries(successfulByCategory)) {
      console.log(`  ${category}: ${count} tests`);
    }
  }
  
  if (failedTests.length > 0) {
    console.log('\nFailed tests:');
    for (const test of failedTests) {
      console.log(`  ${test.testCase}: ${test.error}`);
    }
  }
  
  console.log('\nBenchmark completed!');
}

runBenchmark().catch(console.error);