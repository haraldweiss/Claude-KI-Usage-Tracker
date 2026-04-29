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

stop_pattern() {
    local name=$1
    local pattern=$2
    local pids
    pids=$(pgrep -f "$pattern" 2>/dev/null)
    if [ -z "$pids" ]; then
        return
    fi
    echo -n -e "${YELLOW}•${NC} $name (stale): killing pid(s) $pids ... "
    kill $pids 2>/dev/null
    sleep 1
    if [ -n "$(pgrep -f "$pattern" 2>/dev/null)" ]; then
        kill -9 $(pgrep -f "$pattern" 2>/dev/null) 2>/dev/null
        sleep 1
    fi
    if [ -z "$(pgrep -f "$pattern" 2>/dev/null)" ]; then
        echo -e "${GREEN}stopped${NC}"
    else
        echo -e "${RED}FAILED${NC}"
    fi
}

echo ""
echo "Stopping Claude Usage Tracker services..."
stop_port "Backend " "$BACKEND_PORT"
stop_port "Frontend" "$FRONTEND_PORT"

# Kill any leftover dev processes that aren't bound to the port (e.g. from
# a previous worktree where multiple nodemons piled up — only one ever owns
# the port, the rest sit idle but keep the file watch alive).
stop_pattern "Backend " "nodemon.*src/server.ts"
stop_pattern "Frontend" "node.*frontend/node_modules/.bin/vite"
echo ""
