# v0.7.0-beta.1 Windows build — unpublished

**[日本語](V07_LOCAL_BUILD_READINESS.ja.md) | English**

Build and verify unsigned Setup and Portable candidates locally only. No release upload, GitHub Actions, merge, real Codex inference, or real approval tests are authorized. Work outside OneDrive and synced folders.

## 1. Fresh local clone

~~~powershell
$buildRoot = Join-Path $env:LOCALAPPDATA 'CodexInventoryV07Build'
if (Test-Path -LiteralPath $buildRoot) { throw 'Build folder already exists' }
git clone --branch codex/v07-local-build-readiness-20261024 --single-branch https://github.com/morio-23/codex-inventory.git $buildRoot
if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
Set-Location -LiteralPath $buildRoot
git rev-parse --short HEAD
git status --short
node .\scripts\check-build-version.mjs
if ($LASTEXITCODE -ne 0) { throw 'Version preflight failed' }
~~~

Expect BUILD_VERSION_OK: 0.7.0-beta.1 (Setup + Portable). Record the exact commit SHA.

## 2. Integrated local tests and build

~~~powershell
$env:CODEX_E2E_REAL='0'
$env:CODEX_E2E_APPROVAL='0'
$env:CODEX_E2E_WRITE='0'
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-release.ps1
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed' }
~~~

This runs locked npm installs, Playwright Chromium installation, syntax checks, synthetic Node/Playwright E2E, Windows Setup/Portable packaging, third-party inventory generation, SHA256 checks and an isolated **mock** Portable test. It does not run genuine Codex turns.

## 3. Validate the artifacts

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-build.ps1
if ($LASTEXITCODE -ne 0) { throw 'EXE verification failed' }
Get-ChildItem .\dist -Filter 'CodexInventory-*.exe' -File | Select-Object Name,Length
npm audit --omit=dev
Push-Location .\desktop
try { npm audit --omit=dev } finally { Pop-Location }
git status --short
~~~

Expected outputs: dist/CodexInventory-Setup-0.7.0-beta.1-x64.exe, dist/CodexInventory-Portable-0.7.0-beta.1-x64.exe, dist/SHA256SUMS.txt and dist/THIRD_PARTY_REVIEW.json.

LOCAL_BUILD_VERIFIED means both hash matches passed, not that EXEs are signed. Record Authenticode NotSigned without claiming otherwise. License inventories are not substitutes for a legal and bundled license review.

## 4. Remaining acceptance gates

Do not install Setup onto your everyday user profile solely for this check: install/uninstall may modify registry entries, shortcuts and settings. Genuine Codex turns, permission decisions, reconnect, notification-center observation and installer lifecycle tests remain separate and need their own approval and clean test state.

Share only candidate SHA, per-phase PASS/FAIL/SKIP, EXE filenames/sizes, manifest/signature statuses, and audit counts; keep private paths, logs and actual binaries out of Git and synced folders.

**Public release remains NO-GO after a successful local build.**
