param(
  [switch]$SkipExe,
  [switch]$SkipBrowserInstall,
  [switch]$SkipPortableSmoke,
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = $PSScriptRoot
Set-Location -LiteralPath $repo

if ($env:OS -ne 'Windows_NT') {
  throw 'This release verification script requires Windows.'
}
node (Join-Path $repo 'scripts/check-build-version.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release version preflight failed.' }

$results = [System.Collections.Generic.List[object]]::new()
$start = Get-Date
$buildSucceeded = $false

function Invoke-Phase([string]$Name, [scriptblock]$Block) {
  Write-Host ('==> ' + $Name) -ForegroundColor Cyan
  try {
    & $Block
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE"
    }
    $null = $results.Add([pscustomobject]@{
      Phase = $Name
      Result = 'PASS'
      Detail = ''
    })
  } catch {
    $null = $results.Add([pscustomobject]@{
      Phase = $Name
      Result = 'FAIL'
      Detail = $_.Exception.Message
    })
    throw
  }
}

try {
  Invoke-Phase 'npm ci' { npm ci }
  if (-not $SkipBrowserInstall) {
    Invoke-Phase 'Playwright Chromium install' { npx playwright install chromium }
  }
  Invoke-Phase 'Syntax and validation checks' { npm run check }
  Invoke-Phase 'Node tests' { npm test }
  Invoke-Phase 'Playwright browser E2E' { npm run test:e2e }

  if (-not $SkipExe) {
    Invoke-Phase 'Windows Setup + Portable EXE' {
      & (Join-Path $repo 'build-windows.ps1') -SkipTests -RequireSigned:$RequireSigned
      if (-not $?) { throw 'Windows EXE build script failed.' }
    }
    $buildSucceeded = $true
    if (-not $SkipPortableSmoke) {
      Invoke-Phase 'Isolated mock Portable EXE smoke' {
        $version=(Get-Content -LiteralPath (Join-Path $repo 'desktop/package.json') -Raw | ConvertFrom-Json).version
        $portable=Join-Path $repo ("dist/CodexInventory-Portable-$version-x64.exe")
        & (Join-Path $repo 'smoke-portable-isolated.ps1') -PortableExe $portable
        if (-not $?) { throw 'Isolated smoke test failed.' }
      }
    } else {
      $null=$results.Add([pscustomobject]@{Phase='Isolated mock Portable EXE smoke';Result='SKIP';Detail='-SkipPortableSmoke requested'})
    }
  } else {
    $null = $results.Add([pscustomobject]@{
      Phase = 'Windows EXE'
      Result = 'SKIP'
      Detail = '-SkipExe requested'
    })
  }
} finally {
  Set-Location -LiteralPath $repo
  Write-Host ([Environment]::NewLine + '=== Codex Inventory integrated verification ===')
  $results | Format-Table -AutoSize
  Write-Host ('Elapsed: ' + [math]::Round(((Get-Date) - $start).TotalMinutes, 1) + ' minutes')

  if ($buildSucceeded -and (Test-Path -LiteralPath 'dist\SHA256SUMS.txt')) {
    Write-Host 'EXE checksums from this successful build:'
    Get-Content -LiteralPath 'dist\SHA256SUMS.txt'
  } elseif (Test-Path -LiteralPath 'dist\SHA256SUMS.txt') {
    Write-Host 'Note: dist/SHA256SUMS.txt is from an earlier build. No EXE was built by this run.'
  }
  Write-Host 'Only mock reset tickets are used in automated tests.'
}
