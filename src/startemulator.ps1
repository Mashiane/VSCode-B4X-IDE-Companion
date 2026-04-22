param(
    [string]$EmulatorPath = '',
    [string]$ApkPath = '',
    [string]$PackageName = '',
    [switch]$LaunchAfterBoot,
    [string]$IniPath = '',
    [string]$Gpu = 'auto',           # options: auto|host|swiftshader_indirect|off
    [switch]$FallbackToSoftwareGpu    # when set, detect GPU/emulation errors and restart once with SwiftShader
)

# Use provided path or default
if ($EmulatorPath -and (Test-Path $EmulatorPath)) {
    $emulatorPath = $EmulatorPath
} else {
    $emulatorPath = 'C:\b4a\sdk\emulator\emulator.exe'
}

if (-not (Test-Path $emulatorPath)) {
    Write-Error "Android emulator not found: $emulatorPath"
    exit 1
}

Write-Host "Detecting available Android emulators..." -ForegroundColor Cyan
$avdListOutput = & $emulatorPath -list-avds 2>$null

# Debug: show raw output
Write-Host "Raw output: [$avdListOutput]" -ForegroundColor Gray

if (-not $avdListOutput -or $avdListOutput.Trim() -eq '') {
    Write-Warning "No Android emulators (AVDs) found. Create one via Android Studio Device Manager first."
    exit 1
}

# Parse AVD names - each line is a plain AVD name (no '/' separator in modern emulator output)
$avdNames = @()
foreach ($line in $avdListOutput) {
    $line = $line.ToString().Trim()
    if (-not $line) { continue }
    $avdNames += $line
}

if ($avdNames.Count -eq 0) {
    Write-Warning "No Android emulators (AVDs) found. Create one via Android Studio Device Manager first."
    exit 1
}

# Sort and display - force array to prevent single-element string conversion
$avdNames = @($avdNames | Sort-Object -Unique)
Write-Host "Parsed $($avdNames.Count) emulator(s): $($avdNames -join ', ')" -ForegroundColor Gray

if ($avdNames.Count -eq 1) {
    $avdName = $avdNames[0]
    Write-Host "Found emulator: $avdName" -ForegroundColor Green
} else {
    Write-Host "`nAvailable Android emulators:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $avdNames.Count; $i++) {
        Write-Host "  [$($i + 1)] $($avdNames[$i])"
    }

    Write-Host "`nSelect an emulator (1-$($avdNames.Count)), or press Enter for default [1]: " -NoNewline -ForegroundColor Yellow
    $selection = Read-Host
    if (-not $selection) { $selection = 1 }

    $idx = [int]$selection - 1
    if ($idx -lt 0 -or $idx -ge $avdNames.Count) {
        Write-Error "Invalid selection. Aborting."
        exit 1
    }
    $avdName = $avdNames[$idx]
}

Write-Host "`nStarting Android emulator: $avdName (gpu=$Gpu)" -ForegroundColor Green

# Minimal adb resolution (used when attempting to power/wake an already-running emulator)
$adbCandidates = @()
if ($env:ADB_PATH) { $adbCandidates += $env:ADB_PATH }
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if ($adbCmd) { $adbCandidates += $adbCmd.Source }
$adbCandidates += 'C:\b4a\sdk\platform-tools\adb.exe'
$adbPath = $adbCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

# Check whether an emulator process for this AVD is already running. If so, attempt to power/wake it
try {
    $emulatorProcs = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.Name -match 'emulator' -and $_.CommandLine -and $_.CommandLine -match '-avd' -and $_.CommandLine -match [regex]::Escape($avdName)
    }
} catch {
    $emulatorProcs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'emulator' }
}

if ($emulatorProcs -and $emulatorProcs.Count -gt 0) {
    $pids = $emulatorProcs | ForEach-Object { if ($_.PSObject.Properties.Name -contains 'ProcessId') { $_.ProcessId } elseif ($_.PSObject.Properties.Name -contains 'Id') { $_.Id } } | Sort-Object -Unique
    Write-Host "Emulator process already running for $avdName (PID(s): $($pids -join ', ')). Attempting to power/wake device." -ForegroundColor Yellow

    if ($adbPath) {
        $devLines = & $adbPath devices 2>$null | Where-Object { $_ -match "^\S+\s+\S+$" }
        $deviceIds = @($devLines | ForEach-Object { ($_ -split "\s+")[0] }) | Where-Object { $_ -match "^emulator" }
        if ($deviceIds.Count -eq 0) {
            $deviceIds = @($devLines | ForEach-Object { ($_ -split "\s+")[0] }) | Where-Object { $_ -match "emulator" }
        }

        if ($deviceIds.Count -gt 0) {
            foreach ($deviceId in $deviceIds) {
                Write-Host "Sending power/wake key events to $deviceId..." -ForegroundColor Gray
                & $adbPath -s $deviceId shell input keyevent 26 2>$null
                Start-Sleep -Milliseconds 500
                & $adbPath -s $deviceId shell input keyevent 82 2>$null
            }
            Write-Host "Power/wake commands sent. Waiting up to 30 seconds for device availability..." -ForegroundColor Gray
            $maxWaitSecs = 30
            $waited = 0
            while ($waited -lt $maxWaitSecs) {
                Start-Sleep -Seconds 2
                $devLines = & $adbPath devices 2>$null | Where-Object { $_ -match "^\S+\s+device$" }
                if ($devLines) { break }
                $waited += 2
            }
            if ($waited -ge $maxWaitSecs) { Write-Warning "Device did not appear in adb devices after wake attempt." }
            else { Write-Host "Device is available." -ForegroundColor Green }
        } else {
            Write-Warning "No emulator device id found in 'adb devices'; cannot send power commands."
        }
    } else {
        Write-Warning "adb not found; cannot send power/wake commands to emulator."
    }

    Write-Host "Skipping emulator launch since process already exists for $avdName." -ForegroundColor Cyan
} else {
    $startArgs = @('-avd', $avdName)
    if ($Gpu -and $Gpu -ne 'auto') { $startArgs += @('-gpu', $Gpu) }
    Start-Process -FilePath $emulatorPath -ArgumentList $startArgs
    Write-Host "Emulator launched (requested GPU: $Gpu)." -ForegroundColor Green
}

# If caller requested app launch (or provided an APK/Package), wait for device and attempt launch
if ($LaunchAfterBoot -or $ApkPath -or $PackageName) {
    # Determine SDK root (try platform INI first, then environment vars, then emulator path)
    $sdkRoot = $null

    # 1) Try B4A INI (either supplied via -IniPath or default APPDATA location)
    $iniFile = $null
    if ($IniPath -and (Test-Path $IniPath)) {
        $iniFile = $IniPath
    } else {
        if ($env:APPDATA) {
            $candidate = Join-Path $env:APPDATA 'Anywhere Software\B4A\b4xV5.ini'
            if (Test-Path $candidate) { $iniFile = $candidate }
        }
    }

    if ($iniFile) {
        try {
            $lines = Get-Content $iniFile -ErrorAction Stop
            foreach ($l in $lines) {
                $t = $l.Trim()
                if (-not $t) { continue }
                if ($t.StartsWith(';') -or $t.StartsWith('#')) { continue }
                if ($t -notmatch '=') { continue }
                $sep = $t.IndexOf('=')
                $k = $t.Substring(0, $sep).Trim()
                $v = $t.Substring($sep + 1).Trim()
                if ($k -ieq 'PlatformFolder' -and $v) {
                    # Strip surrounding quotes if present
                    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
                    if (Test-Path $v) {
                        # PlatformFolder points to e.g. <sdkRoot>\platforms\android-36
                        $sdkRoot = Split-Path -Parent (Split-Path -Parent $v)
                        break
                    }
                }
            }
        } catch {
            # ignore parse errors and fall back to other detection methods
        }
    }

    # 2) Environment variables
    if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) { $sdkRoot = $env:ANDROID_SDK_ROOT }
    if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) { $sdkRoot = $env:ANDROID_HOME }

    # 3) Fallback: derive from emulator path (assumes <sdkRoot>\emulator\emulator.exe)
    if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) { $sdkRoot = Split-Path -Parent (Split-Path -Parent $emulatorPath) }

    # Resolve adb
    $adbCandidates = @()
    if ($env:ADB_PATH) { $adbCandidates += $env:ADB_PATH }
    if ($sdkRoot) { $adbCandidates += Join-Path $sdkRoot 'platform-tools\adb.exe' }
    $adbCandidates += 'C:\b4a\sdk\platform-tools\adb.exe'
    $adbCmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($adbCmd) { $adbCandidates += $adbCmd.Source }
    $adbPath = $adbCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

    if (-not $adbPath) {
        Write-Warning "adb not found. Cannot auto-launch app without adb."
        return
    }

    # Resolve aapt (only needed if APK provided and package name not supplied)
    $aaptPath = $null
    $useAapt2 = $false
    if ($ApkPath -and (Test-Path $ApkPath) -and -not $PackageName) {
        if ($sdkRoot) {
            $buildAaptPattern = Join-Path $sdkRoot "build-tools\*\aapt.exe"
            $aaptFound = Get-Item $buildAaptPattern -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($aaptFound) {
                $aaptPath = $aaptFound.FullName
            } else {
                $buildAapt2Pattern = Join-Path $sdkRoot "build-tools\*\aapt2.exe"
                $aapt2Found = Get-Item $buildAapt2Pattern -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($aapt2Found) {
                    $aaptPath = $aapt2Found.FullName
                    $useAapt2 = $true
                }
            }
        }
    }

    # Wait for emulator to appear in adb devices
    Write-Host "Waiting for emulator to appear in adb devices..." -ForegroundColor Gray
    $maxWaitSecs = 180
    $waited = 0
    while ($waited -lt $maxWaitSecs) {
        Start-Sleep -Seconds 2
        $devLines = & $adbPath devices 2>$null | Where-Object { $_ -match "^\S+\s+device$" }
        if ($devLines) { break }
        $waited += 2
    }

    if ($waited -ge $maxWaitSecs) {
        Write-Warning "Emulator did not appear in adb devices after $maxWaitSecs seconds. Skipping auto-launch."
        return
    }

    # Collect device ids (prefer emulator instances)
    $deviceLines = & $adbPath devices 2>$null | Where-Object { $_ -match "^\S+\s+device$" }
    $deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] }) | Where-Object { $_ -match "^emulator" }
    if ($deviceIds.Count -eq 0) {
        $deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] })
    }

    # Optional: detect emulator GPU / SurfaceFlinger / EGL issues and optionally restart emulator with SwiftShader
    if ($FallbackToSoftwareGpu) {
        $foundGpuErrors = $false
        foreach ($deviceId in $deviceIds) {
            if ($deviceId -match '^emulator') {
                $logText = & $adbPath -s $deviceId logcat -d 2>$null
                if ($logText -match 'EGL_emulation|SurfaceFlinger|Failed to choose config|Software OpenGL failed|ANR in com.android.systemui') {
                    $foundGpuErrors = $true
                    break
                }
            }
        }

        if ($foundGpuErrors) {
            Write-Warning "Detected emulator GPU/SurfaceFlinger errors in logcat. Restarting emulator with SwiftShader (software GPU)."
            foreach ($deviceId in $deviceIds) {
                if ($deviceId -match '^emulator') {
                    try { & $adbPath -s $deviceId emu kill 2>$null } catch { }
                }
            }

            Start-Sleep -Seconds 3
            # Relaunch emulator explicitly with SwiftShader
            $ssArgs = @('-avd', $avdName, '-gpu', 'swiftshader_indirect')
            Start-Process -FilePath $emulatorPath -ArgumentList $ssArgs
            Write-Host "Restarted emulator with SwiftShader; waiting for device to re-appear..." -ForegroundColor Yellow

            # Wait again for devices
            $maxWaitSecs = 180
            $waited = 0
            while ($waited -lt $maxWaitSecs) {
                Start-Sleep -Seconds 2
                $devLines = & $adbPath devices 2>$null | Where-Object { $_ -match "^\S+\s+device$" }
                if ($devLines) { break }
                $waited += 2
            }

            if ($waited -ge $maxWaitSecs) {
                Write-Warning "Emulator did not re-appear in adb devices after restart. Skipping auto-launch."
                return
            }

            # Recompute device ids after restart
            $deviceLines = & $adbPath devices 2>$null | Where-Object { $_ -match "^\S+\s+device$" }
            $deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] }) | Where-Object { $_ -match "^emulator" }
            if ($deviceIds.Count -eq 0) { $deviceIds = @($deviceLines | ForEach-Object { ($_ -split "\s+")[0] }) }
        }
    }

    # If APK provided and no package name yet, try to extract it with aapt/aapt2
    if (-not $PackageName -and $ApkPath -and (Test-Path $ApkPath)) {
        if ($aaptPath) {
            $aaptOutput = & $aaptPath dump badging $ApkPath 2>&1 | Select-String "package: name='"
            if ($aaptOutput) {
                $PackageName = [regex]::Match($aaptOutput, "name='([^']+)'").Groups[1].Value
                Write-Host "Package name: $PackageName"
            } else {
                Write-Warning "Could not extract package name from APK using aapt. Skipping auto-launch."
            }
        } else {
            Write-Warning "aapt not found, skipping auto-launch."
        }
    }

    if ($PackageName) {
        foreach ($deviceId in $deviceIds) {
            if ($ApkPath -and (Test-Path $ApkPath)) {
                Write-Host "Installing APK on device $deviceId..." -ForegroundColor Gray
                $installOutput = & $adbPath -s $deviceId install -r $ApkPath 2>&1
                $installText = ($installOutput -join "`n")
                if ($installText -notmatch "Success") {
                    Write-Warning "APK install may have failed on $($deviceId): $installText"
                } else {
                    Write-Host "APK installed on $($deviceId)" -ForegroundColor Green
                }
            }

            Write-Host "Starting app on device: $deviceId" -ForegroundColor Green
            $launchOutput = & $adbPath -s $deviceId shell am start -n "$PackageName/anywheresoftware.b4a.B4AMainActivity" 2>&1
            $launchText = ($launchOutput -join "`n")
            if ($launchText -match "Starting: Intent" -or $launchText -match "Error type 3") {
                Write-Host "LAUNCH_STATUS=Done (app launched or already running)"
            } else {
                Write-Host "LAUNCH_STATUS=Done"
            }
        }
    }

}
