param(
  [switch]$SkipTests,
  [switch]$PortableOnly,
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
Set-Location $repo
# Windows PowerShell 5.1 does not expose PowerShell 7-only OS flags.
if ($env:OS -ne 'Windows_NT') {
  throw 'Windows向けEXEビルドはWindows環境で実行してください。'
}
if (-not $SkipTests) {
  Write-Host '[1/4] Node tests'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  npm run check
  if ($LASTEXITCODE -ne 0) { throw 'syntax check failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'unit tests failed' }
  npm run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'browser E2E failed' }
}
Set-Location (Join-Path $repo 'desktop')
Write-Host '[2/4] Desktop dependencies'
if (Test-Path 'package-lock.json') {
  npm ci
} else {
  Write-Warning 'desktop/package-lock.json not found. Run npm install and commit the generated lock before distributing.'
  npm install
}
if ($LASTEXITCODE -ne 0) { throw 'Desktop npm install failed' }
$buildStartedAt=(Get-Date).ToUniversalTime()
Write-Host '[3/4] Build Windows EXE'
if ($PortableOnly) {
  npx electron-builder --win portable --x64
} else {
  npm run dist:win
}
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }
Write-Host '[4/4] Dependency license inventory and SHA-256 manifest'
Set-Location $repo
node (Join-Path $repo 'third-party-inventory.mjs') (Join-Path $repo 'dist/THIRD_PARTY_REVIEW.json')
if ($LASTEXITCODE -ne 0) { throw 'Dependency license inventory generation failed' }
$version=(Get-Content -LiteralPath (Join-Path $repo 'desktop/package.json') -Raw | ConvertFrom-Json).version
$expected=@("CodexInventory-Portable-$version-x64.exe")
if (-not $PortableOnly) { $expected+=("CodexInventory-Setup-$version-x64.exe") }
$artifacts=@($expected | ForEach-Object {
  $item=Get-Item -LiteralPath (Join-Path $repo ('dist/' + $_)) -ErrorAction Stop
  if ($item.LastWriteTimeUtc -lt $buildStartedAt.AddSeconds(-5)) {
    throw ('EXE is stale (not produced by this build): ' + $item.Name)
  }
  $item
})
$signatures=$artifacts | ForEach-Object {
  $signature=Get-AuthenticodeSignature -LiteralPath $_.FullName
  $signer='(none)'
  if ($null -ne $signature.SignerCertificate) { $signer=$signature.SignerCertificate.Subject }
  [pscustomobject]@{File=$_.Name;Status=[string]$signature.Status;Signer=$signer}
}
$signatures | Format-Table -AutoSize
if ($RequireSigned -and ($signatures | Where-Object { $_.Status -ne 'Valid' })) {
  throw 'One or more EXE artifacts do not have a valid Authenticode signature. Do not publish as signed.'
}
$manifest = $artifacts | Get-FileHash -Algorithm SHA256 | Select-Object Hash, Path
$manifest | Format-Table -AutoSize
$manifest | ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } |
  Set-Content -Path 'dist/SHA256SUMS.txt' -Encoding utf8
Write-Host "Built $($artifacts.Count) EXE file(s) in dist"
