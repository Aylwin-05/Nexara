# ============================================================
# Nexara mobile PRODUCTION build
#
# Rebuilds the web bundle with the API/WebSocket endpoints baked
# in to a deployed HTTPS domain, then syncs it into the native
# Android project. Use when shipping an APK that talks to a real
# server instead of your PC's LAN IP.
#
#   cd Mobile
#   powershell -File .\prod-build.ps1 -Domain chat.example.com
#
# The domain may optionally include a scheme and port, e.g.:
#   powershell -File .\prod-build.ps1 -Domain https://chat.example.com:443
#
# REST endpoints default to "https://" and WebSocket to "wss://"
# when no scheme is supplied. A path prefix is NOT supported — the
# app uses origin-relative /api/v1, /ws, /push and /uploads.
# ============================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Domain
)

$ErrorActionPreference = "Stop"

# --- locate this repo ----------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot   # Mobile/ -> repo root
$frontend = Join-Path $repoRoot "frontend"

# --- normalise the domain to origin form --------------------
$trimmed = $Domain.Trim().TrimEnd("/")

if ($trimmed -match "^https?://") {
    $apiUrl = $trimmed
} else {
    $apiUrl = "https://${trimmed}"
}

if ($apiUrl -match "http://") {
    $wsUrl = $apiUrl -replace "^http://", "ws://"
} else {
    $wsUrl = $apiUrl -replace "^https://", "wss://"
}

# --- sanity checks ------------------------------------------
if ($apiUrl -notmatch "^(http|https)://[0-9A-Za-z\.\-]+(:\d+)?$") {
    throw ("Invalid domain '$Domain'. Use e.g. chat.example.com " +
        "or https://chat.example.com:443")
}

if ($apiUrl -notmatch "^https://") {
    Write-Host ""
    Write-Host "WARNING: plain http:// was requested." -ForegroundColor Yellow
    Write-Host "Secure cookies, WebSockets and production auth all " -ForegroundColor Yellow
    Write-Host "REQUIRE HTTPS on a deployed device build." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "==> Server URL for this build: $apiUrl" -ForegroundColor Cyan
Write-Host "==> WebSocket URL:            $wsUrl" -ForegroundColor Cyan
Write-Host ""

# --- rebuild the web bundle with prod env -------------------
Push-Location $frontend

$env:VITE_API_URL = $apiUrl
$env:VITE_WS_URL  = $wsUrl

npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend build failed" }

Remove-Item Env:\VITE_API_URL, Env:\VITE_WS_URL -ErrorAction SilentlyContinue

Pop-Location

# --- sync into the Android project --------------------------
# Always run from this script's folder: npx resolves the
# Capacitor CLI from Mobile/node_modules, and a sync started
# from another cwd (repo root, frontend/) silently fails.
Push-Location $PSScriptRoot

npx cap sync android
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "cap sync failed" }

Pop-Location

Write-Host ""
Write-Host "Done. Now open in Android Studio and Build the release APK:" -ForegroundColor Green
Write-Host "    npm run open:android"
Write-Host ""
Write-Host "Backend checklist (must be true before users install this APK):"
Write-Host "    1. HTTPS in front of backend (nginx/coturn) on $($apiUrl -replace '^https?://','')"
Write-Host "    2. backend .env: COOKIE_SECURE=true"
Write-Host "    3. backend .env: COOKIE_SAMESITE=None"
Write-Host "    4. backend .env: CORS_ORIGINS includes your deployed origin"
Write-Host "    5. backend .env: FRONTEND_URL set to your deployed frontend"
Write-Host ""