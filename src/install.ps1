param(
    [string]$BuilderPath = "",
    [string]$AdbPath = "",
    [string]$ProjectFile = ""
)

$ErrorActionPreference = "Stop"

function Get-OutputValue([string[]]$OutputLines, [string]$KeyName) {
    foreach ($line in $OutputLines) {
        if ($line -like ($KeyName + "=*")) {
            return ($line -replace ("^" + [regex]::Escape($KeyName) + "="), "").Trim()
        }
    }
    return ""
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$b4aFolder = Join-Path $projectRoot "B4A"

# If a ProjectFile parameter is supplied, prefer it (must be a valid path).
if (-not [string]::IsNullOrWhiteSpace($ProjectFile)) {
    if (Test-Path $ProjectFile) {
        $projectFile = $ProjectFile
    } else {
        throw "Provided project file not found: $ProjectFile"
    }
} else {
    # No explicit project provided; defer to discovery below (search for any *.b4a in the B4A folder).
    $projectFile = ''
}
$builder = if ([string]::IsNullOrWhiteSpace($BuilderPath)) { "C:\Program Files\Anywhere Software\B4A\B4ABuilder.exe" } else { $BuilderPath }
$adb = if ([string]::IsNullOrWhiteSpace($AdbPath)) { "C:\b4a\sdk\platform-tools\adb.exe" } else { $AdbPath }
$objectsFolder = Join-Path $b4aFolder "Objects"

if (-not (Test-Path $builder)) {
    throw "B4ABuilder not found at: $builder"
}
if (-not (Test-Path $adb)) {
    throw "adb not found at: $adb"
}
if (-not (Test-Path $b4aFolder)) {
    throw "B4A folder not found: $b4aFolder"
}
# b4xlib and validate-project checks removed; building project directly
if (-not (Test-Path $projectFile)) {
    $projectCandidate = Get-ChildItem -Path $b4aFolder -Filter *.b4a -File | Select-Object -First 1
    if (-not $projectCandidate) {
        throw "No .b4a project found in: $b4aFolder"
    }
    $projectFile = $projectCandidate.FullName
}

# (Validation and b4xlib packaging removed — building project directly)

# 2) Build APK
$buildOutput = & $builder -task=Build "-BaseFolder=$b4aFolder" "-Project=$projectFile" 2>&1
$buildOutput | ForEach-Object { Write-Output $_ }
if ($LASTEXITCODE -ne 0) {
    throw "B4ABuilder failed with exit code $LASTEXITCODE."
}

# 3) Locate APK
$apkItem = Get-ChildItem -Path $objectsFolder -Filter *.apk -File |
Sort-Object LastWriteTime -Descending |
Select-Object -First 1
if (-not $apkItem) {
    throw "APK not found after build in: $objectsFolder"
}
$apkPath = $apkItem.FullName

# 4) Find all connected online devices
$deviceLines = & $adb devices | Where-Object { $_ -match "^\S+\s+device$" }
if (-not $deviceLines) {
    throw "No connected Android device found."
}
$deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] })

Write-Output "BUILD_STATUS=Success"
Write-Output ("APK_PATH=" + $apkPath)
Write-Output ("APK_TIME=" + $apkItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))

# 5) Install on every device
$failedDevices = @()
foreach ($deviceId in $deviceIds) {
    $installOutput = & $adb -s $deviceId install -r $apkPath
    $installText = ($installOutput -join "`n")
    if ($installText -notmatch "Success") {
        $failedDevices += $deviceId
        Write-Output ("DEVICE_ID=" + $deviceId)
        Write-Output "INSTALL_STATUS=Failed"
    } else {
        Write-Output ("DEVICE_ID=" + $deviceId)
        Write-Output "INSTALL_STATUS=Success"
    }
}

if ($failedDevices.Count -gt 0) {
    throw "Install failed on: $($failedDevices -join ', ')"
}
