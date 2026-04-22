param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Prefix,
    [int]$MaxShots = 20,
    [int]$ResetToTopSwipes = 6,
    [int]$SwipeDurationMs = 320,
    [int]$SwipeDelayMs = 650,
    [ValidateRange(0, 256)]
    [int]$DuplicateHashThreshold = 6,
    [switch]$KeepExisting,
    [string]$DeviceId = "",
    [string]$OutputDir = "",
    [string]$AdbPath = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Determine default OutputDir similar to other tools: prefer workspace B4A\screenshots when available.
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

# Use provided AdbPath when present, otherwise fall back to the common SDK location.
$adb = $AdbPath
if ([string]::IsNullOrWhiteSpace($adb)) {
    $adb = "C:\b4a\sdk\platform-tools\adb.exe"
}
if (-not (Test-Path $adb)) {
    throw "adb not found at: $adb"
}

if ($MaxShots -lt 1) {
    throw "MaxShots must be >= 1."
}

if ($ResetToTopSwipes -lt 0) {
    throw "ResetToTopSwipes must be >= 0."
}

if ($SwipeDurationMs -lt 100) {
    throw "SwipeDurationMs must be >= 100."
}

if ($SwipeDelayMs -lt 100) {
    throw "SwipeDelayMs must be >= 100."
}

if ([string]::IsNullOrWhiteSpace($Prefix)) {
    throw "Prefix cannot be empty."
}

$invalidNameChars = [System.IO.Path]::GetInvalidFileNameChars()
foreach ($ch in $invalidNameChars) {
    if ($Prefix.Contains([string]$ch)) {
        throw "Prefix contains invalid filename character: '$ch'"
    }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$deletedCount = 0
if (-not $KeepExisting) {
    $existing = Get-ChildItem -Path $OutputDir -Filter ($Prefix + "*.png") -File -ErrorAction SilentlyContinue
    foreach ($file in @($existing)) {
        Remove-Item -Path $file.FullName -Force -ErrorAction SilentlyContinue
        $deletedCount++
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

function Get-ScreenSize([string]$Did) {
    $wm = & $adb -s $Did shell wm size
    $line = $wm | Where-Object { $_ -match "(\d+)x(\d+)" } | Select-Object -First 1
    if (-not $line) {
        throw "Failed to read screen size from device."
    }

    $match = [regex]::Match($line, "(\d+)x(\d+)")
    if (-not $match.Success) {
        throw "Failed to parse screen size line: $line"
    }

    return [pscustomobject]@{
        Width = [int]$match.Groups[1].Value
        Height = [int]$match.Groups[2].Value
    }
}

function Invoke-Swipe([string]$Did, [int]$X, [int]$Y1, [int]$Y2, [int]$Duration) {
    & $adb -s $Did shell input swipe $X $Y1 $X $Y2 $Duration | Out-Null
}

function Capture-Screen([string]$Did, [string]$Path) {
    $cmd = '"' + $adb + '" -s "' + $Did + '" exec-out screencap -p > "' + $Path + '"'
    cmd.exe /c $cmd | Out-Null
    if (-not (Test-Path $Path)) {
        throw "Failed to capture screenshot: $Path"
    }
}

function Get-ImageAHash([string]$Path, [int]$Size = 16) {
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    } catch {
        throw "System.Drawing is not available in this PowerShell runtime. Ensure you're running on Windows PowerShell or have the required assemblies available."
    }

    $original = [System.Drawing.Bitmap]::new($Path)
    try {
        $cropTop = [int][Math]::Round($original.Height * 0.08)
        $cropBottom = [int][Math]::Round($original.Height * 0.03)
        $cropHeight = $original.Height - $cropTop - $cropBottom
        if ($cropHeight -lt 1) {
            $cropTop = 0
            $cropHeight = $original.Height
        }

        $scaled = [System.Drawing.Bitmap]::new($Size, $Size)
        try {
            $g = [System.Drawing.Graphics]::FromImage($scaled)
            try {
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
                $g.DrawImage(
                    $original,
                    [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
                    [System.Drawing.Rectangle]::new(0, $cropTop, $original.Width, $cropHeight),
                    [System.Drawing.GraphicsUnit]::Pixel
                )
            }
            finally {
                $g.Dispose()
            }

            $luma = New-Object 'System.Collections.Generic.List[int]'
            for ($y = 0; $y -lt $Size; $y++) {
                for ($x = 0; $x -lt $Size; $x++) {
                    $p = $scaled.GetPixel($x, $y)
                    $value = [int][Math]::Round((0.299 * $p.R) + (0.587 * $p.G) + (0.114 * $p.B))
                    $luma.Add($value) | Out-Null
                }
            }

            $avg = [double]($luma | Measure-Object -Average).Average
            $bits = New-Object System.Text.StringBuilder
            foreach ($v in $luma) {
                if ($v -ge $avg) {
                    [void]$bits.Append("1")
                }
                else {
                    [void]$bits.Append("0")
                }
            }
            return $bits.ToString()
        }
        finally {
            $scaled.Dispose()
        }
    }
    finally {
        $original.Dispose()
    }
}

function Get-HammingDistance([string]$A, [string]$B) {
    if ([string]::IsNullOrWhiteSpace($A) -or [string]::IsNullOrWhiteSpace($B)) {
        return [int]::MaxValue
    }
    if ($A.Length -ne $B.Length) {
        return [int]::MaxValue
    }
    $d = 0
    for ($i = 0; $i -lt $A.Length; $i++) {
        if ($A[$i] -ne $B[$i]) {
            $d++
        }
    }
    return $d
}

$did = Get-OnlineDevice $DeviceId
$size = Get-ScreenSize $did

$x = [int][Math]::Round($size.Width / 2.0)
$scrollStart = [int][Math]::Round($size.Height * 0.78)
$scrollEnd = [int][Math]::Round($size.Height * 0.28)
$resetStart = $scrollEnd
$resetEnd = $scrollStart

# Bring list to top before the first capture.
for ($i = 1; $i -le $ResetToTopSwipes; $i++) {
    Invoke-Swipe -Did $did -X $x -Y1 $resetStart -Y2 $resetEnd -Duration $SwipeDurationMs
    Start-Sleep -Milliseconds $SwipeDelayMs
}

$saved = New-Object System.Collections.Generic.List[string]
$previousHash = ""
$stopReason = "MaxShotsReached"
$lastDistance = -1

for ($index = 1; $index -le $MaxShots; $index++) {
    $name = "{0}{1}.png" -f $Prefix, $index
    $path = Join-Path $OutputDir $name

    Capture-Screen -Did $did -Path $path
    $hash = Get-ImageAHash -Path $path -Size 16

    if ($index -gt 1) {
        $distance = Get-HammingDistance -A $hash -B $previousHash
        $lastDistance = $distance
        if ($distance -le $DuplicateHashThreshold) {
            Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
            $stopReason = "ReachedBottomSimilarFrame"
            break
        }
    }
    $saved.Add($path) | Out-Null
    $previousHash = $hash

    if ($index -lt $MaxShots) {
        Invoke-Swipe -Did $did -X $x -Y1 $scrollStart -Y2 $scrollEnd -Duration $SwipeDurationMs
        Start-Sleep -Milliseconds $SwipeDelayMs
    }
}

Write-Output ("STATUS=Success")
Write-Output ("DEVICE_ID=" + $did)
Write-Output ("OUTPUT_DIR=" + (Resolve-Path $OutputDir).Path)
Write-Output ("SCREEN_WIDTH=" + $size.Width)
Write-Output ("SCREEN_HEIGHT=" + $size.Height)
Write-Output ("FILES_SAVED=" + $saved.Count)
Write-Output ("STOP_REASON=" + $stopReason)
Write-Output ("EXISTING_PREFIX_FILES_DELETED=" + $deletedCount)
Write-Output ("DUPLICATE_HASH_THRESHOLD=" + $DuplicateHashThreshold)
Write-Output ("LAST_HASH_DISTANCE=" + $lastDistance)
Write-Output ("ADB_PATH=" + $adb)

if ($saved.Count -gt 0) {
    Write-Output ("FIRST_FILE=" + $saved[0])
    Write-Output ("LAST_FILE=" + $saved[$saved.Count - 1])
}
