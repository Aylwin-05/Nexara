# ============================================================
# Nexara mobile DEV build
#
# Rebuilds the web bundle with the API/WebSocket endpoints
# pointing at this PC over the LAN, then syncs it into the
# native Android project. Use when the phone should talk to
# your local backend instead of a deployed HTTPS server.
#
#   cd Mobile
#   powershell -File .\dev-build.ps1          # build + sync
#   powershell -File .\dev-build.ps1 -Port 8001
# ============================================================

param(
    [int]$Port = 8000,

    # Optional explicit override: .\dev-build.ps1 -IpAddress 192.168.1.50
    [string]$IpAddress = ""
)

$ErrorActionPreference = "Stop"

# --- locate this repo ----------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot   # Mobile/ -> repo root
$frontend = Join-Path $repoRoot "frontend"

# --- detect the LAN IPv4 --------------------------------------
# Prefers physical, connected adapters (Wi-Fi / Ethernet). The
# -IpAddress switch skips detection entirely.
$lanIp = $IpAddress

if (-not $lanIp) {

    $upIndexes = (
        Get-NetAdapter -Physical |
        Where-Object { $_.Status -eq "Up" }
    ).ifIndex

    $lanIp = (
        Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            ($upIndexes -contains $_.InterfaceIndex) -and
            ($_.IPAddress -match "^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)")
        } |
        Select-Object -First 1
    ).IPAddress

}

if (-not $lanIp) {
    throw ("No LAN IPv4 address found on a physical adapter. " +
        "Pass one manually: .\dev-build.ps1 -IpAddress <your-ip>")
}

$apiUrl = "http://${lanIp}:${Port}"
$wsUrl  = "ws://${lanIp}:${Port}"

Write-Host ""
Write-Host "==> Server URL for this build: $apiUrl" -ForegroundColor Cyan
Write-Host ""

# --- rebuild the web bundle with dev env ---------------------
Push-Location $frontend

$env:VITE_API_URL = $apiUrl
$env:VITE_WS_URL  = $wsUrl

npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend build failed" }

Remove-Item Env:\VITE_API_URL, Env:\VITE_WS_URL -ErrorAction SilentlyContinue

Pop-Location

# --- sync into the Android project ---------------------------
# Always run from this script's folder: npx resolves the
# Capacitor CLI from Mobile/node_modules, and a sync started
# from another cwd (repo root, frontend/) silently fails.
Push-Location $PSScriptRoot

npx cap sync android
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "cap sync failed" }

Pop-Location

Write-Host ""
Write-Host "Done. Now open in Android Studio and build the APK:" -ForegroundColor Green
Write-Host "    npm run open:android"
Write-Host ""
Write-Host "Backend checklist (must run before launching the app):"
Write-Host "    1. uvicorn app.main:app --host 0.0.0.0 --port $Port"
Write-Host "       (from the backend folder)"
Write-Host "    2. backend .env: CORS_ORIGINS must include https://localhost"
Write-Host "    3. Phone and PC on the same Wi-Fi network"
Write-Host ""
