<#
.SYNOPSIS
    Exports Settlers 4 game assets as a zip for use with Settlers.ts.

.PARAMETER SourcePath
    Path to the Settlers 4 game directory (the folder containing Gfx/).

.PARAMETER OutputPath
    Where to write the zip file. Defaults to settlers4-assets.zip on the Desktop.

.PARAMETER IncludeHD
    Also copy the Settlers United HD patch assets if available.

.EXAMPLE
    .\export-game-files.ps1 -SourcePath "D:\Games\thesettlers4"
    .\export-game-files.ps1 -SourcePath "D:\Games\thesettlers4" -IncludeHD
    .\export-game-files.ps1 -SourcePath "D:\Games\thesettlers4" -OutputPath "C:\Users\me\settlers4-assets.zip"
#>

param(
    [string]$SourcePath,
    [string]$OutputPath,
    [switch]$IncludeHD
)

$ErrorActionPreference = "Stop"

# --- Validate source path ---

if (-not $SourcePath) {
    Write-Host ""
    Write-Host "Usage: .\export-game-files.ps1 -SourcePath ""<path to Settlers 4>""" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To find your install directory:" -ForegroundColor Cyan
    Write-Host "  1. Open Ubisoft Connect"
    Write-Host "  2. Go to Settlers United (or The Settlers History Collection)"
    Write-Host "  3. Click Properties (gear icon) -> Installation"
    Write-Host "  4. Use the install path shown there"
    Write-Host ""
    Write-Host "Example:" -ForegroundColor Cyan
    Write-Host "  .\export-game-files.ps1 -SourcePath ""D:\Games\thesettlers4"""
    exit 1
}

if (-not (Test-Path $SourcePath)) {
    Write-Host "Path does not exist: $SourcePath" -ForegroundColor Red
    exit 1
}

# History Edition has unpacked files; classic editions use game.lib
$hasGfx = Test-Path (Join-Path $SourcePath "Gfx")
$hasLib = Test-Path (Join-Path $SourcePath "game.lib")

if (-not $hasGfx -and -not $hasLib) {
    Write-Host "Neither Gfx/ nor game.lib found in: $SourcePath" -ForegroundColor Red
    Write-Host ""
    Write-Host "The path should point to the folder containing the game data." -ForegroundColor Yellow
    Write-Host "For Settlers United, the game files may be in a subfolder like S4_Main/." -ForegroundColor Yellow
    exit 1
}

# --- Output path ---

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $OutputPath) {
    $OutputPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "settlers4-assets.zip"
}

$hdZipDest = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($OutputPath),
    "settlers4-hd-assets.zip"
)

# --- Logging ---

$report = [System.Collections.ArrayList]::new()

function Log($msg) {
    Write-Host $msg
    [void]$report.Add($msg)
}

function LogColor($msg, $color) {
    Write-Host $msg -ForegroundColor $color
    [void]$report.Add($msg)
}

Log "=== Settlers 4 Asset Exporter ==="
Log "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
LogColor "Source:  $SourcePath" "Green"
LogColor "Output:  $OutputPath" "Green"
if ($IncludeHD) { Log "Mode: Including HD assets" }
Log ""

# --- Stage files ---

Log "--- Creating settlers4-assets.zip ---"
Log ""

$stageBase = Join-Path $scriptDir "_stage"
$stageDir = Join-Path $stageBase "Siedler4"
if (Test-Path $stageBase) { Remove-Item $stageBase -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

# Copy .lib files if they exist (classic editions)
foreach ($lib in @("game.lib", "gfx.lib")) {
    $src = Join-Path $SourcePath $lib
    if (Test-Path $src) {
        $sizeMB = [math]::Round((Get-Item $src).Length / 1MB, 1)
        Log "  Adding $lib ($sizeMB MB)..."
        Copy-Item $src -Destination $stageDir -Force
    }
}

# Copy asset folders
foreach ($folder in @("Gfx", "Map", "Save", "GameData", "Config", "Snd", "Txt", "Script")) {
    $src = Join-Path $SourcePath $folder
    if (Test-Path $src) {
        $count = (Get-ChildItem $src -Recurse -File -ErrorAction SilentlyContinue).Count
        $sizeMB = [math]::Round((Get-ChildItem $src -Recurse -File -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum / 1MB, 1)
        Log "  Adding $folder/ ($count files, $sizeMB MB)..."
        $dst = Join-Path $stageDir $folder
        robocopy $src $dst /E /NJH /NJS /NDL /NC /NS /NP | Out-Null
    } else {
        Log "  $folder/ not found, skipping"
    }
}

# Compress
Log ""
Log "  Compressing..."

if (Test-Path $OutputPath) { Remove-Item $OutputPath -Force }
Compress-Archive -Path (Join-Path $stageBase "*") -DestinationPath $OutputPath -CompressionLevel Fastest

$zipSizeMB = [math]::Round((Get-Item $OutputPath).Length / 1MB, 1)
Log ""
LogColor "  settlers4-assets.zip: $zipSizeMB MB" "Green"

# Clean up staging directory
Remove-Item $stageBase -Recurse -Force

# --- HD assets (optional) ---

$hdSource = Join-Path $SourcePath ".settlers-united\.hdpatch\assets.zip"

if ($IncludeHD) {
    Log ""
    Log "--- HD assets ---"
    Log ""
    if (Test-Path $hdSource) {
        $hdSize = (Get-Item $hdSource).Length
        $hdSizeMB = [math]::Round($hdSize / 1MB, 1)
        Log "  Copying HD assets ($hdSizeMB MB)..."

        # Stream copy with progress (file can be 2+ GB)
        $bufferSize = 4MB
        $buffer = New-Object byte[] $bufferSize
        $srcStream = [System.IO.File]::OpenRead($hdSource)
        $dstStream = [System.IO.File]::Create($hdZipDest)
        $copied = 0
        try {
            while (($read = $srcStream.Read($buffer, 0, $bufferSize)) -gt 0) {
                $dstStream.Write($buffer, 0, $read)
                $copied += $read
                $pct = [math]::Round(($copied / $hdSize) * 100)
                $copiedMB = [math]::Round($copied / 1MB)
                Write-Host "`r  Progress: $copiedMB / $hdSizeMB MB ($pct%)" -NoNewline
            }
            Write-Host ""
        } finally {
            $srcStream.Close()
            $dstStream.Close()
        }

        LogColor "  settlers4-hd-assets.zip: $hdSizeMB MB" "Green"
    } else {
        LogColor "  HD assets not found at: $hdSource" "Yellow"
        Log "  Run Settlers United and enable the HD patch first."
    }
} else {
    if (Test-Path $hdSource) {
        $hdSizeMB = [math]::Round((Get-Item $hdSource).Length / 1MB, 1)
        Log ""
        Log "  HD assets available ($hdSizeMB MB). To include them, re-run with -IncludeHD."
    }
}

# --- Done ---

Log ""
LogColor "Done!" "Green"
Log ""
Log "Next steps:"
Log "  1. Copy the zip(s) to your dev machine"
Log "  2. Unzip into the project:"
Log "       unzip settlers4-assets.zip -d public/"
if ($IncludeHD -and (Test-Path $hdZipDest)) {
    Log "       unzip settlers4-hd-assets.zip -d public/Siedler4/"
}
Log "  3. Generate the file list:"
Log "       node scripts/generate-file-list.js"
Log ""

# Write report next to the zip
$reportFile = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($OutputPath),
    "report.txt"
)
$report | Out-File -FilePath $reportFile -Encoding utf8
LogColor "Report written to: $reportFile" "Cyan"
