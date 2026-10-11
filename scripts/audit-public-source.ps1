# Checks public-source readiness locally without invoking GitHub Actions.
# Requires Git on PATH. Run from any worktree for the repository.
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=(& git rev-parse --show-toplevel)
if($LASTEXITCODE -ne 0 -or !$root){throw 'Not inside a Git worktree.'}
Push-Location -LiteralPath $root
try {
  Write-Host '== Public source audit (no hosted CI, no API calls) ==' -ForegroundColor Cyan
  $tracked=@(& git ls-files)
  if($LASTEXITCODE -ne 0){throw 'git ls-files failed'}
  $forbidden=@($tracked | Where-Object {
    $_ -match '(?i)(^|/)(release-evidence|\.codex|node_modules|test-results|playwright-report|dist)(/|$)' -or
    $_ -match '(?i)\.(exe|msi|pfx|p12|pem|key)$'
  })
  if($forbidden.Count){
    Write-Warning ('Found tracked local/binary artifacts: '+($forbidden -join ', '))
  } else {Write-Host 'PASS: No release evidence or executable/signing files in current tracked tree.' -ForegroundColor Green}

  $patterns=@(
    'sk-[A-Za-z0-9_-]{20,}',
    'ghp_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'AKIA[0-9A-Z]{16}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  )
  $found=@()
  $refs=@('--all')
  foreach($pattern in $patterns){
    # -l reports filename only; never print secret values.
    $matches=@(& git grep -l -I -E -e $pattern HEAD -- .)
    if($LASTEXITCODE -gt 1){throw 'git grep failed'}
    foreach($path in $matches){$found+=@{kind='tracked-tree';location=$path}}
    # Commit hashes only. This also checks deleted text introduced in old commits.
    $commits=@(& git log @refs --format=%h -G $pattern -- .)
    if($LASTEXITCODE -ne 0){throw 'git log history scan failed'}
    foreach($sha in $commits){if($sha){$found+=@{kind='history';location=$sha}}}
  }
  $unique=@($found | ForEach-Object {"$($_.kind):$($_.location)"} | Sort-Object -Unique)
  if($unique.Count){
    Write-Warning 'Potential credential patterns were found; review privately before publicizing:'
    $unique | ForEach-Object {Write-Warning $_}
  }else{Write-Host 'PASS: No known credential signatures in the scanned tracked text/history.' -ForegroundColor Green}

  $historicalEvidence=@(& git log @refs --name-only --pretty=format: -- 'release-evidence/**' '*.png' '*.jpg' '*.jpeg')
  if($LASTEXITCODE -ne 0){throw 'Image history scan failed'}
  $historicalEvidence=@($historicalEvidence | Where-Object {$_} | Sort-Object -Unique)
  if($historicalEvidence.Count){
    Write-Warning ('Manual image/history review required: '+$historicalEvidence.Count+' paths, including older commits.')
    Write-Host 'Source removal/ignore rules do NOT purge Git history or already shared PR attachments.' -ForegroundColor Yellow
  }
  if($unique.Count -or $forbidden.Count){throw 'Source audit blocked. Inspect findings privately, and do not publish yet.'}
  Write-Host 'Text pattern checks passed. Manual inspection of historical images and GitHub issue/PR attachments is still required.' -ForegroundColor Yellow
} finally {Pop-Location}
