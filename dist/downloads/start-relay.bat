@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0relay.ps1"
echo.
echo Relay stopped or failed to start - see messages above.
pause
