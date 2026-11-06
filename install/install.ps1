# Rafiq in the terminal, on its own (no app): installs `rafiq` for this Windows user.
#
#   irm https://rafiqagent.com/install.ps1 | iex
#
# Downloads the published zip from GitHub (release "cli"), checks it against its published
# SHA-256, unpacks it to %LOCALAPPDATA%\Programs\Rafiq CLI and puts that folder on the user's
# PATH. Run it again to update. Nothing needs administrator rights.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base = "https://github.com/AhmadALSaffan/RAFIQ/releases/download/cli"
$zip = "Rafiq-CLI-windows-x64.zip"
$dir = Join-Path $env:LOCALAPPDATA "Programs\Rafiq CLI"
# For trying a build before it's published: another source and folder, and PATH left alone.
if ($env:RAFIQ_CLI_BASE) { $base = $env:RAFIQ_CLI_BASE }
if ($env:RAFIQ_CLI_DIR) { $dir = $env:RAFIQ_CLI_DIR }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("rafiq-cli-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "Downloading Rafiq for the terminal..."
    Invoke-WebRequest "$base/$zip" -OutFile (Join-Path $tmp $zip) -UseBasicParsing
    Invoke-WebRequest "$base/$zip.sha256" -OutFile (Join-Path $tmp "sum.txt") -UseBasicParsing
    $expected = ((Get-Content (Join-Path $tmp "sum.txt") -Raw).Trim() -split "\s+")[0].ToUpper()
    $actual = (Get-FileHash (Join-Path $tmp $zip) -Algorithm SHA256).Hash.ToUpper()
    if ($actual -ne $expected) { throw "The download doesn't match the published checksum. Nothing was installed." }

    # An older copy that is still running would keep its files locked.
    Get-Process rafiq, rafiq-agent -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    Expand-Archive (Join-Path $tmp $zip) -DestinationPath $dir

    if ($env:RAFIQ_CLI_NO_PATH) { Write-Host "Installed to $dir (PATH not changed)."; return }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    if (($userPath -split ";") -notcontains $dir) {
        [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(";") + ";" + $dir).TrimStart(";")), "User")
    }
    if (($env:Path -split ";") -notcontains $dir) { $env:Path = "$env:Path;$dir" }

    Write-Host ""
    Write-Host "Rafiq is installed. Open a new terminal and type:  rafiq"
    Write-Host "The first time, it helps you add a model (your own key, or a free local one with Ollama)."
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
