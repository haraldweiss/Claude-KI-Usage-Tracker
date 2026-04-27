#!/bin/bash
# Claude Usage Tracker - Show whether backend and frontend are running.

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BACKEND_PORT=${BACKEND_PORT:-3000}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

check() {
    local name=$1
    local port=$2
    local url=$3
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "${GREEN}● running${NC}  $name  (pid $pids, $url)"
    else
        echo -e "${YELLOW}○ stopped${NC}  $name  (port $port)"
    fi
}

echo ""
check "Backend " "$BACKEND_PORT" "http://localhost:$BACKEND_PORT"
check "Frontend" "$FRONTEND_PORT" "http://localhost:$FRONTEND_PORT"
echo ""
