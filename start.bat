@echo off
REM Starts the backend and frontend dev servers in their own windows, then
REM opens the app in the browser. Run from the repo root on Windows.
REM Installs dependencies first so packages added in a pull are never missing.

cd /d "%~dp0"

REM The backend starts even without MySQL, but then every page that needs data fails.
REM Stop here with a clear message instead (see LOCAL_SETUP.md, "Start MySQL").
netstat -an | find ":3306" | find "LISTENING" >nul
if errorlevel 1 (
  echo.
  echo MySQL is not running on port 3306. Start it first - see LOCAL_SETUP.md, "Start MySQL".
  echo.
  pause
  exit /b 1
)

echo Installing frontend dependencies...
call npm install
if errorlevel 1 (
  echo Frontend npm install failed. Fix the error above and run start.bat again.
  pause
  exit /b 1
)

echo Installing backend dependencies...
pushd server
call npm install
if errorlevel 1 (
  popd
  echo Backend npm install failed. Fix the error above and run start.bat again.
  pause
  exit /b 1
)
popd

echo Starting backend (http://localhost:4000)...
start "CMS backend" cmd /k "cd /d "%~dp0server" && npm run dev"

echo Starting frontend (http://localhost:5173)...
start "CMS frontend" cmd /k "cd /d "%~dp0" && npm run dev"

echo Waiting for the frontend to come up...
timeout /t 5 /nobreak >nul

start http://localhost:5173

echo.
echo Two windows opened: CMS backend and CMS frontend. Close them to stop the servers.
