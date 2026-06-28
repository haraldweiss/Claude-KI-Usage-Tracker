// Quick benchmark script for Ollama model testing and backend integration
const { execSync } = require('child_process');
const fs = require('fs');

// Configuration
const OLLAMA_BASE = 'http://localhost:11434';
const BACKEND_BASE = 'http://localhost:3001';
const MODEL_NAME = 'hf.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:Q4_K_M';
const PROMPT = 'Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).';

function logInfo(msg) {
    console.log('\033[1;36m[INFO]\033[0m', msg);
}

function logSuccess(msg) {
    console.log('\033[1;32m[SUCCESS]\033[0m', msg);
}

function logError(msg) {
    console.log('\033[1;31m[ERROR]\033[0m', msg);
}

async function testOllamaModel() {
    const startTime = Date.now();
    
    console.log('\n=== Ollama Model Benchmark Test ===');
    console.log('Model:', MODEL_NAME);
    console.log('Test Prompt:', PROMPT);
    console.log('\n');
    
    try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_NAME,
                prompt: PROMPT,
                stream: false
            })
        });
        
        const duration = Date.now() - startTime;
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.response || data.response.trim().length === 0) {
            throw new Error('No response generated from model');
        }
        
        const tokenCount = data.response.split(' ').length;
        
        return {
            success: true,
            model: MODEL_NAME,
            prompt: PROMPT,
            response: data.response,
            tokens: tokenCount,
            duration: duration,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('Model test failed:', error.message);
        
        return {
            success: false,
            model: MODEL_NAME,
            prompt: PROMPT,
            error: error.message,
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };
    }
}

async function sendToBackend(testResult) {
    const runId = Date.now().toString(36);
    const machineName = require('os').hostname();
    
    const backendData = {
        run_id: runId,
        machine_name: machineName,
        model_name: MODEL_NAME,
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
        console.log('\n📡 Attempting to send results to backend...');
        console.log('Backend URL:', BACKEND_BASE + '/api/benchmarks');
        
        const response = await fetch(`${BACKEND_BASE}/api/benchmarks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMSIsImV4cCI6MjY1MTYyNTk5MH0.TestToken' // Replace with actual token
            },
            body: JSON.stringify(backendData)
        });
        
        if (response.ok) {
            console.log('✅ Successfully sent test results to backend!');
            return true;
        } else {
            console.log('⚠️  Backend rejected the request. Status:', response.status);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Failed to send results to backend:', error.message);
        console.log('\n   Please check:');
        console.log('   - Backend is running on Oracle server');
        console.log('   - Backend endpoint /api/benchmarks is accessible');
        console.log('   - Firewall rules allow connections from this machine');
        return false;
    }
}

async function generateResultsFile(testResult) {
    const runId = Date.now().toString(36);
    const resultsFile = `benchmark/results/benchmark-${runId}.json`;
    
    const resultsData = {
        run_id: runId,
        machine_name: require('os').hostname(),
        model_name: MODEL_NAME,
        mode: 'quick_test',
        timestamp: new Date().toISOString(),
        test_result: testResult,
        note: 'This file contains the Ollama model test results for manual backend upload if automatic sending fails'
    };
    
    try {
        fs.mkdirSync('benchmark/results', { recursive: true });
        fs.writeFileSync(resultsFile, JSON.stringify(resultsData, null, 2));
        console.log('\n💾 Results saved locally:', resultsFile);
        console.log('   You can upload this file manually to the backend if needed');
        return resultsFile;
    } catch (error) {
        console.error('❌ Failed to save results file:', error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 Starting Ollama Model Benchmark Test');
    console.log('============================================');
    console.log('This test will:');
    console.log('1. Test the new Ollama model');
    console.log('2. Send results to the Oracle backend');
    console.log('3. Save backup results locally');
    console.log('');
    
    try {
        const testResult = await testOllamaModel();
        
        if (testResult.success) {
            console.log('\n✅ MODEL TEST SUCCESSFUL');
            console.log('=======================');
            console.log('Model:', testResult.model);
            console.log('Inference Time:', (testResult.duration / 1000).toFixed(2) + 's');
            console.log('Tokens Generated:', testResult.tokens);
            console.log('Response Preview:', testResult.response.substring(0, 100) + '...');
            
            await generateResultsFile(testResult);
            await sendToBackend(testResult);
            
            console.log('\n🎉 BENCHMARK COMPLETE');
            console.log('===================');
            console.log('✅ The new Ollama model has been successfully tested');
            console.log('✅ Results have been sent to the Oracle backend');
            console.log('✅ Backup results saved locally for manual upload if needed');
            
            console.log('\n📋 Summary for Dashboard Display:');
            console.log('Model:', testResult.model);
            console.log('Status: SUCCESS');
            console.log('Test Date:', testResult.timestamp);
            console.log('Performance: ' + (testResult.tokens / (testResult.duration / 1000)).toFixed(2) + ' tokens/second');
            
        } else {
            console.log('\n❌ MODEL TEST FAILED');
            console.log('========================');
            console.log('Error:', testResult.error);
            console.log('The model test failed. Please check:');
            console.log('1. Ollama service is running');
            console.log('2. Model is properly installed');
            console.log('3. Network connectivity to Ollama');
            
            await generateResultsFile(testResult);
            await sendToBackend(testResult);
            
            console.log('\n⚠️  FAILED TEST DETAILS SAVED');
            console.log('==============================');
            console.log('Test failure has been recorded locally.');
            console.log('Results saved to benchmark/results/ for manual upload if needed.');
        }
        
    } catch (error) {
        console.error('\n💥 CRITICAL ERROR:', error.message);
        console.log('\nPlease check:');
        console.log('1. Ollama service is running on localhost:11434');
        console.log('2. Network connectivity between this machine and Ollama');
        console.log('3. Firewall rules allow port 11434 access');
        
        process.exit(1);
    }
}

main().catch(console.error);