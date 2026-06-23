@echo off
REM Start the Medical Backend Server
REM This script automatically navigates to the correct directory

echo.
echo ================================================
echo   MEDICAL AI BACKEND SERVER - STARTUP
echo ================================================
echo.

REM Check if Node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm dependencies are installed
if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Start the server
echo Starting backend server on http://localhost:5000
echo.
call node server.js

pause
