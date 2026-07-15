@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "TASK_NAME=ShobdonCentralCapture"
set "PS_SCRIPT=%SCRIPT_DIR%capture-weathercentral.ps1"

if not exist "%PS_SCRIPT%" (
    echo.
    echo COULD NOT FIND: %PS_SCRIPT%
    echo Please make sure "capture-weathercentral.ps1" is in the same folder as this installer, then run it again.
    echo.
    pause
    exit /b 1
)

echo.
echo Setting up automatic weather capture...
echo.

schtasks /Create /TN "%TASK_NAME%" /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%PS_SCRIPT%\"" /SC ONLOGON /RL LIMITED /F

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Something went wrong (error code %ERRORLEVEL%^). Please take a screenshot of this window.
    pause
    exit /b 1
)

echo.
echo Setup succeeded. Starting it now...
schtasks /Run /TN "%TASK_NAME%"

echo.
echo DONE. Weather capture is now running in the background and will start automatically at every login.
echo.
pause
