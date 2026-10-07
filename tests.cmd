@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required for tests only. Open index.html to use the app.
  pause
  exit /b 1
)
call npm test
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
