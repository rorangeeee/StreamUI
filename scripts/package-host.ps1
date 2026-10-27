$ErrorActionPreference = 'Stop'
$streamUiRoot = Split-Path -Parent $PSScriptRoot
$streamUiOutput = Join-Path $streamUiRoot '.local\host-package'
$streamUiExecutable = Join-Path $streamUiRoot 'StreamUI Host.exe'
foreach ($streamUiProcess in @(Get-Process -Name 'StreamUI Host' -ErrorAction SilentlyContinue)) {
    if ($streamUiProcess.Path -eq $streamUiExecutable) { throw 'Exit StreamUI Host from the tray before rebuilding its EXE.' }
}
& dotnet publish (Join-Path $streamUiRoot 'host\StreamUI.Host.csproj') -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
    -p:PublishReadyToRun=false -p:PublishTrimmed=false -p:NuGetAudit=false `
    --configfile (Join-Path $streamUiRoot 'host\NuGet.Package.Config') --packages (Join-Path $streamUiRoot '.local\nuget-packages') -o $streamUiOutput
if ($LASTEXITCODE -ne 0) { throw 'Host packaging failed.' }
Copy-Item -LiteralPath (Join-Path $streamUiOutput 'StreamUI.Host.exe') -Destination $streamUiExecutable -Force
Write-Output ('Ready: ' + $streamUiExecutable)
