param(
  [string]$Dist = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
if (-not $Dist) { $Dist = Join-Path $repo 'dist' }

node (Join-Path $repo 'scripts/check-build-version.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release version metadata failed validation' }

$version = (Get-Content -LiteralPath (Join-Path $repo 'desktop/package.json') -Raw |
  ConvertFrom-Json).version
$names = @(
  "CodexInventory-Setup-$version-x64.exe",
  "CodexInventory-Portable-$version-x64.exe"
)
$manifestFile = Join-Path $Dist 'SHA256SUMS.txt'
$licenseFile = Join-Path $Dist 'THIRD_PARTY_REVIEW.json'
if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) {
  throw 'SHA256SUMS.txt missing; no build acceptance'
}
if (-not (Test-Path -LiteralPath $licenseFile -PathType Leaf)) {
  throw 'THIRD_PARTY_REVIEW.json missing; third-party license review still required'
}
$null = Get-Content -LiteralPath $licenseFile -Raw | ConvertFrom-Json

$lines = @(Get-Content -LiteralPath $manifestFile -Encoding UTF8 |
  Where-Object { $_.Length -gt 0 })
if ($lines.Count -ne 2) {
  throw 'SHA256SUMS.txt must have exactly two EXE checksums'
}

$seen = @{}
foreach ($line in $lines) {
  if ($line -cnotmatch '^([A-Fa-f0-9]{64})  (CodexInventory-(Setup|Portable)-[0-9A-Za-z.-]+-x64[.]exe)$') {
    throw 'Malformed SHA256SUMS.txt line'
  }
  $hash = $Matches[1].ToUpperInvariant()
  $name = $Matches[2]
  if ($names -cnotcontains $name -or $seen.ContainsKey($name)) {
    throw 'Unexpected or duplicate EXE in SHA256SUMS.txt'
  }
  $seen[$name] = $hash
}

$unexpected = @(Get-ChildItem -LiteralPath $Dist -Filter '*.exe' -File |
  Where-Object { $names -cnotcontains $_.Name })
if ($unexpected.Count -gt 0) {
  throw 'Unexpected old or foreign EXE in dist: remove it from the build output before acceptance'
}
foreach ($name in $names) {
  if (-not $seen.ContainsKey($name)) { throw 'Expected EXE missing from SHA256SUMS.txt' }
  $path = Join-Path $Dist $name
  $file = Get-Item -LiteralPath $path -ErrorAction Stop
  if ($file.Length -lt 1048576) { throw 'EXE unexpectedly small' }
  $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  if ($actual -ne $seen[$name]) { throw 'EXE checksum mismatch' }
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  Write-Host "ARTIFACT_OK: $name SHA256_MATCH signature=$($signature.Status)"
}
Write-Host 'LOCAL_BUILD_VERIFIED: 2 EXEs, manifest and inventory present. NOT PUBLICATION APPROVAL.'
