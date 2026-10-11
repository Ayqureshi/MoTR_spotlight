@echo off
title MoTR Spotlight PROLIFIC (WebLink) - KEEP THIS WINDOW OPEN
cd /d "%~dp0"
if not exist "node.exe" (
  echo ERROR: node.exe not found next to this file.
  echo Extract the whole ZIP first: right-click the ZIP ^> Extract All, then run this file from the extracted folder.
  pause
  exit /b 1
)
echo Server only - no browser is opened. In WebLink, open:  http://127.0.0.1:8081/?offline=1
echo.
node.exe serve.js PROLIFIC 8081
echo.
echo The server has stopped. Close this window.
pause
