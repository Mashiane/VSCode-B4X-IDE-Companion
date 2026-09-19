#requires -Version 5.1
<#
.SYNOPSIS
    Zero-dependency / Standalone Installer for Android Emulator AVD
    Device_720x1612 (4in_Phone_Platform_36_google_apis)
.DESCRIPTION
    Sets up the emulator even if Android SDK is NOT installed.
    Auto-downloads Google's official commandline-tools, emulator, and system-image
    if missing on the target machine.
#>

param(
    [string]$TargetSdkPath = '',
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$avdName = "4in_Phone_Platform_36_google_apis"
$skinName = "Device_720x1612"
$systemImagePkg = "system-images;android-36;google_apis;x86_64"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Android Emulator Setup: $avdName (720x1612 Skin)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# Helper to download fast via .NET WebClient
function Download-FileWithProgress($url, $destination) {
    Write-Host "    Downloading: $url" -ForegroundColor Gray
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    $wc.DownloadFile($url, $destination)
}

# 1. Locate or Designate SDK Directory
$sdkCandidates = @(
    $TargetSdkPath,
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    "C:\b4a\sdk",
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk"
)

$sdkPath = $null
foreach ($cand in $sdkCandidates) {
    if ($cand -and (Test-Path $cand)) {
        $sdkPath = (Resolve-Path $cand).Path
        break
    }
}

if (-not $sdkPath) {
    $defaultInstallPath = "C:\b4a\sdk"
    if ($TargetSdkPath) {
        $sdkPath = $TargetSdkPath
    } elseif ($NonInteractive) {
        $sdkPath = $defaultInstallPath
    } else {
        Write-Host "`nNo existing Android SDK detected on this machine." -ForegroundColor Yellow
        Write-Host "Default installation location: $defaultInstallPath" -ForegroundColor Gray
        $prompt = Read-Host "Press Enter to install SDK to $defaultInstallPath, or type custom path"
        if ($prompt -and $prompt.Trim() -ne "") {
            $sdkPath = $prompt.Trim()
        } else {
            $sdkPath = $defaultInstallPath
        }
    }
}

Write-Host "[+] Target SDK Path: $sdkPath" -ForegroundColor Green
if (-not (Test-Path $sdkPath)) {
    New-Item -ItemType Directory -Path $sdkPath -Force | Out-Null
}

# 2. Check for cmdline-tools (sdkmanager.bat)
$cmdlineToolsDir = Join-Path $sdkPath "cmdline-tools"
$sdkmanagerCandidates = @(
    (Join-Path $sdkPath "cmdline-tools\latest\bin\sdkmanager.bat"),
    (Join-Path $sdkPath "cmdline-tools\bin\sdkmanager.bat")
)
$sdkmanagerBat = $sdkmanagerCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $sdkmanagerBat) {
    Write-Host "`n[!] sdkmanager not found. Downloading Google Android Commandline Tools..." -ForegroundColor Yellow
    $toolsZipUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    $tempZip = Join-Path $env:TEMP "cmdline-tools.zip"
    
    Download-FileWithProgress $toolsZipUrl $tempZip
    
    $tempExtract = Join-Path $env:TEMP "cmdline-tools-extracted"
    if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
    Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force
    Remove-Item $tempZip -Force
    
    $latestDir = Join-Path $sdkPath "cmdline-tools\latest"
    if (-not (Test-Path (Split-Path $latestDir))) { New-Item -ItemType Directory -Path (Split-Path $latestDir) -Force | Out-Null }
    if (Test-Path $latestDir) { Remove-Item $latestDir -Recurse -Force }
    
    Move-Item -Path (Join-Path $tempExtract "cmdline-tools") -Destination $latestDir -Force
    Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
    
    $sdkmanagerBat = Join-Path $latestDir "bin\sdkmanager.bat"
    Write-Host "[+] Google Commandline Tools installed." -ForegroundColor Green
}

# 3. Check for Emulator & Platform-Tools
$emulatorExe = Join-Path $sdkPath "emulator\emulator.exe"
$needPackages = @()

if (-not (Test-Path $emulatorExe)) {
    Write-Host "[!] Emulator binary missing." -ForegroundColor Yellow
    $needPackages += "emulator"
    $needPackages += "platform-tools"
}

# 4. Check for System Image
$sysImgPath = Join-Path $sdkPath "system-images\android-36\google_apis\x86_64"
if (-not (Test-Path (Join-Path $sysImgPath "system.img"))) {
    Write-Host "[!] System image android-36 (x86_64) missing." -ForegroundColor Yellow
    $needPackages += $systemImagePkg
}

# Download missing packages via sdkmanager if any
if ($needPackages.Count -gt 0) {
    Write-Host "`n[+] Downloading required components directly from Google repository:" -ForegroundColor Cyan
    $needPackages | ForEach-Object { Write-Host "    - $_" -ForegroundColor Gray }
    Write-Host "    This may take a few minutes depending on internet connection..." -ForegroundColor Gray
    
    $licenseInput = "y`ny`ny`ny`ny`ny`ny`ny`n"
    $argList = @("--sdk_root=$sdkPath") + $needPackages
    
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = $sdkmanagerBat
    $pinfo.Arguments = ($argList -join ' ')
    $pinfo.UseShellExecute = $false
    $pinfo.RedirectStandardInput = $true
    $pinfo.RedirectStandardOutput = $false
    
    $proc = [System.Diagnostics.Process]::Start($pinfo)
    $proc.StandardInput.WriteLine($licenseInput)
    $proc.WaitForExit()
    
    if ($proc.ExitCode -ne 0) {
        Write-Warning "sdkmanager returned code $($proc.ExitCode)."
    } else {
        Write-Host "[+] Google components downloaded and verified successfully." -ForegroundColor Green
    }
}

# 5. Deploy Skin
$skinDest = Join-Path $sdkPath "Skins\$skinName"
if (-not (Test-Path (Join-Path $sdkPath "Skins"))) {
    New-Item -ItemType Directory -Path (Join-Path $sdkPath "Skins") -Force | Out-Null
}
if (Test-Path $skinDest) { Remove-Item $skinDest -Recurse -Force }
New-Item -ItemType Directory -Path $skinDest -Force | Out-Null
Copy-Item -Path "$scriptRoot\skins\$skinName\*" -Destination $skinDest -Recurse -Force
Write-Host "[+] Skin installed to: $skinDest" -ForegroundColor Green

# 6. Deploy AVD Profile & Config
$avdFolder = Join-Path $sdkPath "B4AEmulator\$avdName"
if (-not (Test-Path (Join-Path $sdkPath "B4AEmulator"))) {
    $avdFolder = Join-Path "$env:USERPROFILE\.android\avd" "$avdName.avd"
}
$avdParent = Split-Path -Parent $avdFolder
if (-not (Test-Path $avdParent)) { New-Item -ItemType Directory -Path $avdParent -Force | Out-Null }
if (-not (Test-Path $avdFolder)) { New-Item -ItemType Directory -Path $avdFolder -Force | Out-Null }

$templateContent = Get-Content "$scriptRoot\template\config.ini.template" -Raw
$finalConfig = $templateContent.Replace("{{SKIN_PATH}}", $skinDest)
Set-Content -Path (Join-Path $avdFolder "config.ini") -Value $finalConfig -Encoding UTF8
Write-Host "[+] AVD profile configured: $avdFolder" -ForegroundColor Green

# 7. Register AVD in user's .android/avd
$dotAndroidAvd = "$env:USERPROFILE\.android\avd"
if (-not (Test-Path $dotAndroidAvd)) { New-Item -ItemType Directory -Path $dotAndroidAvd -Force | Out-Null }
$regIniPath = Join-Path $dotAndroidAvd "$avdName.ini"
@"
avd.ini.encoding=UTF-8
path=$avdFolder
target=android-36
"@ | Set-Content $regIniPath -Encoding UTF8
Write-Host "[+] Registered AVD definition: $regIniPath" -ForegroundColor Green

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host " Setup Complete! You can now start the emulator." -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
