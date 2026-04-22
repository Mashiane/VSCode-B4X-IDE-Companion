param(
    [string]$BackupRoot = "",
    [string]$SourcePath = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    $SourcePath = Join-Path $projectRoot "B4A"
}
$projectName = Split-Path -Leaf $projectRoot
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $backupRoot = Join-Path $projectRoot "_backups"
} else {
    $backupRoot = $BackupRoot
}
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$displayTimestamp = Get-Date -Format "yyyy-MM-dd HH.mm"

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

# Folders to exclude (relative to B4A root, case-insensitive)
$excludeFolders = @(
    "AutoBackups",
    "JsonLayouts",
    "Screenshots"
)

# Build exclude patterns as full paths for matching
$excludePaths = $excludeFolders | ForEach-Object { (Join-Path $sourcePath $_).TrimEnd('\') }

# Gather all files from B4A, excluding specified internal B4A folders
$files = Get-ChildItem -Path $sourcePath -Recurse -File | Where-Object {
    $filePath = $_.FullName
    $parentDir = Split-Path -Parent $filePath | ForEach-Object { $_.TrimEnd('\') }
    
    # Check if in excluded folder
    $excluded = $false
    foreach ($ep in $excludePaths) {
        if ($filePath -like "$ep\*" -or $filePath -eq $ep) {
            $excluded = $true
            break
        }
    }
    if ($excluded) { return $false }

    # Exclude common non-source artifacts
    $ext = [System.IO.Path]::GetExtension($_.Name).ToLower()
    if ($ext -in @('.md', '.ps1')) { return $false }
    if ($_.Name -like 'package*.json') { return $false }

    return $true
}

Write-Host "Backing up $($files.Count) files (excluding: $($excludeFolders -join ', '))..."

# Use a temp staging directory to preserve folder structure
$tempDir = Join-Path $env:TEMP "perfect_backup_$timestamp"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($SourcePath.Length + 1)
        $destFile = Join-Path $tempDir $relativePath
        $destDir = Split-Path -Parent $destFile
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -Path $file.FullName -Destination $destFile
    }
    $zipName = "Backup {0} {1}.zip" -f $projectName, $displayTimestamp
    $zipPath = Join-Path $backupRoot $zipName
    Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

    Get-Item $zipPath | Select-Object FullName, @{N = 'SizeMB'; E = { [math]::Round($_.Length / 1MB, 2) } }, LastWriteTime
}
finally {
    # Clean up temp directory
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
}
