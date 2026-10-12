@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
set "AFTERLIGHT_EXIT=%ERRORLEVEL%"
if not "%AFTERLIGHT_EXIT%"=="0" (
  echo.
  echo Afterlight could not open. Read the message above for the next step.
  pause
)
exit /b %AFTERLIGHT_EXIT%
