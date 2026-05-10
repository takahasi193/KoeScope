param(
  [int]$Port = 5178,
  [string]$Page = "/",
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

function Test-KoeScopeHealth {
  param([int]$TargetPort)

  try {
    $response = Invoke-RestMethod -Uri "http://localhost:$TargetPort/api/health" -TimeoutSec 2
    return [bool]$response.ok
  } catch {
    return $false
  }
}

function Test-PortListener {
  param([int]$TargetPort)

  return [bool](Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue)
}

$projectRoot = $PSScriptRoot
$logDir = Join-Path $projectRoot "dev-logs"
$outLog = Join-Path $logDir "koescope-launch.out.log"
$errLog = Join-Path $logDir "koescope-launch.err.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location -LiteralPath $projectRoot

$isHealthy = Test-KoeScopeHealth -TargetPort $Port
if (-not $isHealthy) {
  if (Test-PortListener -TargetPort $Port) {
    throw "Port $Port is already in use, but KoeScope health check failed."
  }

  $command = "cd /d `"$projectRoot`" && npm start >> `"$outLog`" 2>> `"$errLog`""
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null

  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-KoeScopeHealth -TargetPort $Port) {
      $isHealthy = $true
      break
    }
  }
}

if (-not $isHealthy) {
  throw "KoeScope did not become healthy on port $Port. See $errLog."
}

if (-not $NoOpen) {
  $normalizedPage = if ($Page.StartsWith("/")) { $Page } else { "/$Page" }
  Start-Process "http://localhost:$Port$normalizedPage"
}

Write-Host "KoeScope is ready at http://localhost:$Port/"
