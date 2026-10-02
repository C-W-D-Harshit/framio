# Framio installer: irm https://framio.design/install.ps1 | iex
# Overrides: FRAMIO_VERSION, FRAMIO_INSTALL, FRAMIO_REPO, FRAMIO_DOWNLOAD_URL.
param(
    [string]$Version = $env:FRAMIO_VERSION,
    [string]$InstallRoot = $env:FRAMIO_INSTALL,
    [switch]$NoPath
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use install.sh on macOS or Linux.' }
if ([Environment]::OSVersion.Version -lt [Version]'10.0.17763') {
    throw 'Framio requires Windows 10 version 1809 or later.'
}
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($architecture -ne 'AMD64') { throw 'This installer supports Windows x64.' }
if (!$Version) { $Version = 'latest' }
if ($Version -ne 'latest' -and $Version -notmatch '^v\d+\.\d+\.\d+$') { throw 'FRAMIO_VERSION must be latest or a tag such as v0.0.9.' }
if (!$InstallRoot) { $InstallRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.framio' }
$repository = if ($env:FRAMIO_REPO) { $env:FRAMIO_REPO } else { 'C-W-D-Harshit/framio' }
$baseUrl = if ($env:FRAMIO_DOWNLOAD_URL) {
    $env:FRAMIO_DOWNLOAD_URL.TrimEnd('/')
} elseif ($Version -eq 'latest') {
    "https://github.com/$repository/releases/latest/download"
} else {
    "https://github.com/$repository/releases/download/$Version"
}
$asset = 'framio-win32-x64.tar.gz'
$executable = 'framio-win32-x64.exe'
$binDirectory = Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'bin'
$target = Join-Path $binDirectory 'framio.exe'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('framio-install-' + [Guid]::NewGuid())
$previous = $null
# PowerShell 5.1 may otherwise negotiate an obsolete TLS version.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    Write-Output "Framio installer: Windows x64, $Version"
    $archive = Join-Path $temporary $asset
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$asset" -OutFile $archive
    $checksumFile = Join-Path $temporary 'SHA256SUMS'
    Invoke-WebRequest -UseBasicParsing "$baseUrl/SHA256SUMS" -OutFile $checksumFile
    $checksums = Get-Content -Raw $checksumFile
    $checksumLines = @($checksums -split "`n" | Where-Object { $_.TrimEnd("`r") -match ('^[a-fA-F0-9]{64}  ' + [regex]::Escape($asset) + '$') })
    if ($checksumLines.Count -ne 1) { throw 'Release checksum is missing or malformed.' }
    $expected = $checksumLines[0].Substring(0, 64)
    if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Archive checksum does not match the release.' }
    $entries = @(& tar.exe -tzf $archive)
    if ($LASTEXITCODE -ne 0 -or $entries.Count -ne 1 -or $entries[0] -cne $executable) {
        throw 'Archive must contain only the expected executable.'
    }
    $details = @(& tar.exe -tvzf $archive)
    if ($LASTEXITCODE -ne 0 -or $details.Count -ne 1 -or !$details[0].StartsWith('-')) {
        throw 'Archive executable must be a regular file.'
    }
    & tar.exe -xzf $archive -C $temporary
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the release archive.' }
    $downloaded = Join-Path $temporary $executable
    $actual = & $downloaded --version
    if ($LASTEXITCODE -ne 0 -or "$actual" -notmatch '(?:^|\s)(\d+\.\d+\.\d+)$') { throw 'The downloaded executable could not run.' }
    if ($Version -ne 'latest' -and $Version -ne "v$($Matches[1])") { throw 'Executable version does not match the requested tag.' }
    New-Item -ItemType Directory -Force -Path $binDirectory | Out-Null
    if (Test-Path $target) {
        $previous = Join-Path $binDirectory ('.framio.exe.retired-' + [Guid]::NewGuid() + '.exe')
        Move-Item $target $previous
    }
    try { Move-Item $downloaded $target } catch {
        if ($previous) { Move-Item $previous $target; $previous = $null }
        throw
    }
    if (!$NoPath) {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($binDirectory -notin ($userPath -split ';')) {
            [Environment]::SetEnvironmentVariable('Path', (@($userPath, $binDirectory) | Where-Object { $_ }) -join ';', 'User')
        }
        if ($binDirectory -notin ($env:Path -split ';')) { $env:Path = "$binDirectory;$env:Path" }
    }
    Write-Output "Installed $actual at $target"
    Write-Output 'Open a new terminal, then run framio init and framio start in your project.'
} finally {
    Remove-Item -Recurse -Force $temporary -ErrorAction SilentlyContinue
    if ($previous) { Remove-Item -Force $previous -ErrorAction SilentlyContinue }
}
