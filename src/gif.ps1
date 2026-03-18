param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,
    [ValidateRange(1, 180)]
    [int]$DurationSec = 8,
    [ValidateRange(1, 30)]
    [int]$Fps = 12,
    [ValidateRange(120, 1440)]
    [int]$Width = 480,
    [string]$DeviceId = "",
    [string]$OutputDir = "",
    [string]$AdbPath = "",
    [string]$FfmpegPath = "",
    [switch]$KeepMp4,
    [switch]$KeepExisting,
    [switch]$InstallFfmpeg
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Determine default OutputDir:
# 1) If caller provided -OutputDir, use it.
# 2) Otherwise, search upward from the current working directory ($PWD) for a folder that contains a 'B4A' subfolder
#    and use '<workspace>/B4A/screenshots'. This makes the script default to the workspace when run from the project.
# 3) Fallback to a local 'shots' folder next to this script.
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $foundWorkspace = $null
    try {
        $cwd = (Get-Location).Path
        $dir = $cwd
        while ($dir -and $dir -ne [System.IO.Path]::GetPathRoot($dir)) {
            $candidate = Join-Path $dir "B4A"
            if (Test-Path $candidate -PathType Container) {
                $foundWorkspace = $dir
                break
            }
            $dir = Split-Path $dir -Parent
        }
    } catch {
        $foundWorkspace = $null
    }

    if ($foundWorkspace) {
        $OutputDir = Join-Path (Join-Path $foundWorkspace "B4A") "screenshots"
    } else {
        $OutputDir = Join-Path $projectRoot "shots"
    }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$adb = $AdbPath
if ([string]::IsNullOrWhiteSpace($adb)) {
    # fallback to common SDK location used previously
    $adb = "C:\b4a\sdk\platform-tools\adb.exe"
}
if (-not (Test-Path $adb)) {
    throw "adb not found at: $adb"
}

if ([string]::IsNullOrWhiteSpace($Name)) {
    throw "Name cannot be empty."
}

$invalidNameChars = [System.IO.Path]::GetInvalidFileNameChars()
foreach ($ch in $invalidNameChars) {
    if ($Name.Contains([string]$ch)) {
        throw "Name contains invalid filename character: '$ch'"
    }
}

function Get-OnlineDevice([string]$PreferredDeviceId) {
    if (-not [string]::IsNullOrWhiteSpace($PreferredDeviceId)) {
        $line = & $adb devices | Where-Object {
            $_ -match ("^" + [regex]::Escape($PreferredDeviceId) + "\s+device$")
        } | Select-Object -First 1
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

function Resolve-FfmpegPath([string]$PreferredPath) {
    if (-not [string]::IsNullOrWhiteSpace($PreferredPath) -and (Test-Path $PreferredPath)) {
        return $PreferredPath
    }

    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $localProjectFfmpeg = Join-Path $projectRoot ".tools\ffmpeg\bin\ffmpeg.exe"
    if (Test-Path $localProjectFfmpeg) {
        return $localProjectFfmpeg
    }

    $candidates = @(
        "C:\ffmpeg\bin\ffmpeg.exe",
        "C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        "C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffmpeg.exe")
    )
    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path $candidate)) {
            return $candidate
        }
    }

    return ""
}

function Resolve-FfprobePath([string]$FfmpegPathValue) {
    if (-not [string]::IsNullOrWhiteSpace($FfmpegPathValue) -and (Test-Path $FfmpegPathValue)) {
        $ffmpegDir = Split-Path -Parent $FfmpegPathValue
        $localProbe = Join-Path $ffmpegDir "ffprobe.exe"
        if (Test-Path $localProbe) { return $localProbe }
    }

    $cmd = Get-Command ffprobe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return ""
}

function Install-FfmpegWithWinget {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "winget not found. Install ffmpeg manually or install winget."
    }

    & winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
}

function Prepare-DeviceForRecording([string]$Did) {
    & $adb -s $Did shell input keyevent 224 | Out-Null
    & $adb -s $Did shell wm dismiss-keyguard | Out-Null
    Start-Sleep -Milliseconds 600
}

function Test-ValidMp4([string]$Path, [string]$FfprobePathValue) {
    if (-not (Test-Path $Path)) { return $false }
    $item = Get-Item $Path
    if ($item.Length -lt 20480) { return $false }
    if ([string]::IsNullOrWhiteSpace($FfprobePathValue) -or -not (Test-Path $FfprobePathValue)) {
        return $true
    }

    & $FfprobePathValue -v error -show_entries format=duration -of default=nw=1:nk=1 $Path | Out-Null
    return ($LASTEXITCODE -eq 0)
}

 $ffmpegPath = Resolve-FfmpegPath -PreferredPath $FfmpegPath
if ([string]::IsNullOrWhiteSpace($ffmpegPath) -and $InstallFfmpeg) {
    Install-FfmpegWithWinget
    $ffmpegPath = Resolve-FfmpegPath
}
if ([string]::IsNullOrWhiteSpace($ffmpegPath)) {
    throw "ffmpeg was not found. Install it (example: winget install --id Gyan.FFmpeg -e) or run with -InstallFfmpeg."
}
$ffprobePath = Resolve-FfprobePath -FfmpegPathValue $ffmpegPath

$did = Get-OnlineDevice $DeviceId
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$gifPath = Join-Path $OutputDir ($Name + ".gif")
$mp4Path = Join-Path $OutputDir ($Name + ".mp4")
$palettePath = Join-Path $OutputDir ($Name + ".palette.png")

if (-not $KeepExisting) {
    foreach ($path in @($gifPath, $mp4Path, $palettePath)) {
        if (Test-Path $path) {
            Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
        }
    }
}

$recordingSucceeded = $false
for ($attempt = 1; $attempt -le 2; $attempt++) {
    $remotePath = "/sdcard/$Name-$timestamp-a$attempt.mp4"
    try {
        Prepare-DeviceForRecording -Did $did
        $recordCmd = '"' + $adb + '" -s "' + $did + '" shell screenrecord --time-limit ' + $DurationSec + ' "' + $remotePath + '" >nul 2>nul'
        cmd.exe /c $recordCmd | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "adb screenrecord failed."
        }

        $pullCmd = '"' + $adb + '" -s "' + $did + '" pull "' + $remotePath + '" "' + $mp4Path + '" >nul 2>nul'
        cmd.exe /c $pullCmd | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "adb pull failed."
        }
        if (Test-ValidMp4 -Path $mp4Path -FfprobePathValue $ffprobePath) {
            $recordingSucceeded = $true
            break
        }
        if (Test-Path $mp4Path) {
            Remove-Item -Path $mp4Path -Force -ErrorAction SilentlyContinue
        }
    }
    finally {
        & $adb -s $did shell rm $remotePath | Out-Null
    }
    Start-Sleep -Milliseconds 900
}
if (-not $recordingSucceeded) {
    throw "Failed to capture a valid MP4 from the device. Ensure the screen is unlocked and visible, then retry."
}

& $ffmpegPath -y -hide_banner -loglevel error -i $mp4Path -vf ("fps={0},scale={1}:-1:flags=lanczos,palettegen=stats_mode=diff" -f $Fps, $Width) -frames:v 1 $palettePath | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $palettePath)) {
    throw "ffmpeg palette generation failed."
}

& $ffmpegPath -y -hide_banner -loglevel error -i $mp4Path -i $palettePath -lavfi ("fps={0},scale={1}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -f $Fps, $Width) $gifPath | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $gifPath)) {
    throw "ffmpeg GIF conversion failed."
}

if (-not $KeepMp4 -and (Test-Path $mp4Path)) {
    Remove-Item -Path $mp4Path -Force -ErrorAction SilentlyContinue
}

if (Test-Path $palettePath) {
    Remove-Item -Path $palettePath -Force -ErrorAction SilentlyContinue
}

Write-Output "STATUS=Success"
Write-Output ("DEVICE_ID=" + $did)
Write-Output ("OUTPUT_DIR=" + (Resolve-Path $OutputDir).Path)
Write-Output ("GIF_PATH=" + $gifPath)
Write-Output ("GIF_NAME=" + [System.IO.Path]::GetFileName($gifPath))
Write-Output ("DURATION_SEC=" + $DurationSec)
Write-Output ("FPS=" + $Fps)
Write-Output ("WIDTH=" + $Width)
Write-Output ("FFMPEG_PATH=" + $ffmpegPath)
Write-Output ("FFPROBE_PATH=" + $ffprobePath)
Write-Output ("ADB_PATH=" + $adb)
Write-Output ("MP4_KEPT=" + $(if ($KeepMp4) { "true" } else { "false" }))
if ($KeepMp4) {
    Write-Output ("MP4_PATH=" + $mp4Path)
}
