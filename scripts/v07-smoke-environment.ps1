param(
  [Parameter(Mandatory=$true)][ValidateSet('Prepare','Verify','Cleanup')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Root,
  [switch]$ConfirmCleanup
)

$ErrorActionPreference = 'Stop'
$markerName = '.inventory-v07-smoke-marker'
$markerText = 'codex-inventory-v07-smoke-v1'
$configText = '# Disposable synthetic profile; no credentials, providers, plugins or project paths.'

function Assert-NoReparseTree([string]$Target) {
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push($Target)
  while ($pending.Count -gt 0) {
    $entry = Get-Item -LiteralPath $pending.Pop() -Force -ErrorAction Stop
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'REPARSE_POINT'
    }
    if ($entry.PSIsContainer) {
      foreach ($child in (Get-ChildItem -LiteralPath $entry.FullName -Force -ErrorAction Stop)) {
        $pending.Push($child.FullName)
      }
    }
  }
}

try {
  if (-not [IO.Path]::IsPathRooted($Root)) { throw 'RELATIVE_PATH' }
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
  $target = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  $parent = [IO.Path]::GetDirectoryName($target)
  $name = [IO.Path]::GetFileName($target)
  if (-not [string]::Equals($parent,$temp,[StringComparison]::OrdinalIgnoreCase) -or
      $name -cnotmatch '^codex-inventory-v07-smoke-[0-9a-f]{32}$') {
    throw 'OUTSIDE_DISPOSABLE_TEMP'
  }
  $tempInfo = Get-Item -LiteralPath $temp -Force -ErrorAction Stop
  if (($tempInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'TEMP_REPARSE_POINT'
  }

  $marker = Join-Path $target $markerName
  if ($Action -eq 'Prepare') {
    if (Test-Path -LiteralPath $target) { throw 'ALREADY_EXISTS' }
    [void][IO.Directory]::CreateDirectory($target)
    [IO.File]::WriteAllText($marker,$markerText,[Text.Encoding]::ASCII)
    foreach ($folder in @('codex-home','codex-sqlite','workspace-a','workspace-b','electron-user-data',
      'profile','profile\AppData','profile\AppData\Roaming','profile\AppData\Local',
      'profile\ProgramData','profile\Temp')) {
      [void][IO.Directory]::CreateDirectory((Join-Path $target $folder))
    }
    [IO.File]::WriteAllText((Join-Path $target 'codex-home\config.toml'),$configText,[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $target 'workspace-a\README.txt'),'Synthetic workspace A.',[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $target 'workspace-b\README.txt'),'Synthetic workspace B.',[Text.Encoding]::ASCII)
    Write-Output 'PREPARED: synthetic directories only; Codex was not started.'
    exit 0
  }

  if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'MISSING_ROOT' }
  $rootInfo = Get-Item -LiteralPath $target -Force -ErrorAction Stop
  if (($rootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      -not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'INVALID_MARKER' }
  $markerInfo = Get-Item -LiteralPath $marker -Force -ErrorAction Stop
  if (($markerInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      [IO.File]::ReadAllText($marker,[Text.Encoding]::ASCII) -cne $markerText) {
    throw 'INVALID_MARKER'
  }
  Assert-NoReparseTree $target

  if ($Action -eq 'Verify') {
    $expected = @{
      'codex-home'='Directory'; 'codex-sqlite'='Directory';
      'workspace-a'='Directory'; 'workspace-b'='Directory';
      'electron-user-data'='Directory';
      'profile'='Directory'; 'profile\AppData'='Directory';
      'profile\AppData\Roaming'='Directory'; 'profile\AppData\Local'='Directory';
      'profile\ProgramData'='Directory'; 'profile\Temp'='Directory';
      'codex-home\config.toml'='File';
      'workspace-a\README.txt'='File'; 'workspace-b\README.txt'='File';
      '.inventory-v07-smoke-marker'='File'
    }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($target)
    $seen = @{}
    while ($pending.Count -gt 0) {
      $directory = $pending.Pop()
      foreach ($entry in (Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
        $relative = $entry.FullName.Substring($target.Length+1)
        $kind = if ($entry.PSIsContainer) { 'Directory' } else { 'File' }
        if (-not $expected.ContainsKey($relative) -or $expected[$relative] -ne $kind) {
          throw 'UNEXPECTED_STATE'
        }
        $seen[$relative] = $true
        if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
      }
    }
    if ($seen.Count -ne $expected.Count -or
        [IO.File]::ReadAllText((Join-Path $target 'codex-home\config.toml'),[Text.Encoding]::ASCII) -cne $configText) {
      throw 'INCOMPLETE_STATE'
    }
    Write-Output 'READY: fresh synthetic state only; no stored auth or sessions.'
    exit 0
  }

  if (-not $ConfirmCleanup) { throw 'CONFIRM_CLEANUP_REQUIRED' }
  # The final absolute target is a marked, direct child of the OS temp directory.
  # Every existing entry was checked for reparse points before recursive removal.
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
  Write-Output 'CLEANED: marked disposable smoke root removed.'
  exit 0
} catch {
  [Console]::Error.WriteLine('FAIL: smoke environment guard rejected the target or state.')
  exit 2
}
