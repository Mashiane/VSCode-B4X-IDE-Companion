param(
    [string]$Platform = "B4A",
    [string]$BuilderPath = "",
    [string]$AdbPath = "",
    [string]$ProjectFile = "",
    [switch]$LaunchAfterInstall = $true,
    [switch]$OnlyLaunch = $false,
    [string]$ForcePackageName = "",
    [string]$ForceLaunchActivity = "",
    [switch]$SkipInstall = $false,
    [switch]$SuggestSoftwareGpuRestart = $false,
    [string]$JavaPath = ""
)

$ErrorActionPreference = "Stop"
$Platform = $Platform.ToUpper()
if ($Platform -notin @("B4A", "B4J")) {
    throw "Unsupported platform: $Platform. Supported: B4A, B4J"
}

# Platform-specific defaults
$platformDefaults = @{
    "B4A" = @{ Builder = "C:\Program Files\Anywhere Software\B4A\B4ABuilder.exe"; Ext = "*.b4a"; Artifact = "*.apk" }
    "B4J" = @{ Builder = "C:\Program Files\Anywhere Software\B4J\B4JBuilder.exe"; Ext = "*.b4j"; Artifact = "*.jar" }
}
$defaults = $platformDefaults[$Platform]

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path


# Resolve project file and platform folder
if ($Platform -eq "B4J") {
    if ([string]::IsNullOrWhiteSpace($ProjectFile)) {
        throw "For B4J, ProjectFile parameter is required."
    }
    if (-not (Test-Path $ProjectFile)) {
        throw "Provided .b4j project file not found: $ProjectFile"
    }
    $projectFile = $ProjectFile
    $platformFolder = Split-Path -Parent $projectFile
} else {
    if (-not [string]::IsNullOrWhiteSpace($ProjectFile)) {
        if (Test-Path $ProjectFile) {
            $projectFile = $ProjectFile
            $platformFolder = Split-Path -Parent $projectFile
        } else {
            throw "Provided project file not found: $ProjectFile"
        }
    } else {
        $projectFile = ''
        # Fallback: look for a platform subfolder next to the script
        $platformFolder = Join-Path $projectRoot $Platform
    }
}

$builder = if ([string]::IsNullOrWhiteSpace($BuilderPath)) { $defaults.Builder } else { $BuilderPath }
$objectsFolder = Join-Path $platformFolder "Objects"

# Helper: robustly invoke `adb devices` and attempt to start/restart adb server
function Get-AdbDevicesOutput {
    param([string]$adbPath)

    if (-not (Test-Path $adbPath)) { throw "adb not found at: $adbPath" }

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = & $adbPath devices 2>&1
        } finally {
            $ErrorActionPreference = $prevEA
        }

        $text = ($out -join "`n")

        if ($text -match "Unable to connect to adb daemon on port: 5037" -or $text -match "ADB server didn't ACK") {
            Write-Output "adb attempt $attempt/${maxAttempts}: adb daemon not responding. Restarting adb server..."
            # Try a kill/start cycle and retry
            $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { & $adbPath kill-server 2>&1 | ForEach-Object { Write-Output $_ } } finally { $ErrorActionPreference = $prevEA }
            Start-Sleep -Milliseconds 300
            $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { & $adbPath start-server 2>&1 | ForEach-Object { Write-Output $_ } } finally { $ErrorActionPreference = $prevEA }
            Start-Sleep -Milliseconds 500
            continue
        }

        # Normal response (may be just the header when no devices)
        return $out
    }

    throw "Unable to connect to adb daemon on port: 5037 after $maxAttempts attempts. Check adb installation, firewall, or conflicting adb instances."
}

# If user requested launch-only mode, skip build/validation and perform launch on connected devices
if ($OnlyLaunch) {
    # Resolve adb
    $adb = if (-not [string]::IsNullOrWhiteSpace($AdbPath)) { $AdbPath } else { "C:\b4a\sdk\platform-tools\adb.exe" }
    if (-not (Test-Path $adb)) { throw "adb not found at: $adb" }

    if ([string]::IsNullOrWhiteSpace($ForcePackageName)) {
        throw "When using -OnlyLaunch you must provide -ForcePackageName with the installed package name to start."
    }
    $packageName = $ForcePackageName
    $launchActivity = if (-not [string]::IsNullOrWhiteSpace($ForceLaunchActivity)) { $ForceLaunchActivity } else { $null }

    # Find devices (give helpful message for unauthorized devices)
    $rawDeviceOutput = Get-AdbDevicesOutput $adb
    $deviceLines = $rawDeviceOutput | Where-Object { $_ -match "^\S+\s+device$" }
    if (-not $deviceLines) {
        $unauthLines = $rawDeviceOutput | Where-Object { $_ -match "^\S+\s+unauthorized" }
        if ($unauthLines) {
            $ids = $unauthLines | ForEach-Object { ($_ -split "\s+")[0] }
            throw "Found unauthorized device(s): $($ids -join ', '). Please accept USB debugging on the device(s) and re-run."
        }
        throw "No connected Android device found."
    }
    $deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] })

    foreach ($deviceId in $deviceIds) {
        Write-Output "Starting app on device (OnlyLaunch): $deviceId"

        # Check if package running
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $pidOutput = & $adb -s $deviceId shell pidof $packageName 2>&1 } finally { $ErrorActionPreference = $prevEA }
        $pidText = ($pidOutput -join "`n").Trim()

        if ($pidText -and $pidText -notmatch 'not found|error') {
            Write-Output "App is running (pid: $pidText). Bringing to foreground..."
            if ($launchActivity) {
                $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                try { $bringOutput = & $adb -s $deviceId shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$packageName/$launchActivity" 2>&1 } finally { $ErrorActionPreference = $prevEA }
                Write-Output ($bringOutput -join "`n")
            } else {
                $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
                try { $monkeyOutput = & $adb -s $deviceId shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1 } finally { $ErrorActionPreference = $prevEA }
                Write-Output ($monkeyOutput -join "`n")
            }
            continue
        }

        # Not running - attempt to start
        if ($launchActivity) {
            $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { $launchOutput = & $adb -s $deviceId shell am start -n "$packageName/$launchActivity" 2>&1 } finally { $ErrorActionPreference = $prevEA }
            Write-Output ($launchOutput -join "`n")
        } else {
            $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { $monkeyOutput = & $adb -s $deviceId shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1 } finally { $ErrorActionPreference = $prevEA }
            Write-Output ($monkeyOutput -join "`n")
        }
    }

    # Done
    return
}

# Normal validations (skip builder/platform checks when SkipInstall is set)
if (-not $SkipInstall) {
    if (-not (Test-Path $builder)) {
        throw "$($Platform)Builder not found at: $builder"
    }
    if (-not (Test-Path $platformFolder)) {
        throw "$Platform folder not found: $platformFolder"
    }
}


# For B4J, projectFile is always required and already validated above.
# For B4A, discover project file if not explicitly provided.
if ($Platform -eq "B4A" -and -not (Test-Path $projectFile)) {
    $projectCandidate = Get-ChildItem -Path $platformFolder -Filter $defaults.Ext -File | Select-Object -First 1
    if (-not $projectCandidate) {
        throw "No $($defaults.Ext) project found in: $platformFolder"
    }
    $projectFile = $projectCandidate.FullName
}


# 1) Build
Write-Output "Building $Platform project: $projectFile"
if ($Platform -eq "B4A") {
    $buildOutput = & $builder -task=Build "-BaseFolder=$platformFolder" "-Project=$projectFile" 2>&1
} elseif ($Platform -eq "B4J") {
    $buildOutput = & $builder -task=Build "-BaseFolder=$platformFolder" "-Project=$projectFile" 2>&1
}
$buildOutput | ForEach-Object { Write-Output $_ }
if ($LASTEXITCODE -ne 0) {
    throw "$($Platform)Builder failed with exit code $LASTEXITCODE."
}

Write-Output "BUILD_STATUS=Success"

# 2) Platform-specific post-build actions
if ($Platform -eq "B4A") {
    # Resolve adb
    $adb = if ([string]::IsNullOrWhiteSpace($AdbPath)) { "C:\b4a\sdk\platform-tools\adb.exe" } else { $AdbPath }
    if (-not (Test-Path $adb)) {
        throw "adb not found at: $adb"
    }

    # Locate APK
    $apkItem = Get-ChildItem -Path $objectsFolder -Filter *.apk -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $apkItem) {
        throw "APK not found after build in: $objectsFolder"
    }
    $apkPath = $apkItem.FullName
    Write-Output ("APK_PATH=" + $apkPath)
    Write-Output ("APK_TIME=" + $apkItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))

    # Find all connected online devices (give helpful message for unauthorized devices)
    $rawDeviceOutput = Get-AdbDevicesOutput $adb
    $deviceLines = $rawDeviceOutput | Where-Object { $_ -match "^\S+\s+device$" }
    if (-not $deviceLines) {
        $unauthLines = $rawDeviceOutput | Where-Object { $_ -match "^\S+\s+unauthorized$" }
        if ($unauthLines) {
            $ids = $unauthLines | ForEach-Object { ($_ -split "\s+")[0] }
            throw "Found unauthorized device(s): $($ids -join ', '). Please accept USB debugging on the device(s) and re-run."
        }
        throw "No connected Android device found."
    }
    $deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] })

    # Install on every device
    $failedDevices = @()
    foreach ($deviceId in $deviceIds) {
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $installOutput = & $adb -s $deviceId install -r $apkPath 2>&1
        } finally { $ErrorActionPreference = $prevEA }
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

    # Launch the app on each device
    if ($LaunchAfterInstall) {
        Write-Output ""
        Write-Output "Launching app on devices..."

        # Extract package name from APK using aapt
        # Derive SDK root (prefer adb-derived path) and search build-tools for aapt/aapt2.
        $sdkRoot = $null
        if ($adb -and (Test-Path $adb)) {
            $sdkRoot = Split-Path -Parent (Split-Path -Parent $adb)
        }

        $aaptPath = $null
        $useAapt2 = $false
        if ($sdkRoot -and (Test-Path (Join-Path $sdkRoot 'build-tools'))) {
            $aaptFound = Get-ChildItem -Path (Join-Path $sdkRoot 'build-tools') -Filter 'aapt.exe' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($aaptFound) {
                $aaptPath = $aaptFound.FullName
            } else {
                $aapt2Found = Get-ChildItem -Path (Join-Path $sdkRoot 'build-tools') -Filter 'aapt2.exe' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($aapt2Found) {
                    $aaptPath = $aapt2Found.FullName
                    $useAapt2 = $true
                }
            }
        }

        # If still not found, try to infer SDK root from B4A b4xV5.ini PlatformFolder
        if (-not $aaptPath) {
            $iniFile = $null
            if ($env:APPDATA) {
                $candidate = Join-Path $env:APPDATA 'Anywhere Software\B4A\b4xV5.ini'
                if (Test-Path $candidate) { $iniFile = $candidate }
            }
            if ($iniFile) {
                try {
                    $lines = Get-Content $iniFile -ErrorAction Stop
                    foreach ($l in $lines) {
                        $t = $l.Trim()
                        if ($t -match '^\s*PlatformFolder\s*=\s*(.+)') {
                            $v = $Matches[1].Trim()
                            if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
                            if (Test-Path $v) {
                                $sdkRoot = Split-Path -Parent (Split-Path -Parent $v)
                                break
                            }
                        }
                    }
                } catch {
                    # ignore parse errors and continue
                }
            }

            if ($sdkRoot -and (Test-Path (Join-Path $sdkRoot 'build-tools'))) {
                $aaptFound = Get-ChildItem -Path (Join-Path $sdkRoot 'build-tools') -Filter 'aapt.exe' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($aaptFound) {
                    $aaptPath = $aaptFound.FullName
                } else {
                    $aapt2Found = Get-ChildItem -Path (Join-Path $sdkRoot 'build-tools') -Filter 'aapt2.exe' -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                    if ($aapt2Found) { $aaptPath = $aapt2Found.FullName; $useAapt2 = $true }
                }
            }
        }

        if (-not $aaptPath) {
            Write-Output "aapt not found, skipping auto-launch."
        }

        if ($aaptPath) {
            # Run aapt/aapt2 to get full badging output
            $aaptOutput = & $aaptPath dump badging $apkPath 2>&1
            $aaptText = ($aaptOutput -join "`n")

            # Extract package name
            $pkgMatch = [regex]::Match($aaptText, "package:\s+name='([^']+)'")
            if ($pkgMatch.Success) { $packageName = $pkgMatch.Groups[1].Value }

            # Extract the launchable activity if available
            $launchMatch = [regex]::Match($aaptText, "launchable-activity:\s+name='([^']+)'")
            if (-not $launchMatch.Success) {
                # fallback: look for an activity line (less accurate)
                $actMatch = [regex]::Match($aaptText, "activity:\s+name='([^']+)'")
                if ($actMatch.Success) { $launchActivity = $actMatch.Groups[1].Value }
            } else {
                $launchActivity = $launchMatch.Groups[1].Value
            }

            if ($packageName) {
                Write-Output "Package name: $packageName"
                if ($launchActivity) { Write-Output "Launch activity: $launchActivity" }
                else { Write-Output "Launch activity not found in APK; will use package-only fallback (monkey)" }

                foreach ($deviceId in $deviceIds) {
                    Write-Output "Starting app on device: $deviceId"

                    # Check if package is already running on the device (pidof if available)
                    $prevEA = $ErrorActionPreference
                    $ErrorActionPreference = 'Continue'
                    try {
                        $pidOutput = & $adb -s $deviceId shell pidof $packageName 2>&1
                    } finally { $ErrorActionPreference = $prevEA }
                    $pidText = ($pidOutput -join "`n").Trim()

                    if ($pidText -and $pidText -notmatch 'not found|error') {
                        Write-Output "App is running (pid: $pidText). Bringing to foreground..."
                        if ($launchActivity) {
                            $prevEA = $ErrorActionPreference
                            $ErrorActionPreference = 'Continue'
                            try {
                                $bringOutput = & $adb -s $deviceId shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$packageName/$launchActivity" 2>&1
                            } finally { $ErrorActionPreference = $prevEA }
                            $bringText = ($bringOutput -join "`n")
                            if ($bringText -match "Starting: Intent" -or $bringText -match "Error type 3") {
                                Write-Output "LAUNCH_STATUS=Done (brought to foreground or already running)"
                            } else {
                                Write-Output "LAUNCH_STATUS=Done (bring attempted)"
                            }
                        } else {
                            # No activity: try monkey to bring to foreground
                            $prevEA = $ErrorActionPreference
                            $ErrorActionPreference = 'Continue'
                            try {
                                $monkeyOutput = & $adb -s $deviceId shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1
                            } finally { $ErrorActionPreference = $prevEA }
                            $monkeyText = ($monkeyOutput -join "`n")
                            if ($monkeyText -match "Events injected" -or $monkeyText -match "Monkey finished") {
                                Write-Output "LAUNCH_STATUS=Done (started via monkey)"
                            } else {
                                Write-Output "LAUNCH_STATUS=Done"
                            }
                        }
                        continue
                    }

                    # Not running - try to start the activity directly if available
                    if ($launchActivity) {
                        $prevEA = $ErrorActionPreference
                        $ErrorActionPreference = 'Continue'
                        try {
                            $launchOutput = & $adb -s $deviceId shell am start -n "$packageName/$launchActivity" 2>&1
                        } finally { $ErrorActionPreference = $prevEA }
                        $launchText = ($launchOutput -join "`n")
                        if ($launchText -match "Starting: Intent" -or $launchText -match "Error type 3") {
                            Write-Output "LAUNCH_STATUS=Done (app launched or already running)"
                        } else {
                            # Fallback: try starting the package's launcher activity via monkey
                            $prevEA = $ErrorActionPreference
                            $ErrorActionPreference = 'Continue'
                            try {
                                $monkeyOutput = & $adb -s $deviceId shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1
                            } finally { $ErrorActionPreference = $prevEA }
                            $monkeyText = ($monkeyOutput -join "`n")
                            if ($monkeyText -match "Events injected" -or $monkeyText -match "Monkey finished") {
                                Write-Output "LAUNCH_STATUS=Done (started via monkey)"
                            } else {
                                Write-Output "LAUNCH_STATUS=Done"
                            }
                        }
                    } else {
                        # No launch activity available: use monkey to attempt launch
                        $prevEA = $ErrorActionPreference
                        $ErrorActionPreference = 'Continue'
                        try {
                            $monkeyOutput = & $adb -s $deviceId shell monkey -p $packageName -c android.intent.category.LAUNCHER 1 2>&1
                        } finally { $ErrorActionPreference = $prevEA }
                        $monkeyText = ($monkeyOutput -join "`n")
                        if ($monkeyText -match "Events injected" -or $monkeyText -match "Monkey finished") {
                            Write-Output "LAUNCH_STATUS=Done (started via monkey)"
                        } else {
                            Write-Output "LAUNCH_STATUS=Done"
                        }
                    }
                }
            } else {
                Write-Output "Could not extract package name from APK, skipping auto-launch."
            }
        }
    }
} elseif ($Platform -eq "B4J") {
    # Locate JAR
    $jarItem = Get-ChildItem -Path $objectsFolder -Filter *.jar -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $jarItem) {
        Write-Output "JAR not found after build in: $objectsFolder (build-only mode)"
    } else {
        $jarPath = $jarItem.FullName
        Write-Output ("JAR_PATH=" + $jarPath)
        Write-Output ("JAR_TIME=" + $jarItem.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))

        # Run the JAR
        $javaExec = "java"
        if ($JavaPath) {
            $javaExec = "`"$JavaPath`""
        }
        Write-Output "Running: $javaExec -jar `"$jarPath`""
        if ($JavaPath) {
            & $JavaPath -jar $jarPath
        } else {
            & java -jar $jarPath
        }
    }
}
