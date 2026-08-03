@echo off
REM ---------------------------------------------------------------------------
REM Loom - PC test view. Double-click this file.
REM
REM Starts the Vite dev server and opens frame.html, which hosts the app in a
REM phone-sized iframe (see README -> Testing on a PC). Dev-server only: the
REM frame never reaches dist/ or the APK.
REM ---------------------------------------------------------------------------
setlocal
title Loom - PC test view

REM Run from the repo, not from wherever the shortcut was clicked.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo [loom] npm is not on PATH. Install Node.js first: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM Two conditions, not one. A bare "is node_modules there" check passes on a
REM half-extracted install - the failure mode this repo has actually hit, where
REM the folders exist but the JS files inside them are missing - so probe for a
REM file that has to be there before trusting the tree.
if not exist "node_modules\" goto install
if not exist "node_modules\vite\bin\vite.js" goto install
goto run

:install
echo [loom] installing dependencies ^(first run, or an incomplete install^)...
call npm install
if errorlevel 1 (
    echo.
    echo [loom] npm install failed. If node_modules looks corrupt, try:
    echo         npm cache clean --force
    echo         rmdir /s /q node_modules
    echo         npm install
    echo.
    pause
    exit /b 1
)

:run
echo.
echo [loom] starting dev server - your browser opens at /frame.html
echo [loom] leave this window open; press Ctrl+C here to stop.
echo.
call npm run dev:pc

REM Reached when the server exits or never started. Hold the window so a crash
REM on launch is readable instead of a console that blinks and vanishes.
echo.
echo [loom] dev server stopped.
pause
endlocal
