param(
  [Parameter(Mandatory=$true)][string]$PortableExe,
  [int]$TimeoutSeconds = 45
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Portable smoke requires Windows.' }
if ($TimeoutSeconds -lt 10 -or $TimeoutSeconds -gt 120) { throw 'TimeoutSeconds must be 10..120.' }
$repo = $PSScriptRoot
$exe = (Resolve-Path -LiteralPath $PortableExe -ErrorAction Stop).ProviderPath
$node = (Get-Command node.exe -ErrorAction Stop).Source
$fixture = Join-Path $repo 'tests\fixtures\mock-app-server.mjs'
if (!(Test-Path -LiteralPath $fixture)) { throw 'Mock App Server fixture missing.' }
$originalSettings = Join-Path $env:APPDATA 'codex-inventory-desktop\settings.json'

function Get-Snapshot([string]$path) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { return 'ABSENT' }
  $entry = Get-Item -LiteralPath $path
  return ('PRESENT:' + $entry.Length + ':' + $entry.LastWriteTimeUtc.Ticks + ':' +
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)
}
$before = Get-Snapshot $originalSettings
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('inventory-smoke-' + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $tempRoot 'bin'
$profile = Join-Path $tempRoot 'profile'
$smokeHome = Join-Path $tempRoot 'home'
$roaming = Join-Path $smokeHome 'AppData\Roaming'
$local = Join-Path $smokeHome 'AppData\Local'
$child = $null
$result = 'FAILED'
try {
  foreach($folder in @($tempRoot,$bin,$profile,$smokeHome,$roaming,$local)) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
  }
  $mockCmd = Join-Path $bin 'codex.cmd'
  $batch = @(
    '@echo off',
    'if /i "%~1"=="--version" (',
    '  echo codex-cli 0.999.0',
    '  exit /b 0',
    ')',
    'if /i "%~1"=="app-server" (',
    '  "%INVENTORY_SMOKE_NODE%" "%INVENTORY_SMOKE_FIXTURE%"',
    '  exit /b %ERRORLEVEL%',
    ')',
    'exit /b 9'
  ) -join [Environment]::NewLine
  Set-Content -LiteralPath $mockCmd -Value $batch -Encoding ASCII

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = '--inventory-isolated-smoke --user-data-dir="' + $profile + '"'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $false
  # Values affect ONLY the child, not the existing Codex login/settings.
  $psi.EnvironmentVariables['TEMP'] = $tempRoot
  $psi.EnvironmentVariables['TMP'] = $tempRoot
  $psi.EnvironmentVariables['USERPROFILE'] = $smokeHome
  $psi.EnvironmentVariables['HOME'] = $smokeHome
  $psi.EnvironmentVariables['APPDATA'] = $roaming
  $psi.EnvironmentVariables['LOCALAPPDATA'] = $local
  $psi.EnvironmentVariables['CODEX_HOME'] = (Join-Path $smokeHome '.codex')
  $psi.EnvironmentVariables['CODEX_BIN'] = $mockCmd
  $psi.EnvironmentVariables['CODEX_INVENTORY_SMOKE_PROFILE'] = $profile
  $psi.EnvironmentVariables['MOCK_RESET_CREDITS'] = '1'
  $psi.EnvironmentVariables['INVENTORY_SMOKE_NODE'] = $node
  $psi.EnvironmentVariables['INVENTORY_SMOKE_FIXTURE'] = $fixture
  $psi.EnvironmentVariables['Path'] = $bin + [IO.Path]::PathSeparator + $env:Path
  $child = [System.Diagnostics.Process]::Start($psi)
  if ($null -eq $child) { throw 'Portable process failed to start.' }
  $ready = $false
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 600
    $child.Refresh()
    # NSIS Portable launchers may exit after starting Electron; rely on the
    # isolated mock settings and HTTP readiness rather than wrapper lifetime.
    $settingsPath = Join-Path $profile 'settings.json'
    if (!(Test-Path -LiteralPath $settingsPath)) { continue }
    try {
      $state = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $port = [int]$state.httpPort
      if ($port -lt 1 -or $port -gt 65535) { continue }
      $status = Invoke-RestMethod -Uri ("http://127.0.0.1:$port/api/status") -Method Get -TimeoutSec 2
      if ($status.connected -eq $true) {
        if ($state.codexPath -ne $mockCmd) {
          throw 'Smoke connected to a CLI other than the isolated mock.'
        }
        $ready = $true
        break
      }
    } catch {
      if ($_.Exception.Message -like '*other than the isolated mock*') { throw }
    }
  }
  if (!$ready) { throw 'Mock App Server did not report ready within the timeout.' }
  # API readiness alone did not catch the real-world empty Electron window.
  # The packaged main process now validates DOM, CSS and the framebuffer.
  $uiMarker=Join-Path $profile 'ui-smoke-ready.json'
  $uiReady=$false
  $uiDeadline=(Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $uiDeadline) {
    if (Test-Path -LiteralPath $uiMarker -PathType Leaf) {
      try {
        $uiCheck=Get-Content -LiteralPath $uiMarker -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($uiCheck.status -eq 'UI_FAIL') {
          throw ('Packaged renderer failed: ' + [string]$uiCheck.code)
        }
        if ($uiCheck.status -eq 'UI_READY' -and $uiCheck.painted -eq $true) {
          $uiReady=$true
          break
        }
      } catch {
        if ($_.Exception.Message -like 'Packaged renderer failed*') { throw }
      }
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$uiReady) { throw 'Packaged GUI did not render a nonblank document.' }
  $result = 'PASS: Portable EXE used an isolated profile, mock App Server and rendered GUI.'
} finally {
  # The portable launcher can detach its Electron child. Only target
  # processes carrying the unique, randomized smoke profile in their command
  # line; never terminate an existing user's Inventory instance.
  $smokeProcesses=@()
  try {
    $smokeProcesses=@(Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--inventory-isolated-smoke') -and
        $_.CommandLine.Contains($profile) })
  } catch { Write-Warning ('Could not enumerate isolated smoke processes: ' + $_.Exception.Message) }
  foreach($smokeProcess in $smokeProcesses) {
    try { & taskkill.exe /PID $smokeProcess.ProcessId /T /F *> $null }
    catch {
      if (Get-Process -Id $smokeProcess.ProcessId -ErrorAction SilentlyContinue) {
        Write-Warning ('Could not terminate isolated smoke process: ' + $smokeProcess.ProcessId)
      }
    }
  }
  if ($null -ne $child) {
    try {
      if (!$child.HasExited) {
        & taskkill.exe /PID $child.Id /T /F *> $null
        if ($LASTEXITCODE -ne 0) { $child.Kill() }
      }
      $child.WaitForExit(8000) | Out-Null
    } catch { Write-Warning ('Unable to stop child: ' + $_.Exception.Message) }
    $child.Dispose()
  }
  $after = Get-Snapshot $originalSettings
  try { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction Stop }
  catch { Write-Warning ('Temporary smoke data requires cleanup: ' + $tempRoot) }
  if ($before -ne $after) {
    throw ('CRITICAL: Existing settings.json was changed by smoke. Inspect ' + $originalSettings + '; do not overwrite it automatically.')
  }
  $remaining=@(Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--inventory-isolated-smoke') -and
      $_.CommandLine.Contains($profile) })
  if ($remaining.Count -ne 0) { throw 'Isolated smoke left an Electron process running.' }
}
Write-Host $result -ForegroundColor Green
# A raced taskkill may leave a native nonzero exit code even when the
# disposable child has already exited. The caller checks LASTEXITCODE.
$global:LASTEXITCODE=0
