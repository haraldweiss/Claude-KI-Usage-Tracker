#!/bin/bash

# Claude Usage Tracker - Simple Sequential Startup
# Runs backend and frontend in the same terminal
# Good for quick testing - both services show output

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "    Claude Usage Tracker - Starting Backend & Frontend"
echo "════════════════════════════════════════════════════════════"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found!"
    echo "Install from: https://nodejs.org"
    exit 1
fi

echo "✅ Node.js: $(node --version)"
echo "✅ npm: $(npm --version)"
echo ""

# Setup Backend
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setting up Backend (Express + SQLite)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$PROJECT_DIR/backend"

if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install
else
    echo "✅ Backend dependencies cached"
fi

echo ""
echo "🚀 Starting Backend on http://localhost:3000"
echo ""

# Start backend in background
npm run dev &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to start
sleep 3

# Setup Frontend
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setting up Frontend (React + Vite)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$PROJECT_DIR/frontend"

if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
else
    echo "✅ Frontend dependencies cached"
fi

echo ""
echo "🚀 Starting Frontend on http://localhost:5173"
echo ""

# Start frontend in background
npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "              ✅ BOTH SERVICES RUNNING!"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "📊 Backend:   http://localhost:3000"
echo "🎨 Frontend:  http://localhost:5173"
echo ""
echo "Next Steps:"
echo "1. Go to chrome://extensions"
echo "2. Enable Developer mode"
echo "3. Load unpacked → select /extension folder"
echo "4. Visit https://claude.ai and use Claude normally"
echo "5. Extension will track automatically"
echo "6. View stats at http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"
echo "════════════════════════════════════════════════════════════"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
