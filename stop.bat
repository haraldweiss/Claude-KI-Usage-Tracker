@echo off
REM Claude Usage Tracker - Stop backend (3000) and frontend (5173) on Windows.

setlocal enabledelayedexpansion

set BACKEND_PORT=3000
set FRONTEND_PORT=5173

echo.
echo Stopping Claude Usage Tracker services...

call :kill_port "Backend " %BACKEND_PORT%
call :kill_port "Frontend" %FRONTEND_PORT%

echo.
exit /b 0

:kill_port
set NAME=%~1
set PORT=%~2
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    set FOUND=1
    echo - %NAME% (port %PORT%): stopping pid %%a
    taskkill /F /PID %%a >nul 2>&1
)
if !FOUND!==0 echo - %NAME% (port %PORT%): not running
exit /b 0
