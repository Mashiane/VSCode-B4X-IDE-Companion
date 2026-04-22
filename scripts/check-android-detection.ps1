# Quick check: detect B4A INI, derive SDK root, and resolve adb/aapt paths
Write-Output "Starting Android SDK detection check..."

$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Output "Repo root: $repoRoot"

$appdata = $env:APPDATA
$iniCandidates = @()
if ($appdata) { $iniCandidates += Join-Path $appdata 'Anywhere Software\B4A\b4xV5.ini' }
$iniCandidates += 'C:\Program Files\Anywhere Software\B4A\b4xV5.ini'

# Try workspace .vscode settings if present
$workspaceSettings = Join-Path $repoRoot '.vscode\settings.json'
if (Test-Path $workspaceSettings) {
  try {
    $json = Get-Content $workspaceSettings -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($json.'b4xIntellisense.b4aIniPath') {
      $iniCandidates = ,($json.'b4xIntellisense.b4aIniPath') + $iniCandidates
    } elseif ($json.b4xIntellisense -and $json.b4xIntellisense.b4aIniPath) {
      $iniCandidates = ,($json.b4xIntellisense.b4aIniPath) + $iniCandidates
    }
  } catch {
    Write-Output "Could not parse workspace settings: $_"
  }
}

$foundIni = $iniCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($foundIni) { Write-Output "Found INI: $foundIni" } else { Write-Output "No INI found in candidates: $($iniCandidates -join ', ')" }

$sdkRoot = $null
if ($foundIni) {
  $lines = Get-Content $foundIni
  $platformFolder = $null
  foreach ($l in $lines) {
    $t = $l.Trim()
    if ($t -match '^\s*PlatformFolder\s*=\s*(.+)') {
      $v = $Matches[1].Trim()
      if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
      $platformFolder = $v
      break
    }
  }
  if ($platformFolder) {
    Write-Output "PlatformFolder from INI: $platformFolder"
    if (Test-Path $platformFolder) {
      $sdkRoot = Split-Path -Parent (Split-Path -Parent $platformFolder)
      Write-Output "Derived SDK root: $sdkRoot"
    } else { Write-Output "PlatformFolder path does not exist: $platformFolder" }
  } else { Write-Output "PlatformFolder not found in INI." }
}

# Fall back to environment variables
if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) {
  if ($env:ANDROID_SDK_ROOT) { $sdkRoot = $env:ANDROID_SDK_ROOT; Write-Output "Using ANDROID_SDK_ROOT: $sdkRoot" }
}
if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) {
  if ($env:ANDROID_HOME) { $sdkRoot = $env:ANDROID_HOME; Write-Output "Using ANDROID_HOME: $sdkRoot" }
}
if (-not $sdkRoot -or -not (Test-Path $sdkRoot)) {
  if (Test-Path 'C:\b4a\sdk') { $sdkRoot = 'C:\b4a\sdk'; Write-Output "Using default C:\b4a\sdk" }
}
if ($sdkRoot) { Write-Output "Final SDK root: $sdkRoot" } else { Write-Output "SDK root not found." }

# Resolve adb
$adbCandidates = @()
if ($env:ADB_PATH) { $adbCandidates += $env:ADB_PATH }
if ($sdkRoot) { $adbCandidates += Join-Path $sdkRoot 'platform-tools\adb.exe' }
$adbCandidates += 'C:\b4a\sdk\platform-tools\adb.exe'
$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
if ($adbCmd) { $adbCandidates += $adbCmd.Source }
$adbPath = $adbCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
Write-Output "Resolved adb path: $adbPath"

# Resolve aapt / aapt2
$aaptPath = $null; $aapt2Path = $null
if ($sdkRoot) {
  $aaptFound = Get-Item (Join-Path $sdkRoot 'build-tools\*\aapt.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($aaptFound) { $aaptPath = $aaptFound.FullName }
  $aapt2Found = Get-Item (Join-Path $sdkRoot 'build-tools\*\aapt2.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($aapt2Found) { $aapt2Path = $aapt2Found.FullName }
}
Write-Output "Resolved aapt: $aaptPath"
Write-Output "Resolved aapt2: $aapt2Path"

if ($adbPath) {
  Write-Output "`nadb devices output:"
  & $adbPath devices
}

Write-Output "`nCheck complete."