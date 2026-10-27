$ErrorActionPreference = 'Stop'
$streamUiRoot = Split-Path -Parent $PSScriptRoot
$streamUiHost = Join-Path $streamUiRoot '.local\host\StreamUI.Host.exe'
if (Test-Path -LiteralPath (Join-Path $streamUiRoot 'StreamUI Host.exe')) { $streamUiHost = Join-Path $streamUiRoot 'StreamUI Host.exe' }
if (-not (Test-Path -LiteralPath $streamUiHost)) {
    throw 'Host is not built. Run npm run host:package first.'
}
$streamUiData = Join-Path $streamUiRoot '.local\state'
$streamUiBridge = Join-Path $streamUiRoot '.local\event-bridge\0.3.21\leb-server-windows-x64.exe'
$streamUiBridgeDirectory = Join-Path $streamUiData 'event-bridge\0.3.21'
if ((Test-Path -LiteralPath $streamUiBridge) -and -not (Test-Path -LiteralPath (Join-Path $streamUiBridgeDirectory 'leb-server-windows-x64.exe'))) {
    New-Item -ItemType Directory -Path $streamUiBridgeDirectory -Force | Out-Null
    Copy-Item -LiteralPath $streamUiBridge -Destination $streamUiBridgeDirectory -Force
}
Start-Process -FilePath $streamUiHost -ArgumentList @('--data-dir', ('"' + $streamUiData + '"')) -WorkingDirectory $streamUiRoot -WindowStyle Hidden
