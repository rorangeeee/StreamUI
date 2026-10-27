param([string]$HostExecutable = '')
$ErrorActionPreference = 'Stop'
$streamUiRoot = Split-Path -Parent $PSScriptRoot
$streamUiHost = Join-Path $streamUiRoot '.local\host\StreamUI.Host.exe'
if ($HostExecutable) { $streamUiHost = [System.IO.Path]::GetFullPath($HostExecutable) }
elseif (Test-Path -LiteralPath (Join-Path $streamUiRoot 'StreamUI Host.exe')) { $streamUiHost = Join-Path $streamUiRoot 'StreamUI Host.exe' }
$streamUiReport = Join-Path $streamUiRoot '.local\host-self-test.json'
if (-not (Test-Path -LiteralPath $streamUiHost)) { throw 'Run npm run host:build first.' }
$streamUiTest = Start-Process -FilePath $streamUiHost -ArgumentList @('--self-test', '--report', ('"' + $streamUiReport + '"')) -WindowStyle Hidden -PassThru -Wait
Get-Content -LiteralPath $streamUiReport
if ($streamUiTest.ExitCode -ne 0) { throw 'Host self-test failed.' }
foreach ($streamUiPort in @(5198, 5199)) {
    $streamUiProbe = New-Object System.Net.Sockets.TcpClient
    try { $streamUiProbe.Connect('127.0.0.1', $streamUiPort); throw "Test port $streamUiPort is already in use." }
    catch [System.Net.Sockets.SocketException] { }
    finally { $streamUiProbe.Dispose() }
}
$streamUiTestData = Join-Path $streamUiRoot ('.local\host-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $streamUiTestData -Force | Out-Null
# Isolated ports and disabled automatic bridge: tests never modify the running OBS host.
@{ audio = @{ enabled = $true; deviceId = 'default'; channel = -1; gain = 1 }; laplace = @{ enabled = $false; url = 'ws://localhost:9696'; token = ''; startLocalBridge = $false }; canvas = @{ width = 1920; height = 1080 }; layout = $null } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $streamUiTestData 'settings.json') -Encoding UTF8
$streamUiInstance = Start-Process -FilePath $streamUiHost -ArgumentList @('--headless', '--no-open', '--obs-port', '5198', '--config-port', '5199', '--data-dir', ('"' + $streamUiTestData + '"')) -WindowStyle Hidden -PassThru
try {
    & node (Join-Path $PSScriptRoot 'host-smoke.mjs') 'http://127.0.0.1:5198/' 'http://127.0.0.1:5199/' $streamUiTestData
    if ($LASTEXITCODE -ne 0) { throw 'Host HTTP / WebSocket integration failed.' }
    Invoke-WebRequest -Uri 'http://127.0.0.1:5199/api/shutdown' -Method Post -Headers @{ 'X-StreamUI-Request' = '1' } -UseBasicParsing | Out-Null
    if (-not $streamUiInstance.WaitForExit(10000)) { throw 'Host did not exit cleanly.' }
    $streamUiRestored = Start-Process -FilePath $streamUiHost -ArgumentList @('--headless', '--no-open', '--obs-port', '5198', '--config-port', '5199', '--data-dir', ('"' + $streamUiTestData + '"')) -WindowStyle Hidden -PassThru
    $streamUiInstance = $streamUiRestored
    $streamUiState = $null
    for ($streamUiAttempt = 0; $streamUiAttempt -lt 30; $streamUiAttempt++) {
        try { $streamUiState = Invoke-RestMethod -Uri 'http://127.0.0.1:5199/api/state'; break } catch { Start-Sleep -Milliseconds 200 }
    }
    if ($null -eq $streamUiState.config.layout -or $streamUiState.config.layout.order[0] -ne 'wordmark-blur-window') { throw 'Host did not restore the layout after restart.' }
    Write-Output 'Host restart restores the saved layout.'
} finally {
    if (-not $streamUiInstance.HasExited) {
        try { Invoke-WebRequest -Uri 'http://127.0.0.1:5199/api/shutdown' -Method Post -Headers @{ 'X-StreamUI-Request' = '1' } -UseBasicParsing | Out-Null } catch { }
        if (-not $streamUiInstance.WaitForExit(10000)) { Stop-Process -Id $streamUiInstance.Id -Force }
    }
}
