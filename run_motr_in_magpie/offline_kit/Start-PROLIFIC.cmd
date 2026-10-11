@echo off
title MoTR Spotlight PROLIFIC - KEEP THIS WINDOW OPEN
cd /d "%~dp0"
if not exist "node.exe" (
  echo ERROR: node.exe not found next to this file.
  echo Extract the whole ZIP first: right-click the ZIP ^> Extract All, then run this file from the extracted folder.
  pause
  exit /b 1
)
node.exe serve.js PROLIFIC 8081 --open
echo.
echo The server has stopped. Close this window.
pause
