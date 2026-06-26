// Simple Ollama benchmark script
// Usage: node simple-benchmark.js [--model MODEL_NAME] [--tasks COUNT]

import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import os from 'os';

const OLLAMA_BASE = 'http://localhost:11434';
const TIMEOUT_MS = 30000;

function logInfo(msg) {
    console.log('\033[1;34m[INFO]\033[0m', msg);
}

function logSuccess(msg) {
    console.log('\033[1;32m[SUCCESS]\033[0m', msg);
}

function logError(msg) {
    console.log('\033[1;31m[ERROR]\033[0m', msg);
}

function logWarning(msg) {
    console.log('\033[1;33m[WARNING]\033[0m', msg);
}

function checkOllama() {
    try {
        const response = execSync(`curl -s -o /dev/null -w "%{http_code}" ${OLLAMA_BASE}/api/tags`, { encoding: 'utf8' });
        if (response === '200') {
            return true;
        }
        logError(`Ollama returned status ${response}`);
        return false;
    } catch (e) {
        logError(`Failed to check Ollama: ${e.message}`);
        return false;
    }
}

function discoverModels() {
    logInfo('Discovering available Ollama models...');
    
    try {
        const response = execSync(`curl -s ${OLLAMA_BASE}/api/tags`, { encoding: 'utf8' });
        const models = JSON.parse(response);
        const modelNames = (models.models || []).map(m => m.name);
        
        if (modelNames.length === 0) {
            logError('No text generation models found in Ollama');
            return [];
        }
        
        logInfo('Available models:');
        modelNames.forEach(name => {
            if (!name.includes('embed')) {
                console.log('  ' + name);
            }
        });
        
        return modelNames.filter(name => !name.includes('embed'));
    } catch (e) {
        logError(`Failed to discover models: ${e.message}`);
        return [];
    }
}

async function testModel(modelName) {
    const prompt = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';
    
    try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelName,
                prompt: prompt,
                stream: false
            }),
            timeout: TIMEOUT_MS / 1000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const responseText = data.response || '';
        
        if (!responseText || responseText.trim().length < 20) {
            throw new Error('Response too short or empty');
        }
        
        const tokens = responseText.split(' ').length;
        
        return {
            success: true,
            tokens: tokens,
            response: responseText.substring(0, 100) + '...',
            model: modelName
        };
        
    } catch (e) {
        return {
            success: false,
            error: e.message,
            model: modelName
        };
    }
}

async function runBenchmark(targetModel, taskCount) {
    logInfo(`Starting Ollama Benchmark`);
    logInfo(`Target model: ${targetModel}`);
    logInfo(`Tests: ${taskCount} inference tasks`);
    
    const results = [];
    let successfulTests = 0;
    let failedTests = 0;
    let totalTokens = 0;
    
    for (let i = 0; i < taskCount; i++) {
        logInfo(`Test ${i + 1}/${taskCount}: Testing model '${targetModel}'...`);
        
        const result = await testModel(targetModel);
        
        if (result.success) {
            logSuccess(`Success`);
            logSuccess(`Tokens generated: ${result.tokens}`);
            logSuccess(`Sample response: ${result.response}`);
            successfulTests++;
            totalTokens += result.tokens;
            results.push(result);
        } else {
            logError(`Failed: ${result.error}`);
            failedTests++;
            results.push(result);
        }
        
        console.log('');
    }
    
    const successRate = taskCount > 0 ? ((successfulTests / taskCount) * 100).toFixed(1) : '0.0';
    const avgTokens = successfulTests > 0 ? (totalTokens / successfulTests).toFixed(1) : '0.0';
    
    console.log('='.repeat(60));
    console.log('📊 BENCHMARK RESULTS');
    console.log('='.repeat(60));
    console.log(`Model: ${targetModel}`);
    console.log(`Tasks Completed: ${taskCount}
✓ Successful: ${successfulTests}`);
    console.log(`✗ Failed: ${failedTests}`);
    console.log(`Success Rate: ${successRate}%`);
    console.log(`Avg Tokens/Task: ${avgTokens}`);
    console.log('='.repeat(60));
    
    if (successfulTests > 0) {
        logSuccess(`Benchmark test PASSED - model generated output successfully`);
        return true;
    } else {
        logError(`Benchmark test FAILED - model did not generate output`);
        return false;
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    let targetModel = '';
    let taskCount = 2;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--model' && i + 1 < args.length) {
            targetModel = args[i + 1];
            i++;
        } else if (args[i] === '--tasks' && i + 1 < args.length) {
            taskCount = parseInt(args[i + 1]) || 2;
            i++;
        }
    }
    
    logInfo('Ollama Benchmark Tool');
    logInfo(`Running on: ${os.hostname()}`);
    logInfo(`Node.js version: ${process.version}`);
    
    if (!checkOllama()) {
        logError('Ollama is not running or not accessible');
        process.exit(1);
    }
    
    let testModel = targetModel;
    if (!testModel) {
        const discoveredModels = discoverModels();
        if (discoveredModels.length === 0) {
            logError('No suitable models found for benchmarking');
            process.exit(1);
        }
        testModel = discoveredModels[0];
        logInfo(`Auto-selected model: ${testModel}`);
    } else {
        logInfo(`Specified model: ${testModel}`);
    }
    
    const success = await runBenchmark(testModel, taskCount);
    
    if (success) {
        logSuccess('Benchmark completed successfully!');
        process.exit(0);
    } else {
        logError('Benchmark failed!');
        process.exit(1);
    }
}

main().catch(console.error);
