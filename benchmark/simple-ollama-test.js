#!/usr/bin/env node

// Simple Ollama Benchmark Script
// Tests the new model and sends results to Oracle backend

const fs = require('fs');
const os = require('os');

// Configuration from existing config.js
const OLLAMA_BASE = 'http://localhost:11434';
const BACKEND_BASE = 'http://localhost:3001';

async function testOllamaModel() {
    const modelName = 'hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M';
    const prompt = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';
    
    console.log('\n🚀 Ollama Model Benchmark Test');
    console.log('=====================================');
    console.log('Testing model:', modelName);
    console.log('Prompt:', prompt);
    console.log('---');
    
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
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const responseText = data.response || '';
        
        if (!responseText || responseText.trim().length < 20) {
            throw new Error('Model did not generate a valid response');
        }
        
        return {
            success: true,
            model: modelName,
            tokens: responseText.split(' ').length,
            response: responseText,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        return {
            success: false,
            model: modelName,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

async function sendToBackend(testResult, runId) {
    const url = `${BACKEND_BASE}/api/benchmarks`;
    
    const payload = {
        run_id: runId,
        machine_name: os.hostname(),
        model_name: testResult.model,
        mode: 'quick_test',
        results: [{
            category: 'quick_test',
            score: testResult.success ? 100 : 0,
            tasks_total: 1,
            tasks_passed: testResult.success ? 1 : 0,
            raw_results: JSON.stringify([testResult])
        }]
    };
    
    try {
        console.log('\n📡 Attempting to send results to Oracle backend...');
        console.log('URL:', url);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (process.env.BENCHMARK_TOKEN || 'test-token')
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            console.log('✅ Successfully sent results to Oracle backend!');
            return true;
        } else {
            console.log('⚠️  Backend rejected results. Status:', response.status);
            return false;
        }
    } catch (error) {
        console.log('❌ Failed to send to backend:', error.message);
        console.log('   Results saved locally. Please upload manually if needed.');
        return false;
    }
}

async function saveLocalResults(testResult, runId) {
    const resultsFile = `benchmark/results/benchmark-${runId}.json`;
    
    const localData = {
        run_id: runId,
        machine_name: os.hostname(),
        model_name: testResult.model,
        mode: 'quick_test',
        timestamp: testResult.timestamp,
        test_result: testResult,
        source: 'ollama_benchmark_script',
        note: 'Local backup - upload to Oracle backend if manual upload needed'
    };
    
    try {
        // Ensure directory exists
        if (!fs.existsSync('benchmark/results')) {
            fs.mkdirSync('benchmark/results', { recursive: true });
        }
        
        fs.writeFileSync(resultsFile, JSON.stringify(localData, null, 2));
        console.log('\n💾 Local results saved:', resultsFile);
        return resultsFile;
    } catch (error) {
        console.error('❌ Failed to save local results:', error.message);
        return null;
    }
}

async function main() {
    const runId = Date.now().toString(36);
    
    console.log('\n🚀 Starting Ollama Model Benchmark');
    console.log('=====================================');
    console.log('Target Oracle backend:', BACKEND_BASE + '/api/benchmarks');
    console.log('Test run ID:', runId);
    console.log('');
    
    try {
        const testResult = await testOllamaModel();
        
        if (testResult.success) {
            console.log('\n✅ MODEL TEST SUCCESSFUL');
            console.log('=======================');
            console.log('Model:', testResult.model);
            console.log('Tokens generated:', testResult.tokens);
            console.log('Response preview:', testResult.response.substring(0, 100) + '...');
            
            // Save locally
            await saveLocalResults(testResult, runId);
            
            // Try to send to backend
            await sendToBackend(testResult, runId);
            
            console.log('\n🎉 BENCHMARK COMPLETE');
            console.log('===================');
            console.log('✅ Model test successful');
            console.log('✅ Results available for Oracle backend display');
            console.log('');
            console.log('📋 Oracle Backend Upload Instructions:');
            console.log('1. Access Oracle backend dashboard');
            console.log('2. Navigate to Benchmarks section');
            console.log('3. Upload: benchmark/results/benchmark-' + runId + '.json');
            console.log('4. Model results will appear in dashboard display');
            
        } else {
            console.log('\n❌ MODEL TEST FAILED');
            console.log('========================');
            console.log('Error:', testResult.error);
            
            // Save failed test locally
            await saveLocalResults(testResult, runId);
            await sendToBackend(testResult, runId);
            
            console.log('\n⚠️  TEST FAILED - MANUAL UPLOAD REQUIRED');
            console.log('==============================');
            console.log('Test failed. Please upload local results file to Oracle backend.');
            console.log('File location: benchmark/results/benchmark-' + runId + '.json');
        }
        
    } catch (error) {
        console.error('\n💥 CRITICAL ERROR:', error.message);
        process.exit(1);
    }
}

// Run the benchmark
main().catch(console.error);
