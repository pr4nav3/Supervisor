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
$name = "Supervisor-windows-x64-setup.exe"
# Fixed asset names under releases/latest/download need no GitHub API call, so the
# API's 60-calls-an-hour limit per address never fails installs on a shared network.
$base = "https://github.com/pr4nav3/Supervisor/releases/latest/download"

# throw, not exit: under irm | iex, exit closes the user's PowerShell window with the error.
function Fail($message) { throw "Supervisor: $message" }

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail "curl.exe is missing; it comes with Windows 10 1803 and later." }
if (-not [Environment]::Is64BitOperatingSystem) { Fail "Supervisor needs 64-bit Windows." }

$tmp = Join-Path $env:TEMP "supervisor-install"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$exe = Join-Path $tmp $name

Write-Host "Downloading $name"
& curl.exe -fL --proto "=https" --retry 3 --progress-bar -o $exe "$base/$name"
if ($LASTEXITCODE -ne 0) { Fail "could not download $base/$name. Check your connection." }

$expected = (& curl.exe -fsSL --proto "=https" --retry 3 "$base/$name.sha256")
if ($LASTEXITCODE -ne 0 -or -not $expected) { Fail "could not download the hash for $name" }
$expected = ($expected -split "\s+")[0].ToLower()
$actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { Remove-Item $exe -Force; Fail "the download did not match its published hash; nothing was installed." }
Write-Host "Verified."

if ($env:SUPERVISOR_INSTALL_NO_RUN) {
  Write-Host "Not running it: $exe"
} else {
  # A running copy would block the installer's file replacement. Ask it to quit first, so a
  # running session is ended and saved; only a copy that does not answer is killed.
  $running = Get-Process -Name "supervisor" -ErrorAction SilentlyContinue
  if ($running) {
    $installed = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Supervisor") -Filter "*.exe" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notlike "uninstall*" } | Select-Object -First 1
    if ($installed) {
      Start-Process -FilePath $installed.FullName -ArgumentList "--quit" -ErrorAction SilentlyContinue
      $waited = 0
      while ((Get-Process -Name "supervisor" -ErrorAction SilentlyContinue) -and $waited -lt 10) { Start-Sleep -Seconds 1; $waited++ }
    }
    Get-Process -Name "supervisor" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }

  # Silent, per-user install, then open the app.
  $install = Start-Process -FilePath $exe -ArgumentList "/S" -Wait -PassThru
  if ($install.ExitCode -ne 0) { Fail "the installer exited with code $($install.ExitCode)." }
  $app = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Supervisor") -Filter "*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "uninstall*" } | Select-Object -First 1
  if (-not $app) { Fail "installed, but the app was not found under $env:LOCALAPPDATA\Supervisor." }
  Start-Process -FilePath $app.FullName
  Write-Host "Supervisor is installed and open. Run this line again any time to update."
}
