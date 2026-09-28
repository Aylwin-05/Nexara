# ==========================================================
# Start Redis and the Nexara backend together (local dev).
#
# The backend needs Postgres (required) and Redis (optional: rate
# limiting, recovery tokens, WebSocket fan-out all fall back to
# in-process stores, and /health reports "degraded" rather than
# 503-ing when it is absent).
#
# This script starts Redis in the background if a redis-server
# binary is available, waits for it, then runs the backend - so one
# command brings up the whole backend. If Redis cannot be found it
# says so and still starts the backend, which now works standalone.
#
#   pwsh -File scripts/dev-backend.ps1
#   pwsh -File scripts/dev-backend.ps1 -Port 8001 -NoReload
# ==========================================================

param(
    [int]$Port = 8000,
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"

function Find-RedisServer {
    $cmd = Get-Command "redis-server" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # Common Windows install locations not always on PATH.
    $candidates = @(
        "C:\Program Files\Redis\redis-server.exe",
        "C:\ProgramData\chocolatey\bin\redis-server.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\Redis\redis-server.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

function Test-Port([int]$Port, [int]$TimeoutMs = 500) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $r = $c.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $r.AsyncWaitHandle.WaitOne($TimeoutMs)
        $c.Close()
        return $ok
    } catch {
        return $false
    }
}

$redis = $null

if (Test-Port 6379) {
    Write-Host "[dev] Redis already listening on 6379 - reusing it." -ForegroundColor DarkGray
} else {
    $exe = Find-RedisServer
    if ($exe) {
        Write-Host "[dev] Starting Redis from $exe" -ForegroundColor Cyan
        $redis = Start-Process -FilePath $exe `
            -ArgumentList "--port", "6379", "--save", '""', "--appendonly", "no" `
            -PassThru -WindowStyle Hidden

        for ($i = 0; $i -lt 30; $i++) {
            if (Test-Port 6379) { break }
            Start-Sleep -Milliseconds 200
        }

        if (Test-Port 6379) {
            Write-Host "[dev] Redis is up on 6379." -ForegroundColor Green
        } else {
            Write-Host "[dev] Redis did not come up; backend will run degraded." -ForegroundColor Yellow
        }
    } else {
        Write-Host @"
[dev] redis-server not found on PATH.
      The backend will still start, using in-process rate limiting
      and recovery tokens, and /health will report:
          {"status":"degraded", "redis":"unreachable"}
      To get full behaviour, either:
        - install Redis and re-run this script, or
        - run the full stack with Docker:  docker compose up
"@ -ForegroundColor Yellow
    }
}

$python = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    $python = "python"
}

$uvicornArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$Port")
if (-not $NoReload) { $uvicornArgs += "--reload" }

Write-Host "[dev] Starting backend on http://127.0.0.1:$Port" -ForegroundColor Cyan

try {
    Push-Location $Backend
    & $python @uvicornArgs
} finally {
    Pop-Location
    if ($redis -and -not $redis.HasExited) {
        Write-Host "[dev] Stopping Redis" -ForegroundColor DarkGray
        Stop-Process -Id $redis.Id -Force -ErrorAction SilentlyContinue
    }
}
