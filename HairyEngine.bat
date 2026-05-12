@echo off
REM HairyEngine dev launcher.
REM Runs the same `npm run dev` you'd run from a terminal, but double-clickable.
REM Keeps the window open if anything fails so you can read the error.
cd /d "%~dp0"
call npm run dev
if errorlevel 1 (
  echo.
  echo --- HairyEngine exited with an error. Press any key to close. ---
  pause >nul
)
