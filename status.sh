#!/bin/bash
# Claude Usage Tracker - Show whether backend and frontend are running.
# Also surfaces:
# - The working directory of the listening process (so you can tell whether
#   you're running the main repo's copy or a worktree).
# - Stale dev processes that aren't bound to the port (which usually means
#   you started ./start.sh from two locations and one is now zombie).

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

BACKEND_PORT=${BACKEND_PORT:-3000}
FRONTEND_PORT=${FRONTEND_PORT:-5173}

# Resolve a process's CWD via lsof (its working directory tells us which
# checkout it was launched from).
process_cwd() {
    local pid=$1
    lsof -p "$pid" 2>/dev/null | awk '$4 == "cwd" { for (i=9; i<=NF; i++) printf "%s%s", $i, (i==NF ? "" : " "); print "" }' | head -1
}

check() {
    local name=$1
    local port=$2
    local url=$3
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "${GREEN}● running${NC}  $name  (pid $pids, $url)"
        for pid in $pids; do
            local cwd
            cwd=$(process_cwd "$pid")
            [ -n "$cwd" ] && echo -e "             cwd: $cwd"
        done
    else
        echo -e "${YELLOW}○ stopped${NC}  $name  (port $port)"
    fi
}

# Detect stale dev processes that aren't actually serving the port.
warn_stale() {
    local name=$1
    local pattern=$2
    local port=$3
    local owner=""
    owner=$(lsof -ti :"$port" 2>/dev/null)
    local all
    all=$(pgrep -f "$pattern" 2>/dev/null)
    if [ -z "$all" ]; then
        return
    fi
    local stale=""
    for pid in $all; do
        if [ -z "$owner" ] || ! echo "$owner" | grep -qw "$pid"; then
            stale="$stale $pid"
        fi
    done
    if [ -n "$stale" ]; then
        echo -e "${RED}⚠ stale${NC}    $name zombie pid(s):$stale"
        echo "             (./stop.sh will clean these up)"
    fi
}

echo ""
check "Backend " "$BACKEND_PORT" "http://localhost:$BACKEND_PORT"
check "Frontend" "$FRONTEND_PORT" "http://localhost:$FRONTEND_PORT"

warn_stale "Backend " "nodemon.*src/server.ts" "$BACKEND_PORT"
warn_stale "Frontend" "node.*frontend/node_modules/.bin/vite" "$FRONTEND_PORT"
echo ""
