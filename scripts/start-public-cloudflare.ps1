$ErrorActionPreference = 'Stop'

Set-Location (Split-Path -Parent $PSScriptRoot)

function Read-PublicEnv {
  param([string]$Path)
  if (!(Test-Path $Path)) { return }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -lt 1 -or $line.StartsWith('#')) { return }
    $index = $line.IndexOf('=')
    if ($index -lt 1) { return }

    $name = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim()
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Get-FreePort {
  param([int]$StartPort)
  $port = $StartPort
  while (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue) {
    $port++
  }
  return $port
}

function Wait-LocalServer {
  param([string]$Url)
  for ($i = 0; $i -lt 20; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$Url/v1/status" -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  return $false
}

function Start-LoggedQuickTunnel {
  param(
    [string[]]$Arguments,
    [string]$LogPath,
    [string]$UrlPath
  )

  if (Test-Path $LogPath) { Remove-Item -LiteralPath $LogPath -Force }
  if (Test-Path $UrlPath) { Remove-Item -LiteralPath $UrlPath -Force }

  Write-Host ''
  Write-Host 'Starting Cloudflare Quick Tunnel...'
  Write-Host 'When the public URL is issued, it will also be written to:'
  Write-Host "  $UrlPath"
  Write-Host ''

  & cloudflared @Arguments 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8

    $match = [regex]::Match($line, 'https://[-a-z0-9]+\.trycloudflare\.com')
    if ($match.Success) {
      $url = $match.Value.TrimEnd('/')
      Set-Content -LiteralPath $UrlPath -Value $url -Encoding UTF8
      Write-Host ''
      Write-Host '============================================================'
      Write-Host "PUBLIC URL: $url"
      Write-Host 'Share this URL. Old trycloudflare URLs stop working when the tunnel stops.'
      Write-Host '============================================================'
      Write-Host ''
    }

    Write-Host $line
  }
}

Read-PublicEnv '.env.public'

if (!$env:PORT) { $env:PORT = '4200' }
if (!$env:CLOUDFLARED_PROTOCOL) { $env:CLOUDFLARED_PROTOCOL = 'http2' }
if (!$env:ORIGIN_PROTOCOL) { $env:ORIGIN_PROTOCOL = 'http' }

if (!$env:SKYWAY_APP_ID) {
  Write-Host 'SKYWAY_APP_ID is not set.'
  Write-Host 'Copy .env.public.example to .env.public and set your SkyWay values.'
  exit 1
}

if (!$env:SKYWAY_SECRET_KEY -and !$env:SKYWAY_SECRET) {
  Write-Host 'SKYWAY_SECRET_KEY is not set.'
  Write-Host 'Copy .env.public.example to .env.public and set your SkyWay values.'
  exit 1
}

if (!(Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'cloudflared is not installed.'
  Write-Host 'Install it with:'
  Write-Host '  winget install --id Cloudflare.cloudflared'
  exit 1
}

$existingCloudflared = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
if ($existingCloudflared) {
  Write-Host 'NOTE: cloudflared is already running.'
  Write-Host 'If an old trycloudflare URL no longer opens, close the old tunnel window and use the new PUBLIC URL printed by this script.'
  Write-Host ''
}

Write-Host 'Building Udonarium Daphne...'
npm.cmd run build -- --configuration development
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (!(Test-Path 'dist\udonarium-daphne\index.html')) {
  Write-Host 'Build output was not found: dist\udonarium-daphne\index.html'
  exit 1
}

$port = Get-FreePort ([int]$env:PORT)
$env:PORT = "$port"

$localUrl = "$($env:ORIGIN_PROTOCOL)://127.0.0.1:$port"
Write-Host "Starting local server on $localUrl/"
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', "title Udonarium Daphne Local Server&& set HOST=127.0.0.1&& set PORT=$port&& set PROTOCOL=$($env:ORIGIN_PROTOCOL)&& node local-https-server.cjs") -WindowStyle Normal

Write-Host 'Waiting for local server...'
if (!(Wait-LocalServer $localUrl)) {
  Write-Host "Local server did not respond on $localUrl/"
  Write-Host 'Check the "Udonarium Daphne Local Server" window for details.'
  exit 1
}

$cloudflaredArgs = @('tunnel', '--protocol', $env:CLOUDFLARED_PROTOCOL, '--url', $localUrl)
if ($env:ORIGIN_PROTOCOL.ToLowerInvariant() -eq 'https') {
  $cloudflaredArgs += '--no-tls-verify'
}

Start-LoggedQuickTunnel `
  -Arguments $cloudflaredArgs `
  -LogPath 'cloudflared-public.log' `
  -UrlPath 'public-url.txt'
