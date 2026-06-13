@echo off
cd /d "%~dp0"

if not exist "scripts\start-public-cloudflare.ps1" (
  echo Missing scripts\start-public-cloudflare.ps1
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-public-cloudflare.ps1"
if errorlevel 1 pause
