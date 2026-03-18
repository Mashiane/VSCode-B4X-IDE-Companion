$now = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$projectName = Split-Path -Leaf (Get-Location)
$outDir = Join-Path (Get-Location) '_backups'
$out = Join-Path $outDir ("Backup $projectName $now.zip")
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$excludes = '.git','.vs','_backups','node_modules','dist','.gitignore'
$paths = Get-ChildItem -Path . -Force | Where-Object { $excludes -notcontains $_.Name } | Select-Object -ExpandProperty FullName
Compress-Archive -Path $paths -DestinationPath $out -Force
Write-Output $out
