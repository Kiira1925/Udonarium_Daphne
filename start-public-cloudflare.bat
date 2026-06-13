@echo off
setlocal

cd /d "%~dp0"

if exist ".env.public" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env.public") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%PORT%"=="" set "PORT=4200"
if "%CLOUDFLARED_PROTOCOL%"=="" set "CLOUDFLARED_PROTOCOL=http2"
if "%ORIGIN_PROTOCOL%"=="" set "ORIGIN_PROTOCOL=http"

if "%SKYWAY_APP_ID%"=="" (
  echo SKYWAY_APP_ID is not set.
  echo Copy .env.public.example to .env.public and set your SkyWay values.
  pause
  exit /b 1
)

if "%SKYWAY_SECRET_KEY%"=="" if "%SKYWAY_SECRET%"=="" (
  echo SKYWAY_SECRET_KEY is not set.
  echo Copy .env.public.example to .env.public and set your SkyWay values.
  pause
  exit /b 1
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared is not installed.
  echo Install it with:
  echo   winget install --id Cloudflare.cloudflared
  pause
  exit /b 1
)

echo Building Udonarium Daphne...
call npm.cmd run build -- --configuration development
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "dist\udonarium-daphne\index.html" (
  echo Build output was not found: dist\udonarium-daphne\index.html
  pause
  exit /b 1
)

for /f %%P in ('powershell -NoProfile -Command "$p=[int]$env:PORT; while (Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue) { $p++ }; $p"') do set "PORT=%%P"

echo Starting local server on %ORIGIN_PROTOCOL%://127.0.0.1:%PORT%/
start "Udonarium Daphne Local Server" cmd /k "set HOST=127.0.0.1&& set PORT=%PORT%&& set PROTOCOL=%ORIGIN_PROTOCOL%&& node local-https-server.cjs"

echo Waiting for local server...
for /l %%I in (1,1,20) do (
  curl.exe -s -f "%ORIGIN_PROTOCOL%://127.0.0.1:%PORT%/v1/status" >nul 2>nul
  if not errorlevel 1 goto SERVER_READY
  timeout /t 1 /nobreak >nul
)

echo Local server did not respond on %ORIGIN_PROTOCOL%://127.0.0.1:%PORT%/
echo Check the "Udonarium Daphne Local Server" window for details.
pause
exit /b 1

:SERVER_READY

echo Starting Cloudflare Quick Tunnel...
echo Local target: %ORIGIN_PROTOCOL%://127.0.0.1:%PORT%/
echo Share the https://*.trycloudflare.com/ URL shown below.
if /i "%ORIGIN_PROTOCOL%"=="https" (
  cloudflared tunnel --protocol %CLOUDFLARED_PROTOCOL% --url https://127.0.0.1:%PORT% --no-tls-verify
) else (
  cloudflared tunnel --protocol %CLOUDFLARED_PROTOCOL% --url http://127.0.0.1:%PORT%
)
