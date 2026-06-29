# Native (no-Docker) backend launcher for Windows without admin rights.
# Uses `uv` to provision Python 3.12 into backend/.venv, installs deps,
# installs the Playwright Chromium browser, runs migrations, and starts uvicorn.
#
# Usage:  .\start-backend.ps1            # port 8000 (default)
#         .\start-backend.ps1 -Port 8001 # use a different port
param([int]$Port = 8000)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "backend"
Set-Location $backend

# This repo may live under OneDrive, whose cloud filesystem can't hardlink
# (uv fails with "os error 396"). Force uv to COPY wheels instead of hardlinking.
$env:UV_LINK_MODE = "copy"

# Locate uv (user-scoped install, no admin needed).
$uv = "uv"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    $uv = Join-Path $env:APPDATA "Python\Python314\Scripts\uv.exe"
    if (-not (Test-Path $uv)) {
        Write-Error "uv not found. Install with: pip install --user uv"
    }
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating Python 3.12 venv via uv..." -ForegroundColor Cyan
    & $uv venv --python 3.12 .venv
}

$py = Join-Path $backend ".venv\Scripts\python.exe"
Write-Host "Installing dependencies..." -ForegroundColor Cyan
& $uv pip install --python $py -r requirements.txt

Write-Host "Installing Playwright Chromium..." -ForegroundColor Cyan
& $py -m playwright install chromium

# Load .env if present; ensure env file exists.
if (-not (Test-Path ".env")) {
    Copy-Item (Join-Path $root ".env.example") ".env"
    Write-Host "Created backend/.env from .env.example (edit DB + keys as needed)." -ForegroundColor Yellow
}

# Schema: the app calls Base.metadata.create_all on startup, so native dev needs
# no migration step. (Alembic is for Docker/production on a DEDICATED database —
# don't run it against a DB shared with another project: its alembic_version
# history will not match and `upgrade head` will fail.)
Write-Host "Schema handled via create_all on startup (Alembic reserved for prod)." -ForegroundColor Cyan

Write-Host "Starting API on http://localhost:$Port ..." -ForegroundColor Green
& $py -m uvicorn app.main:app --host 0.0.0.0 --port $Port --reload
