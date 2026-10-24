# Issue #18 — CONFIG_WARNING の機密情報を出さない切り分け（v0.7）

2026-10-24作成・更新。**診断追加の設計記録であり、実Codex接続の合格記録ではありません。** 固定警告分類は公式Codex `rust-v0.144.6` のソースを起点としており、`rust-v0.164.0` の最小接続部分も別途照合した。最新版の完全な互換性や警告の安全性を保証しない。

## 公式0.144.6との対応

公式 [initialize_processor.rs](https://github.com/openai/codex/blob/rust-v0.144.6/codex-rs/app-server/src/request_processors/initialize_processor.rs) は、サーバー起動時に集めた `ConfigWarningNotification` を初期接続に送信する。公式 [lib.rs](https://github.com/openai/codex/blob/rust-v0.144.6/codex-rs/app-server/src/lib.rs) には少なくとも次の警告発生経路がある。

| 固定分類コード | 一致条件 | 意味と次の確認 |
|---|---|---|
| `CONFIG_INVALID_DEFAULTS` | 既知の固定summaryに**完全一致** | 設定読込失敗。デフォルトへのフォールバックが起きた可能性。VM内でどの設定レイヤーが原因かを調査 |
| `CONFIG_SQLITE_RECOVERY` | 既知の固定summaryに**完全一致** | SQLite状態の修復/再構築通知。破損理由、状態保存先、再発をVM内で確認 |
| `CONFIG_EXEC_POLICY` | 既知の固定summaryに**完全一致** | 実行ポリシーの構文解析失敗。安全ルールが適用されていない可能性を解消するまで停止 |
| `CONFIG_UNTRUSTED_PROJECT` | 公式の固定接頭辞＋改行に一致 | 未信頼プロジェクトの設定・フック・実行ポリシーが無効化された状態。合成cwdと信頼境界を再確認 |
| `CONFIG_WARNING` | それ以外 | **未分類**。バージョン差や他のstartupWarningの可能性。無害とは扱わない |

いずれのコードでも `thread/list` へ進む前に**停止**する。既知の分類は警告内容の一部を同定するだけで、その状態が安全だと判定するものではない。

`summary` の全文、`details`、`path`、`range`、stderr、生JSON-RPC、実アカウント・スレッドIDは表示・記録・GitHubへ転記しない。分類は許可リストの固定テキストとの照合のみであり、パスや詳細を抽出・ハッシュ化もしない。

## 2026-10-24追記：0.164.0のREMOTE_CONTROL_STATUS分類

> 過去のリードオンリー試験結果：別端末、CLI 0.164.0、`PREPARED` / `READY` / `CLEANED` は成功。`READONLY_STOP: REMOTE_CONTROL_STATUS`（終了コード2）。既存スレッドや実推論に進まず停止。**通知の実際の状態は記録していないため、接続中だったとは断定しない。**

公式 [0.164.0 app-serverの初期化送信処理](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/lib.rs) は、初期化済み接続ごとに `RemoteControlStatusChanged` を送信する。型は [RemoteControlStatusChangedNotification](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-protocol/schema/typescript/v2/RemoteControlStatusChangedNotification.ts) に定義され、`status` に `disabled` / `connecting` / `connected` / `errored` を持つ。**初期化通知の受信だけでは、リモート操作が有効だった証拠にはならない。**

0.164.0向けの合成環境変数に、公式起動時の [remote control無効化マーカー](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-transport/src/transport/remote_control/mod.rs) を**この子プロセスにのみ**設定する（他のCodex・OS設定・ユーザーの永続設定は触らない）。診断は `status==='disabled'`、`environmentId===null` かつ識別子フィールドの型が正しい通知だけを許容し、識別子やサーバー名は出力しない。それ以外の状態、形式不正、別の警告は固定の `READONLY_STOP` コードで停止する。**「通知を全面無視」はしない。**

これは実Codexのリモート制御の状態を全般的に保証するものではない。ホスト権限・ネットワークアクセスはOSレベルで分離されておらず、v0.7の実ターン・承認・再接続は引き続き未検証。

合成試験（実Codexを起動しない）：
```powershell
git pull --ff-only origin codex/v07-config-warning-triage-20261024
git rev-parse --short HEAD
npm run check
node --test tests/v07-smoke-readonly.test.mjs tests/v07-smoke-environment.test.mjs
git diff --check origin/main...HEAD
node scripts/audit-v07-diff.mjs main
```

**0 FAILを確認してから**同一の `Prepare → Verify → 読取専用 → Cleanup` を一回だけ再実行する。結果は固定コード、`SMOKE_EXIT`、`CLEANED` のみ記録する。終了コード0以外は失敗であり、リリース受け入れゲートは通過しない。

## 2026-10-24追記：同一Windowsホストでの限定実行（ユーザー指定）

VMを用意できないため、今回は別端末のWindows上で**段階1：読取専用RPC**までの診断を認める。これは同一OSユーザーの実行であり**セキュリティ境界ではない**。環境変数からの既存プロファイル・認証・代理サーバー等の継承を減らす変更をしたが、OS API、同じユーザー権限、システム全体の設定、ネットワークへのアクセスまで防ぐものではない。Codex自身が一時DBや設定ファイルを生成することはあり得る。

今回禁止：`run.ps1`、`npm start`、通常のInventory/デスクトップ起動、既存セッション読込、ログイン、実ターン、チケット消費、承認許可、ファイル編集、外部公開。実推論/承認の追加検証は**本手順に含めない**。

### まず合成テスト（実Codexを起動しない）

```powershell
# 診断ブランチのリポジトリディレクトリで実行
git fetch origin
git switch codex/v07-config-warning-triage-20261024
git pull --ff-only origin codex/v07-config-warning-triage-20261024
git rev-parse --short HEAD
git status --short
npm run check
node --test tests/v07-smoke-readonly.test.mjs tests/v07-smoke-environment.test.mjs
npm test
git diff --check origin/main...HEAD
node scripts/audit-v07-diff.mjs main
```

合成テストが0 FAILで作業ツリーがクリーンであること。出力だけを共有してよい。実機接続結果として数えない。

### ホスト上の読取専用App Server段階1（合成テスト合格後のみ）

現在のPowerShellウィンドウを使用し、OSや既存Codexユーザープロファイルを変更しない。CLIを自動更新・ダウングレードしない。公式 `rust-v0.144.5` / `rust-v0.144.6` の初期化・警告処理は一致し、さらに [`rust-v0.164.0` の初期化](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/initialize_processor.rs)、[警告型](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-protocol/schema/typescript/v2/ConfigWarningNotification.ts)、`thread/list` 要求/応答型を照合した。**読取専用の段階1だけ** `0.144.5`、`0.144.6`、`0.164.0` を許可する。ただし `0.164.0` は内部のログイン・初期化処理等が変わっており、実ターン・承認・再接続・v0.7製品全体の動作までは未検証。`npm root --global` の全件検索では異なるアーキテクチャや依存パッケージの `codex.exe` が複数出るため、**Windows x64対応の公式ベンダー配置に一致する候補だけを一意選択**する。

```powershell
$globalRoot = npm root --global
$cliCandidates = @(Get-ChildItem -LiteralPath $globalRoot -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue)
# Windows x64版のネイティブ配置のみを対象にする（他のexeは実行しない）
$nativeCandidates = @($cliCandidates | Where-Object {
  $_.FullName -match '\\vendor\\x86_64-pc-windows-msvc\\bin\\codex\.exe$'
})
if ($nativeCandidates.Count -ne 1) {
  throw 'Windows x64 native Codex candidate is not unique; stop here.'
}
$smokeCli = $nativeCandidates[0].FullName
$smokeVersion = & $smokeCli --version
if ($smokeVersion -notin @('codex-cli 0.144.5','codex-cli 0.144.6','codex-cli 0.164.0')) {
  throw 'CLI version not audited for this read-only smoke; stop here.'
}

$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-inventory-v07-smoke-' + [Guid]::NewGuid().ToString('N'))
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v07-smoke-environment.ps1 -Action Prepare -Root $smokeRoot
if ($LASTEXITCODE -ne 0) { throw 'Prepare failed.' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v07-smoke-environment.ps1 -Action Verify -Root $smokeRoot
if ($LASTEXITCODE -ne 0) { throw 'Verify failed.' }

# 段階1だけ。ホストがオンラインの場合、同じユーザーの権限で
# ネットワークを利用する可能性がある。可能なら手動で一時的にオフラインにする。
node .\scripts\v07-smoke-readonly.mjs --root $smokeRoot --cli $smokeCli --approved-readonly-app-server

# 結果を記録し終えてから合成一時ルートだけ削除
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v07-smoke-environment.ps1 -Action Cleanup -Root $smokeRoot -ConfirmCleanup
```

スクリプトの`READONLY_OK`または`READONLY_STOP: 固定分類`のみ共有。内部パス、生ログ、stderrや警告本文を共有しない。上記以外のコマンドを手探りで追加実行せず、一度停止して原因を整理する。

**公開ゲート上の扱い：** 同一ホストの段階1が成功しても、OSレベルの隔離確認、実ターン・承認・復帰、Setup/Portableの別環境動作検証が未完了ならv0.7の配布可否はなお未決定。「VM検証済み」とは記載しない。

## Windows端末だけで先に実施できる確認（**実Codexを起動しない**）

```powershell
git fetch origin
git switch codex/v07-config-warning-triage-20261024
git pull --ff-only origin codex/v07-config-warning-triage-20261024
npm ci
npm run check
node --test tests/v07-smoke-readonly.test.mjs
npm test
git fetch origin main
git diff --check origin/main...HEAD
node scripts/audit-v07-diff.mjs main
```

実際に検証したSHA、NodeテストのPASS/FAIL/SKIP、差分監査のPASS/FAILだけを記録する。新しいコードはこの時点では未検証であるため、過去の`c523803`のPASSを流用しない。

## 推奨：使い捨てWindows VMでの実接続再試験

以前の同一ホスト上の一時`CODEX_HOME`は、OS全体・認証や設定レイヤーからの完全隔離を保証しない。**ホストの普段のCodex、実チャット、CLI状態を使って再実行しない。**

1. [既存の隔離手順](V07_SMOKE_ISOLATION.ja.md)に従って新しいVMを準備。ホストとの共有、同期、既存認証をなくし、対象CLI版を固定。
2. VM内でこの診断ブランチのコミットを取得してSHA照合。合成`codex-home`と作業フォルダをPrepare→Verifyし`READY`を確認。
3. VMのネットワークを遮断し、段階1の読取専用App Server接続だけを明示的に実行。成功なら`READONLY_OK`、警告が出れば`READONLY_STOP: CONFIG_...`の**コードのみ**記録。失敗したら進まず後片付け。
4. 分類結果によって、影響する隔離VM内の設定レイヤー・SQLite・exec policy・プロジェクト信頼設定を確認。原因が解決するまで警告を無視して進まない。Unknown時は実行対象CLI版・起動手順の公式ソースをさらに照合する。
5. 読取成功後も、推論・承認・ファイル操作・切断・再接続は別段階。費用・権限を含む各操作を個別に承認してから進む。

**現在の判定：NO-GO。** 別端末での読取専用接続が合格しても、実機隔離検証済みとは扱わない。`CONFIG_WARNING` の原因特定・実機の修正結果、実ターン/承認/再接続、EXEビルド/Windows VM受け入れは未完了。Draft PR・main不変更・GitHub Actions不実行を維持する。
