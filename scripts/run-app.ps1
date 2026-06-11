[CmdletBinding()]
param(
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

function Import-DotEnv {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing .env file: $Path"
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed.StartsWith("export ")) {
      $trimmed = $trimmed.Substring(7).Trim()
    }

    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 1) {
      continue
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()

    if ($name -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") {
      continue
    }

    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Test-LocalPort {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $connection.AsyncWaitHandle.WaitOne(250)) {
      return $false
    }

    $client.EndConnect($connection)
    return $client.Connected
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

function ConvertTo-EncodedCommand {
  param([string]$Command)

  return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
}

Import-DotEnv -Path $envFile

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm was not found. Install pnpm, then run RUN_APP.cmd again."
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  throw "Dependencies are missing. Run 'pnpm install', then run RUN_APP.cmd again."
}

if ($ValidateOnly) {
  Write-Host "Launcher validation OK"
  exit 0
}

foreach ($port in 8080, 5173) {
  if (Test-LocalPort -Port $port) {
    throw "Port $port is already in use. Close the existing app window or process, then run RUN_APP.cmd again."
  }
}

$escapedRoot = $root.Replace("'", "''")

$apiCommand = @"
Set-Location -LiteralPath '$escapedRoot'
`$Host.UI.RawUI.WindowTitle = 'SharedAccManager API'
`$env:NODE_ENV = 'development'
`$env:PORT = '8080'
pnpm --filter '@workspace/api-server' run dev
if (`$LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'API failed to start.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
}
"@

$frontendCommand = @"
Set-Location -LiteralPath '$escapedRoot'
`$Host.UI.RawUI.WindowTitle = 'SharedAccManager Frontend'
`$env:PORT = '5173'
`$env:API_PORT = '8080'
pnpm --filter '@workspace/accounts-manager' run dev
if (`$LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Frontend failed to start.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
}
"@

Write-Host "Starting API and frontend..."

Start-Process powershell.exe `
  -WorkingDirectory $root `
  -ArgumentList "-NoExit", "-NoProfile", "-EncodedCommand", (ConvertTo-EncodedCommand $apiCommand)

Start-Process powershell.exe `
  -WorkingDirectory $root `
  -ArgumentList "-NoExit", "-NoProfile", "-EncodedCommand", (ConvertTo-EncodedCommand $frontendCommand)

$frontendReady = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  if (Test-LocalPort -Port 5173) {
    $frontendReady = $true
    break
  }
  Start-Sleep -Milliseconds 500
}

if (-not $frontendReady) {
  throw "Frontend did not start within 60 seconds. Check the Frontend window for the error."
}

Start-Process "http://localhost:5173"
Write-Host "App started: http://localhost:5173"
