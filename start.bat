@echo off
REM Claude Usage Tracker - Startup Script for Windows
REM Starts backend and frontend in separate console windows

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set PROJECT_DIR=%~dp0

echo.
echo ============================================================
echo      Claude Usage Tracker - Starting All Services
echo ============================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i

echo [OK] Node.js version: %NODE_VERSION%
echo [OK] npm version: %NPM_VERSION%
echo.

REM Start Backend
echo ============================================================
echo Starting Backend (Node.js + Express + SQLite)...
echo ============================================================
echo.

cd /d "%PROJECT_DIR%backend"

REM Check if node_modules exists, if not install
if not exist "node_modules" (
    echo [*] Installing backend dependencies...
    call npm install > nul 2>&1
    echo [OK] Dependencies installed
    echo.
)

REM Start backend in new window
start "Claude Usage Tracker - Backend" cmd /k "npm run dev"

echo [OK] Backend started in new window (localhost:3000)
timeout /t 3 /nobreak > nul

REM Start Frontend
echo.
echo ============================================================
echo Starting Frontend (React + Vite)...
echo ============================================================
echo.

cd /d "%PROJECT_DIR%frontend"

REM Check if node_modules exists, if not install
if not exist "node_modules" (
    echo [*] Installing frontend dependencies...
    call npm install > nul 2>&1
    echo [OK] Dependencies installed
    echo.
)

REM Start frontend in new window
start "Claude Usage Tracker - Frontend" cmd /k "npm run dev"

echo [OK] Frontend started in new window (localhost:5173)
timeout /t 3 /nobreak > nul

REM Show final instructions
echo.
echo ============================================================
echo              [OK] All Services Started!
echo ============================================================
echo.
echo Backend:   http://localhost:3000
echo Frontend:  http://localhost:5173
echo Dashboard: http://localhost:5173
echo.
echo Next Steps:
echo 1. Go to https://claude.ai and use Claude normally
echo 2. Extension will automatically track your usage
echo 3. View stats in: http://localhost:5173
echo 4. Or click the extension icon to see quick stats
echo.
echo Browser Extension:
echo 1. Go to chrome://extensions
echo 2. Enable Developer mode (top right)
echo 3. Load unpacked - select /extension folder
echo.
echo To Stop Services:
echo - Close the terminal windows
echo - Or press Ctrl+C in each window
echo.
echo Documentation: See README.md for more info
echo.

REM Keep this window open
echo Waiting for services to be ready...
timeout /t 5 /nobreak

REM Optional: Open dashboard in default browser
REM start http://localhost:5173

pause
