@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24.15+ precisa estar instalado.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 exit /b 1
)
start "Spider Local" /min node server.mjs
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:4318
