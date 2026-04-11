#!/bin/bash

# Claude Usage Tracker - Simple Startup Script
# Starts backend and frontend servers

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Claude Usage Tracker - Starting Services              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node --version)"
echo "✅ npm $(npm --version)"
echo ""

# Function to start a service
start_service() {
    local name=$1
    local dir=$2
    local cmd=$3

    echo "${BLUE}Starting $name...${NC}"
    cd "$PROJECT_DIR/$dir"

    # Install if needed
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies for $name..."
        npm install --silent
    fi

    # Start in background
    echo "🚀 Launching $name in new window..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        osascript -e "tell app \"Terminal\" to do script \"cd '$PROJECT_DIR/$dir' && $cmd\""
    else
        # Linux
        x-terminal-emulator -e "cd '$PROJECT_DIR/$dir' && $cmd" &
    fi

    echo "✅ $name started"
    sleep 2
}

# Start backend
start_service "Backend" "backend" "npm run dev"

# Start frontend
start_service "Frontend" "frontend" "npm run dev"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║            ${GREEN}✅ Services Started!${NC}                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "${GREEN}Backend:${NC}   http://localhost:3000"
echo "${GREEN}Frontend:${NC}  http://localhost:5173"
echo ""
echo "${YELLOW}Next Steps:${NC}"
echo "1. Load extension: chrome://extensions → Load unpacked"
echo "2. Visit https://claude.ai"
echo "3. Use Claude normally - extension tracks automatically"
echo "4. View stats at http://localhost:5173"
echo ""
echo "${YELLOW}To Stop:${NC} Close the terminal windows or press Ctrl+C"
echo ""
