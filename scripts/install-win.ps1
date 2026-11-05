# Installs Supervisor on Windows from the latest GitHub Release. Users paste, in PowerShell:
#
#   irm https://raw.githubusercontent.com/pr4nav3/Supervisor/main/scripts/install-win.ps1 | iex
#
# The installer is fetched with curl.exe, which ships with Windows 10 and 11 and leaves no
# mark-of-the-web on the file, so SmartScreen does not stop it (the same reason the Mac
# one-liner clears Gatekeeper). The download is checked against the hash published next to
# it before anything runs. Running the same line again is the update.
#
# SUPERVISOR_INSTALL_NO_RUN=1 downloads and verifies only, and prints where the file is.

$ErrorActionPreference = "Stop"
$repo = "pr4nav3/Supervisor"
$api = "https://api.github.com/repos/$repo/releases/latest"

function Fail($message) { Write-Host "Supervisor: $message" -ForegroundColor Red; exit 1 }

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail "curl.exe is missing; it comes with Windows 10 1803 and later." }
if (-not [Environment]::Is64BitOperatingSystem) { Fail "Supervisor needs 64-bit Windows." }

# The installer is the asset that ends in -setup.exe; its hash sits next to it as .sha256.
try { $release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "supervisor-install" } }
catch { Fail "could not read the latest release from GitHub. Check your connection." }
$asset = $release.assets | Where-Object { $_.name -like "*-setup.exe" } | Select-Object -First 1
if (-not $asset) { Fail "the latest release has no Windows installer yet." }
$hashAsset = $release.assets | Where-Object { $_.name -eq "$($asset.name).sha256" } | Select-Object -First 1
if (-not $hashAsset) { Fail "the latest release has no hash for $($asset.name)." }

$tmp = Join-Path $env:TEMP "supervisor-install"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$exe = Join-Path $tmp $asset.name

Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)"
& curl.exe -fL --proto "=https" --retry 3 --progress-bar -o $exe $asset.browser_download_url
if ($LASTEXITCODE -ne 0) { Fail "could not download $($asset.browser_download_url)" }

$expected = (& curl.exe -fsSL --proto "=https" --retry 3 $hashAsset.browser_download_url)
if ($LASTEXITCODE -ne 0 -or -not $expected) { Fail "could not download the hash for $($asset.name)" }
$expected = ($expected -split "\s+")[0].ToLower()
$actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { Remove-Item $exe -Force; Fail "the download did not match its published hash; nothing was installed." }
Write-Host "Verified."

if ($env:SUPERVISOR_INSTALL_NO_RUN) { Write-Host "Not running it: $exe"; exit 0 }

# A running copy would block the installer's file replacement.
Get-Process -Name "supervisor" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Silent, per-user install, then open the app.
$install = Start-Process -FilePath $exe -ArgumentList "/S" -Wait -PassThru
if ($install.ExitCode -ne 0) { Fail "the installer exited with code $($install.ExitCode)." }
$app = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Supervisor") -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "uninstall*" } | Select-Object -First 1
if (-not $app) { Fail "installed, but the app was not found under $env:LOCALAPPDATA\Supervisor." }
Start-Process -FilePath $app.FullName
Write-Host "Supervisor is installed and open. Run this line again any time to update."
