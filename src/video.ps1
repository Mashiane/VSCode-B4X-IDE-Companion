param(
    [ValidateSet("start", "stop", "once")]
    [string]$Action = "once",
    [int]$DurationSec = 20,
    [string]$DeviceId = "",
    [string]$AdbPath = "",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

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
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $fallback = Join-Path $scriptRoot "B4A\screenshots"
    New-Item -ItemType Directory -Path $fallback -Force | Out-Null
    return (Resolve-Path $fallback).Path
}

$shotDir = Resolve-ScreenshotsDir -explicit $OutputDir
$statePath = Join-Path $shotDir ".record-state.json"
$latest = Join-Path $shotDir "latest-record.mp4"

if ($AdbPath -and (Test-Path $AdbPath)) { $adb = $AdbPath } else {
    $defaultCandidates = @(
        Join-Path $env:LOCALAPPDATA "Android\sdk\platform-tools\adb.exe",
        "C:\\b4a\\sdk\\platform-tools\\adb.exe",
        "C:\\Android\\platform-tools\\adb.exe",
        "adb"
    )
    $adb = $null
    foreach ($c in $defaultCandidates) { try { if (Test-Path $c) { $adb = $c; break } } catch {} }
    if (-not $adb) { $adb = 'adb' }
}

New-Item -ItemType Directory -Path $shotDir -Force | Out-Null

if (-not (Get-Command $adb -ErrorAction SilentlyContinue) -and -not (Test-Path $adb)) {
    throw "adb not found at: $adb. Provide -AdbPath or ensure adb is on PATH."
}

function Get-OnlineDevice([string]$PreferredDeviceId) {
    if ($PreferredDeviceId) {
        $line = & $adb devices | Where-Object { $_ -match ("^" + [regex]::Escape($PreferredDeviceId) + "\s+device$") } | Select-Object -First 1
        if (-not $line) {
            throw "Requested device is not online: $PreferredDeviceId"
        }
        return $PreferredDeviceId
    }

    $deviceLine = & $adb devices | Where-Object { $_ -match "^\S+\s+device$" } | Select-Object -First 1
    if (-not $deviceLine) {
        throw "No connected Android device found."
    }
    return ($deviceLine -split "\s+")[0]
}

function Pull-Recording([string]$Did, [string]$RemotePath, [string]$StampedPath) {
    & $adb -s $Did pull $RemotePath $StampedPath | Out-Null
    if (-not (Test-Path $StampedPath)) {
        throw "Failed to pull recording from device: $RemotePath"
    }
    Copy-Item -Path $StampedPath -Destination $latest -Force
    & $adb -s $Did shell rm $RemotePath | Out-Null
}

function Write-RecordingResult([string]$Did, [string]$StampedPath, [int]$Segments) {
    $latestItem = Get-Item $latest
    $stampedItem = Get-Item $StampedPath
    Write-Output "STATUS=Success"
    Write-Output ("DEVICE_ID=" + $Did)
    Write-Output ("LATEST_PATH=" + $latestItem.FullName)
    Write-Output ("LATEST_TIME=" + $latestItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
    Write-Output ("STAMPED_PATH=" + $stampedItem.FullName)
    Write-Output ("STAMPED_TIME=" + $stampedItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
    Write-Output ("SEGMENTS=" + $Segments)
}

if ($Action -eq "start") {
    if (Test-Path $statePath) {
        $existing = Get-Content $statePath -Raw | ConvertFrom-Json
        if ($existing.Pid) {
            $proc = Get-Process -Id $existing.Pid -ErrorAction SilentlyContinue
            if ($proc) {
                throw "Recording already in progress (PID=$($existing.Pid)). Run: .\record.ps1 -Action stop"
            }
        }
        Remove-Item $statePath -Force
    }

    $did = Get-OnlineDevice $DeviceId
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $remoteName = "screenrec-$timestamp.mp4"
    $remotePath = "/sdcard/$remoteName"
    $stamped = Join-Path $shotDir $remoteName

    $p = Start-Process -FilePath $adb -ArgumentList @("-s", $did, "shell", "screenrecord", $remotePath) -PassThru -WindowStyle Hidden

    $state = [ordered]@{
        DeviceId = $did
        RemotePath = $remotePath
        StampedPath = $stamped
        StartedAt = (Get-Date).ToString("o")
        Pid = $p.Id
    }
    ($state | ConvertTo-Json) | Set-Content -Path $statePath -Encoding UTF8

    Write-Output "STATUS=Recording"
    Write-Output ("DEVICE_ID=" + $did)
    Write-Output ("REMOTE_PATH=" + $remotePath)
    Write-Output ("PID=" + $p.Id)
    Write-Output ("STATE_PATH=" + $statePath)
    exit 0
}

if ($Action -eq "stop") {
    if (-not (Test-Path $statePath)) {
        throw "No active recording state found. Run: .\record.ps1 -Action start"
    }

    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    $did = [string]$state.DeviceId
    $remotePath = [string]$state.RemotePath
    $stamped = [string]$state.StampedPath
    $pid = [int]$state.Pid

    if (-not $did -or -not $remotePath -or -not $stamped) {
        throw "Recording state is invalid: $statePath"
    }

    if ($pid -gt 0) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $pid -Force
            Start-Sleep -Milliseconds 1200
        }
    }

    Pull-Recording -Did $did -RemotePath $remotePath -StampedPath $stamped
    Write-RecordingResult -Did $did -StampedPath $stamped -Segments 1
    Remove-Item $statePath -Force -ErrorAction SilentlyContinue
    exit 0
}

$did = Get-OnlineDevice $DeviceId
$remaining = [Math]::Max(1, $DurationSec)
$session = Get-Date -Format "yyyyMMdd-HHmmss"
$segment = 1
$lastStamped = ""

while ($remaining -gt 0) {
    $limit = [Math]::Min(180, $remaining)
    $part = "{0:D3}" -f $segment
    $remoteName = "screenrec-$session-p$part.mp4"
    $remotePath = "/sdcard/$remoteName"
    $stamped = Join-Path $shotDir $remoteName

    & $adb -s $did shell screenrecord --time-limit $limit $remotePath | Out-Null
    Pull-Recording -Did $did -RemotePath $remotePath -StampedPath $stamped

    $lastStamped = $stamped
    $remaining -= $limit
    $segment += 1
}

$segmentCount = $segment - 1
Write-RecordingResult -Did $did -StampedPath $lastStamped -Segments $segmentCount
