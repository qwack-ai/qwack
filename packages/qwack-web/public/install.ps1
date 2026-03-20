$ErrorActionPreference = "Stop"

$Repo = "qwack-ai/qwack"
$InstallDir = if ($env:QWACK_INSTALL_DIR) { $env:QWACK_INSTALL_DIR } else { "$env:LOCALAPPDATA\qwack" }
$Target = "qwack-windows-x64"

# Get latest release (including pre-releases)
$Releases = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases"
$Tag = $Releases[0].tag_name
$Url = "https://github.com/$Repo/releases/download/$Tag/$Target.zip"

Write-Host "Installing qwack $Tag (windows-x64)..."

$Tmp = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }
$ZipPath = Join-Path $Tmp "qwack.zip"
Invoke-WebRequest -Uri $Url -OutFile $ZipPath
Expand-Archive -Path $ZipPath -DestinationPath $Tmp -Force

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item (Join-Path $Tmp "qwack.exe") (Join-Path $InstallDir "qwack.exe") -Force
Remove-Item $Tmp -Recurse -Force

$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$CurrentPath", "User")
    Write-Host "Added $InstallDir to PATH (restart terminal to take effect)"
}

Write-Host "Installed qwack to $InstallDir\qwack.exe"
Write-Host "Run 'qwack' to get started."
