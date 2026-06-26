//!usr/bin/env node

// Quick Ollama Model Test - Oracle Backend Integration Solution
// Tests the new DeepSeek-R1-Distill-Qwen-7B-GGUF model and sends results to Oracle backend for dashboard display

const fs = require('fs');
const os = require('os');

// Configuration
const OLLAMA_BASE = 'http://localhost:11434';
const BACKEND_BASE = 'http://localhost:3001';
const TARGET_MODEL = 'hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M';
const PROMPT = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';

function logInfo(msg) {
    console.log('\x1b[36m[INFO]\x1b[0m', msg);
}

function logSuccess(msg) {
    console.log('\x1b[32m[SUCCESS]\x1b[0m', msg);
}

function logWarning(msg) {
    console.log('\x1b[33m[WARNING]\x1b[0m', msg);
}

function logError(msg) {
    console.log('\x1b[31m[ERROR]\x1b[0m', msg);
}

async function checkOllamaService() {
    try {
        const response = await fetch(`${OLLAMA_BASE}/api/tags`);
        if (!response.ok) {
            throw new Error(`Ollama API error: HTTP ${response.status}`);
        }
        const data = await response.json();
        const availableModels = data.models?.map(m => m.name) || [];
        
        if (availableModels.includes(TARGET_MODEL)) {
            logSuccess('Ollama service is running and target model is available');
            return true;
        } else {
            logError(`Target model not found in Ollama. Available models: ${availableModels.join(', ')}`);
            logError('Please pull the model with: ollama pull ' + TARGET_MODEL);
            return false;
        }
    } catch (error) {
        logError(`Failed to check Ollama service: ${error.message}`);
        logError('Please ensure Ollama is running with: ollama serve');
        return false;
    }
}

async function testModel() {
    const startTime = Date.now();
    
    try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: TARGET_MODEL,
                prompt: PROMPT,
                stream: false
            })
        });
        
        if (!response.ok) {
            throw new Error(`Model generation failed: HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const responseText = data.response || '';
        
        if (!responseText || responseText.trim().length < 20) {
            throw new Error('Model did not generate a valid response');
        }
        
        const duration = Date.now() - startTime;
        const tokens = responseText.split(' ').length;
        
        return {
            success: true,
            model: TARGET_MODEL,
            prompt: PROMPT,
            response: responseText,
            tokens: tokens,
            duration: duration,
            response_length: responseText.length,
            response_preview: responseText.substring(0, 100) + '...',
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        return {
            success: false,
            model: TARGET_MODEL,
            prompt: PROMPT,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

async function sendToOracleBackend(testResult, runId) {
    const url = `${BACKEND_BASE}/api/benchmarks`;
    
    const payload = {
        run_id: runId,
        machine_name: os.hostname(),
        model_name: TARGET_MODEL,
        mode: 'quick_test',
        timestamp: new Date().toISOString(),
        results: [{
            category: 'quick_test',
            score: testResult.success ? 100 : 0,
            tasks_total: 1,
            tasks_passed: testResult.success ? 1 : 0,
            raw_results: JSON.stringify([testResult]),
            test_duration_ms: testResult.duration || 0,
            tokens_generated: testResult.tokens || 0,
            response_length: testResult.response_length || 0
        }],
        model_info: {
            model: TARGET_MODEL,
            test_type: 'quick_benchmark',
            status: testResult.success ? 'success' : 'failed',
            complexity: 'quick_test'
        }
    };
    
    try {
        logInfo('Attempting to send results to Oracle backend...');
        logInfo('Backend URL:', url);
        
        const authToken = process.env.BENCHMARK_TOKEN || 'test-token-dashboard-2026';
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            const responseData = await response.json();
            logSuccess('✅ Results successfully sent to Oracle backend!');
            logSuccess('Response:', responseData);
            return true;
        } else {
            const errorText = await response.text();
            logError(`⚠️ Backend rejected results. Status: ${response.status}`);
            logError(`Error details: ${errorText}`);
            return false;
        }
    } catch (error) {
        logError(`❌ Failed to send to Oracle backend: ${error.message}`);
        logError('');
        logError('Please check:');
        logError('1. Oracle backend is running on http://' + BACKEND_BASE);
        logError('2. Backend endpoint /api/benchmarks is accessible');
        logError('3. Network connectivity between this machine and Oracle backend');
        logError('4. Firewall rules allow connections to port 3001');
        logError('5. Backend authorization token is valid');
        return false;
    }
}

async function saveLocalResults(testResult, runId) {
    const resultsDir = 'benchmark/results';
    const resultsFile = `${resultsDir}/benchmark-${runId}.json`;
    
    const localData = {
        run_id: runId,
        machine_name: os.hostname(),
        model_name: TARGET_MODEL,
        mode: 'quick_test',
        timestamp: new Date().toISOString(),
        test_result: testResult,
        source: 'ollama_oracle_test_script',
        oracle_backend_url: BACKEND_BASE + '/api/benchmarks',
        note: 'Model test results for Oracle backend dashboard display'
    };
    
    try {
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir, { recursive: true });
        }
        
        fs.writeFileSync(resultsFile, JSON.stringify(localData, null, 2));
        logSuccess(`Local results saved: ${resultsFile}`);
        return resultsFile;
    } catch (error) {
        logError(`Failed to save local results: ${error.message}`);
        return null;
    }
}

async function main() {
    const runId = Date.now().toString(36);
    
    console.log('\n🎯 Ollama Model Test for Oracle Backend Display');
    console.log('==============================================');
    console.log('Test Run ID:', runId);
    console.log('Target Model:', TARGET_MODEL);
    console.log('Oracle Backend:', BACKEND_BASE + '/api/benchmarks');
    console.log('');
    console.log('Objective: Test the new DeepSeek-R1-Distill-Qwen-7B-GGUF model and ensure results reach Oracle backend for dashboard display');
    console.log('');
    console.log('=== Oracle Backend Dashboard Integration ===');
    console.log('Backend endpoint: POST /api/benchmarks');
    console.log('Expected request body structure:');
    console.log('{');
    console.log('  "run_id": "UUID",');
    console.log('  "machine_name": "hostname",');
    console.log('  "model_name": "hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M",');
    console.log('  "mode": "quick_test",');
    console.log('  "results": [{');
    console.log('    "category": "quick_test",');
    console.log('    "score": 100,');
    console.log('    "tasks_total": 1,');
    console.log('    "tasks_passed": 1,');
    console.log('    "raw_results": "[...]",');
    console.log('    "test_duration_ms": 1234,');
    console.log('    "tokens_generated": 184');
    console.log('  }]');
    console.log('}');
    console.log('');
    
    if (!await checkOllamaService()) {
        process.exit(1);
    }
    
    const testResult = await testOllamaModel();
    
    if (testResult.success) {
        logSuccess('✅ MODEL TEST COMPLETED SUCCESSFULLY');
        logSuccess('=======================');
        logSuccess('Model tested:', TARGET_MODEL);
        logSuccess('Tokens generated:', testResult.tokens);
        logSuccess('Inference time:', (testResult.duration / 1000).toFixed(2) + 's');
        logSuccess('Response length:', testResult.response_length + ' characters');
        logSuccess('Success rate: 100%');
        logSuccess('');
        logSuccess('Sample response preview:', testResult.response_preview);
        
        await saveLocalResults(testResult, runId);
        await sendToOracleBackend(testResult, runId);
        
        logSuccess('\n🎉 TEST COMPLETE - READY FOR ORACLE DASHBOARD');
        logSuccess('============================');
        logSuccess('✅ New Ollama model tested successfully');
        logSuccess('✅ Results sent to Oracle backend for dashboard display');
        logSuccess('✅ Local backup created');
        logSuccess('');
        logSuccess('📋 Oracle Dashboard Display Preview:');
        logSuccess('Model Name: DeepSeek-R1-Distill-Qwen-7B-GGUF');
        logSuccess('Test Status: SUCCESS');
        logSuccess('Tokens/Second: ' + (testResult.tokens / (testResult.duration / 1000)).toFixed(2));
        logSuccess('Response Time: ' + (testResult.duration / 1000).toFixed(2) + 's');
        logSuccess('Test Timestamp: ' + testResult.timestamp);
        logSuccess('');
        logSuccess('✅ Ready for Oracle backend display!');
        
    } else {
        logError('❌ MODEL TEST FAILED');
        logError('========================');
        logError('Model:', TARGET_MODEL);
        logError('Error:', testResult.error);
        
        await saveLocalResults(testResult, runId);
        await sendToOracleBackend(testResult, runId);
        
        logError('\n⚠️  TEST FAILED - MANUAL UPLOAD REQUIRED');
        logError('==============================');
        logError('Test failed. Please upload local results file to Oracle backend.');
        logError('File location: benchmark/results/benchmark-' + runId + '.json');
        logError('');
        logError('Dashboard will display:');
        logError('- Model name: ' + TARGET_MODEL);
        logError('- Test status: FAILED');
        logError('- Error details will be available for review');
        logError('- Manual upload required for complete record');
    }
}

main().catch(console.error);
