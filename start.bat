@echo off
REM Starts the backend and frontend dev servers in their own windows, then
REM opens the app in the browser. Run from the repo root on Windows.

echo Starting backend (http://localhost:4000)...
start "CMS backend" cmd /k "cd server && npm run dev"

echo Starting frontend (http://localhost:5173)...
start "CMS frontend" cmd /k "npm run dev"

echo Waiting for the frontend to come up...
timeout /t 5 /nobreak >nul

start http://localhost:5173

echo.
echo Two windows opened: CMS backend and CMS frontend. Close them to stop the servers.
