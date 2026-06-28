#!/bin/bash

# Simple Ollama benchmark script
# Usage: ./benchmark-test.sh [--model MODEL_NAME] [--tasks COUNT]

set -e

OLLAMA_BASE="http://localhost:11434"
TIMEOUT_MS=30000

# Function to log with colors
log_info() {
    echo -e "\033[1;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[1;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[1;31m[ERROR]\033[0m $1"
}

log_warning() {
    echo -e "\033[1;33m[WARNING]\033[0m $1"
}

# Function to check if Ollama is running
check_ollama() {
    if ! curl -s "${OLLAMA_BASE}/api/tags" > /dev/null; then
        log_error "Ollama is not running or not accessible at ${OLLAMA_BASE}"
        log_error "Please start Ollama with: ollama serve"
        return 1
    fi
}

# Function to discover models
explore_models() {
    log_info "Discovering available Ollama models..."
    local models_json
    
    if ! models_json=$(curl -s "${OLLAMA_BASE}/api/tags" 2>/dev/null); then
        log_error "Failed to discover models from Ollama API"
        return 1
    fi
    
    # Extract model names (excluding embedding models)
    local models=$(echo "$models_json" | jq -r '.models[] | select(.name | test("embed")) | .name' 2>/dev/null || echo "")
    
    if [ -z "$models" ]; then
        log_error "No text generation models found in Ollama"
        return 1
    fi
    
    echo "Available models:"
    echo "$models" | sed 's/^/  /'
    echo
    
    # Return the first non-embed model for testing
    echo "$models" | head -1
}

# Function to test a specific model
test_model() {
    local model_name=$1
    local task_index=$2
    
    log_info "Test ${task_index + 1}: Testing model '${model_name}'..."
    
    local response
    local status_code
    
    # Make the API request with timeout
    response=$(curl -s -w "%{http_code}" -X POST "${OLLAMA_BASE}/api/generate" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"${model_name}\", \"prompt\": \"Explain why renewable energy is important for economic development. Keep your answer concise (2-3 sentences).\", \"stream\": false}" \
        --max-time $((TIMEOUT_MS / 1000)) 2>/dev/null) || {
        echo "000"
        return 1
    }
    
    # Extract status code from last 3 characters
    status_code=${response: -3}
    local response_body="${response%???}"
    
    if [ "$status_code" -ne 200 ]; then
        echo "${status_code} \\
${response_body}"
        return 1
    fi
    
    echo "$response_body"
}

# Function to run benchmark
run_benchmark() {
    local target_model=$1
    local task_count=$2
    
    log_info "Starting Ollama Benchmark"
    log_info "Target model: ${target_model}"
    log_info "Tests: ${task_count} inference tasks"
    
    local successful_tests=0
    local failed_tests=0
    local total_tokens=0
    local tests_passed=0
    local tests_total=0
    
    for ((i=0; i<task_count; i++)); do
        log_info "Test ${i + 1}/${task_count}: "
        
        local result
        result=$(test_model "$target_model" "$i") || {
            log_error "Request failed"
            ((failed_tests++))
            continue
        }
        
        # Parse response
        local status_code=$(echo "$result" | tail -1)
        local response_body=$(echo "$result" | head -1)
        
        if [ "$status_code" -eq 200 ]; then
            local tokens
            tokens=$(echo "$response_body" | jq -r '.response // empty' 2>/dev/null | wc -w)
            
            if [ "$tokens" -gt 0 ] 2>/dev/null; then
                log_success "Success"
                log_success "Tokens generated: ${tokens}"
                successful_tests=$((successful_tests + 1))
                total_tokens=$((total_tokens + tokens))
                tests_passed=$((tests_passed + 1))
            else
                log_error "Empty or invalid response"
                ((failed_tests++))
                tests_failed=$((tests_failed + 1))
            fi
        else
            log_error "API failed with status: ${status_code}"
            ((failed_tests++))
            tests_failed=$((tests_failed + 1))
        fi
        
        echo ""
    done
    
    # Calculate statistics
    tests_total=$((tests_passed + tests_failed))
    local success_rate=0
    local avg_tokens=0
    
    if [ $tests_total -gt 0 ]; then
        success_rate=$(awk "BEGIN {printf \"%.1f\", (${successful_tests} / ${tests_total}) * 100}")
    fi
    
    if [ $successful_tests -gt 0 ]; then
        avg_tokens=$(awk "BEGIN {printf \"%.1f\", ${total_tokens} / ${successful_tests}}")
    fi
    
    echo "\n" + "="*60
    echo "📊 BENCHMARK RESULTS"
    echo "="*60
    echo "Model: ${target_model}"
    echo "Tasks Completed: ${tests_total}/${task_count}"
    echo "✓ Successful: ${successful_tests}"
    echo "✗ Failed: ${failed_tests}"
    echo "Success Rate: ${success_rate}%"
    echo "Avg Tokens/Task: ${avg_tokens}"
    echo "="*60
    
    # Final status
    if [ $successful_tests -gt 0 ]; then
        log_success "Benchmark test PASSED - model generated output successfully"
        return 0
    else
        log_error "Benchmark test FAILED - model did not generate output"
        return 1
    fi
}

# Parse command line arguments
MODEL_NAME=""
TASK_COUNT=1

for arg in "$@"; do
    case $arg in
        --model=*)
            MODEL_NAME="${arg#*=}"
            shift
            ;;
        --tasks=*)
            TASK_COUNT="${arg#*=}"
            shift
            ;;
        *)
            # Unknown option
            ;;
    esac
done

# Main execution
main() {
    log_info "Ollama Benchmark Tool"
    log_info "Running on: $(hostname)"
    log_info "Node.js version: $(node --version 2>/dev/null || echo 'N/A')"
    
    # Check if Ollama is running
    check_ollama || exit 1
    
    # Determine which model to test
    local test_model
    if [ -n "$MODEL_NAME" ]; then
        test_model="$MODEL_NAME"
        log_info "Specified model: ${test_model}"
    else
        # Discover models and pick the first suitable one
        test_model=$(explore_models) || exit 1
        log_info "Auto-selected model: ${test_model}"
    fi
    
    # Run benchmark
    if run_benchmark "$test_model" "$TASK_COUNT"; then
        log_success "Benchmark completed successfully!"
        exit 0
    else
        log_error "Benchmark failed!"
        exit 1
    fi
}

# Execute main function
main "$@"

