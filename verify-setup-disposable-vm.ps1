param(
  [Parameter(Mandatory=$true)][string]$SetupExe,
  [switch]$DisposableVmConfirmed
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Setup test requires Windows.' }
if (!$DisposableVmConfirmed -or $env:CODEX_INVENTORY_DISPOSABLE_VM -ne 'YES') {
  throw 'Only run in a disposable Windows VM/Sandbox. Set CODEX_INVENTORY_DISPOSABLE_VM=YES and pass -DisposableVmConfirmed.'
}
$exe=(Resolve-Path -LiteralPath $SetupExe).ProviderPath
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) ('inventory-setup-' + [guid]::NewGuid().ToString('N'))
$installDir=Join-Path $tempRoot 'install'
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
if ($installDir -match '\s') { throw 'NSIS /D cannot safely be passed an install directory containing whitespace.' }
function Invoke-Installer([string]$program,[string]$arguments,[string]$step) {
  $process=$null
  try {
    $info=New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName=$program
    $info.Arguments=$arguments
    $info.UseShellExecute=$false
    $process=[Diagnostics.Process]::Start($info)
    if (!$process.WaitForExit(120000)) {
      $process.Kill()
      throw "$step timed out"
    }
    if ($process.ExitCode -ne 0) { throw "$step failed with exit code $($process.ExitCode)" }
  } finally {
    if ($null -ne $process) { $process.Dispose() }
  }
}
try {
  # NSIS /D must be last and unquoted. Run inside a disposable VM only:
  # the installer may still update HKCU and Windows uninstall registrations.
  Invoke-Installer $exe ("/S /D=$installDir") 'Setup install'
  $app=Get-ChildItem -LiteralPath $installDir -Filter '*.exe' -File |
    Where-Object { $_.Name -notmatch '^Uninstall' } | Select-Object -First 1
  if ($null -eq $app) { throw 'Installed application EXE not found.' }
  $uninstall=Get-ChildItem -LiteralPath $installDir -Filter 'Uninstall*.exe' -File |
    Select-Object -First 1
  if ($null -eq $uninstall) { throw 'NSIS uninstaller not found.' }
  Invoke-Installer $uninstall.FullName '/S' 'Setup uninstall'
  if (Test-Path -LiteralPath $app.FullName) {
    throw 'Installed application EXE remains after uninstall.'
  }
  Write-Host 'PASS: Setup installed and uninstalled in a disposable VM.' -ForegroundColor Green
} finally {
  try { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction Stop }
  catch { Write-Warning ('Manual cleanup in disposable VM: ' + $tempRoot) }
}
