#!/bin/bash
# Claude Usage Tracker - Start backend (port 3000) and frontend (port 5173).
#
# Idempotent: if anything is already listening on either port, it's stopped
# first. Each service runs in its own Terminal window on macOS. On Linux,
# tries x-terminal-emulator; falls back to background mode with logs in
# /tmp/usage-tracker-{backend,frontend}.log.
#
# To stop everything: ./stop.sh
# To check what's running: ./status.sh

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=${BACKEND_PORT:-3000}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Claude Usage Tracker - Starting Services              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Sanity check: Node must be available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi
echo "✅ Node.js $(node --version)"
echo "✅ npm $(npm --version)"
echo ""

# Free the ports first (handles "address already in use" silently)
free_port() {
    local port=$1
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}⚠${NC}  Port $port is occupied — stopping pid(s) $pids"
        kill $pids 2>/dev/null
        sleep 1
        # SIGKILL stragglers
        kill -9 $(lsof -ti :"$port" 2>/dev/null) 2>/dev/null
        sleep 1
    fi
}

free_port "$BACKEND_PORT"
free_port "$FRONTEND_PORT"

# Start one service in a new terminal window (or background-with-log fallback)
start_service() {
    local name=$1
    local dir=$2
    local cmd=$3
    local logfile=$4

    cd "$PROJECT_DIR/$dir"

    if [ ! -d "node_modules" ]; then
        echo -e "${BLUE}Installing $name dependencies...${NC}"
        npm install --silent
    fi

    echo -e "${BLUE}Starting $name...${NC}"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS: open a new Terminal window so the user can read the live logs
        osascript -e "tell app \"Terminal\" to do script \"cd '$PROJECT_DIR/$dir' && $cmd\"" >/dev/null
    elif command -v x-terminal-emulator >/dev/null 2>&1; then
        x-terminal-emulator -e "bash -c \"cd '$PROJECT_DIR/$dir' && $cmd; exec bash\"" &
    else
        # Headless / no GUI terminal: run in background, log to /tmp
        echo "    (no GUI terminal — logging to $logfile)"
        nohup bash -c "cd '$PROJECT_DIR/$dir' && $cmd" > "$logfile" 2>&1 &
    fi
}

start_service "Backend " "backend"  "npm run dev" "/tmp/usage-tracker-backend.log"
sleep 2
start_service "Frontend" "frontend" "npm run dev" "/tmp/usage-tracker-frontend.log"

# Wait briefly so the user sees the ports come up
sleep 3

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo -e "║            ${GREEN}✅ Services Started!${NC}                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}Backend:${NC}   http://localhost:$BACKEND_PORT"
echo -e "${GREEN}Frontend:${NC}  http://localhost:$FRONTEND_PORT"
echo ""
echo -e "${YELLOW}Lifecycle:${NC}"
echo "  ./status.sh   — check what's running"
echo "  ./stop.sh     — stop both services"
echo "  ./start.sh    — restart (kills any existing instance first)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Load extension: chrome://extensions → Load unpacked → select extension/"
echo "  2. Visit https://claude.ai and use Claude normally"
echo "  3. View stats at http://localhost:$FRONTEND_PORT"
echo ""
