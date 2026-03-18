param(
    [switch]$NoOpen,
    [string]$DeviceId = "",
    [string]$AdbPath = "",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

# Determine output directory: prefer explicit OutputDir, else look for 'B4A\screenshots' under current workspace folder
function Resolve-ScreenshotsDir {
    param([string]$explicit)
    if ($explicit -and (Test-Path $explicit)) { return (Resolve-Path $explicit).Path }
    $cwd = (Get-Location).Path
    $cur = $cwd
    while ($cur) {
        $candidate = Join-Path $cur "B4A\screenshots"
        if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
        $parent = Split-Path $cur -Parent
        if ($parent -and ($parent -ne $cur)) { $cur = $parent } else { break }
    }
    # fallback to a local screenshots folder next to script
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $fallback = Join-Path $scriptRoot "B4A\screenshots"
    New-Item -ItemType Directory -Path $fallback -Force | Out-Null
    return (Resolve-Path $fallback).Path
}

$shotDir = Resolve-ScreenshotsDir -explicit $OutputDir
$latest = Join-Path $shotDir "latest-screen.png"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stamped = Join-Path $shotDir ("screen-" + $timestamp + ".png")

if ($AdbPath -and (Test-Path $AdbPath)) {
    $adb = $AdbPath
} else {
    # prefer platform-tools adb in common locations
    $defaultCandidates = @(
        Join-Path $env:LOCALAPPDATA "Android\sdk\platform-tools\adb.exe",
        "C:\\b4a\\sdk\\platform-tools\\adb.exe",
        "C:\\Android\\platform-tools\\adb.exe",
        "adb.exe"
    )
    $adb = $null
    foreach ($c in $defaultCandidates) {
        try { if (Test-Path $c) { $adb = $c; break } } catch {}
    }
    if (-not $adb) { $adb = 'adb' }
}

New-Item -ItemType Directory -Path $shotDir -Force | Out-Null

if (-not (Get-Command $adb -ErrorAction SilentlyContinue) -and -not (Test-Path $adb)) {
    throw "adb not found at: $adb. Provide -AdbPath or ensure adb is on PATH."
}

if ([string]::IsNullOrWhiteSpace($DeviceId)) {
    # discover first online device
    $devices = & $adb devices | Where-Object { $_ -match "^\S+\s+device$" }
    if (-not $devices) { throw "No connected Android device found." }
    $DeviceId = ($devices | Select-Object -First 1) -split '\s+' | Select-Object -First 1
}

# Capture screenshot to latest
if ($IsWindows) {
    $cmd = '"' + $adb + '" -s "' + $DeviceId + '" exec-out screencap -p > "' + $latest + '"'
    cmd.exe /c $cmd | Out-Null
} else {
    & $adb -s $DeviceId exec-out screencap -p > $latest
}

if (-not (Test-Path $latest)) { throw "Failed to capture screenshot: $latest" }

Copy-Item -Path $latest -Destination $stamped -Force

# Find paint.net if available, but do not error out unless user requested open
$paintExe = (Get-Command "paintdotnet.exe" -ErrorAction SilentlyContinue)?.Source
if (-not $paintExe) {
    $candidates = @(
        "C:\Program Files\paint.net\paintdotnet.exe",
        "C:\Program Files (x86)\paint.net\paintdotnet.exe"
    )
    foreach ($candidate in $candidates) { if (Test-Path $candidate) { $paintExe = $candidate; break } }
}

if (-not $NoOpen) {
    if ([string]::IsNullOrWhiteSpace($paintExe) -or (-not (Test-Path $paintExe))) {
        throw "paint.net executable not found. Expected paintdotnet.exe in PATH or under Program Files."
    }
    Start-Process -FilePath $paintExe -ArgumentList ('"' + $latest + '"') | Out-Null
}

$latestItem = Get-Item $latest
$stampedItem = Get-Item $stamped

Write-Output ("LATEST_PATH=" + $latestItem.FullName)
Write-Output ("LATEST_TIME=" + $latestItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
Write-Output ("STAMPED_PATH=" + $stampedItem.FullName)
Write-Output ("STAMPED_TIME=" + $stampedItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
if ([string]::IsNullOrWhiteSpace($paintExe)) { Write-Output "PAINT_PATH=(not found)" } else { Write-Output ("PAINT_PATH=" + $paintExe) }
