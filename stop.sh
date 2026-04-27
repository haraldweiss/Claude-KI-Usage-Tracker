#!/bin/bash
# Claude Usage Tracker - Stop both backend and frontend dev servers.
#
# Identifies running services by their listening ports (3000 backend, 5173
# frontend). Safe to run when nothing is running — exits cleanly.

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BACKEND_PORT=${BACKEND_PORT:-3000}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

stop_port() {
    local name=$1
    local port=$2
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null)
    if [ -z "$pids" ]; then
        echo -e "${YELLOW}•${NC} $name (port $port): not running"
        return
    fi
    echo -n -e "${YELLOW}•${NC} $name (port $port): stopping pid(s) $pids ... "
    kill $pids 2>/dev/null
    # Give it 2s to shut down gracefully, then SIGKILL stragglers
    for _ in 1 2; do
        sleep 1
        if [ -z "$(lsof -ti :"$port" 2>/dev/null)" ]; then
            echo -e "${GREEN}stopped${NC}"
            return
        fi
    done
    kill -9 $(lsof -ti :"$port" 2>/dev/null) 2>/dev/null
    sleep 1
    if [ -z "$(lsof -ti :"$port" 2>/dev/null)" ]; then
        echo -e "${GREEN}stopped (forced)${NC}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
}

echo ""
echo "Stopping Claude Usage Tracker services..."
stop_port "Backend " "$BACKEND_PORT"
stop_port "Frontend" "$FRONTEND_PORT"
echo ""
