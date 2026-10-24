# v0.7.0-beta.1 Windowsローカルビルド（未公開）

**日本語 | [English](V07_LOCAL_BUILD_READINESS.md)**

本手順は候補EXEの生成と検査のみを行う。mainへのマージ、GitHub Actions、Release公開、実Codex推論・承認は行わない。可能ならOneDrive外の新しいローカルフォルダーで実施する。

## 1. 検証専用クローン

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

期待値：BUILD_VERSION_OK: 0.7.0-beta.1 (Setup + Portable)。検証したコミットSHAも記録する。

## 2. 一括テスト・ビルド

~~~powershell
$env:CODEX_E2E_REAL='0'
$env:CODEX_E2E_APPROVAL='0'
$env:CODEX_E2E_WRITE='0'
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-release.ps1
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed' }
~~~

内部で npm ci、Playwright Chromium導入、構文、Node/ブラウザの合成E2E、electron-builderによるSetup/Portable生成、依存ライセンス一覧、SHA256検証、モックPortable起動を実施する。実Codexの利用枠や実承認は使わない。Electronダウンロードなどはネットワークを利用する。

## 3. 配布候補の検査

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-local-build.ps1
if ($LASTEXITCODE -ne 0) { throw 'EXE verification failed' }
Get-ChildItem .\dist -Filter 'CodexInventory-*.exe' -File | Select-Object Name,Length
npm audit --omit=dev
Push-Location .\desktop
try { npm audit --omit=dev } finally { Pop-Location }
git status --short
~~~

生成対象：
- dist/CodexInventory-Setup-0.7.0-beta.1-x64.exe
- dist/CodexInventory-Portable-0.7.0-beta.1-x64.exe
- dist/SHA256SUMS.txt
- dist/THIRD_PARTY_REVIEW.json

LOCAL_BUILD_VERIFIED: 2 EXEs はファイル名・ハッシュ検証の成功のみを意味する。署名の NotSigned はそのまま記録し、署名済みと宣伝しない。ライセンス台帳は実際の同梱ライセンスや法的確認の代わりにはならない。

## 4. 残っている受け入れ

Setupを普段のWindowsユーザーにインストールするとレジストリやショートカットなどが変更される可能性があるので、今回はインストールしない。実ターン・承認・中断・復帰、通知の目視、Setup導入とアンインストールは別の試験として維持する。

共有するのはコミットSHA、フェーズのPASS/FAIL/SKIP、EXEの名前とサイズ、ハッシュ/署名状態、npm audit結果の件数のみ。ローカルパス、個人情報、秘密情報、生成EXEそのものを公開PRや同期フォルダーにアップロードしない。

**EXEが生成されてもv0.7公開はNO-GOのまま。**
