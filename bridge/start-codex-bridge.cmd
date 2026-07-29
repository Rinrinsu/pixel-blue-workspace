@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-codex-bridge.ps1"
if errorlevel 1 (
  echo.
  echo Codex bridge failed to start.
  pause
)

