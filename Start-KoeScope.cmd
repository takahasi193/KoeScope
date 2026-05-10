@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-KoeScope.ps1" %*
if errorlevel 1 (
  echo.
  echo KoeScope failed to start. Check dev-logs\koescope-launch.err.log for details.
  pause
)
