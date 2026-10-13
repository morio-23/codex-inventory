# v0.7 実App Server Smoke Testの隔離準備

準備日: 2026-10-13。起点: `codex/v07-protocol-compat` の `c515e6a`。[プロトコル事前調査](V07_PROTOCOL_COMPATIBILITY.ja.md)参照。2026-10-14に承認済みの段階1だけをホスト上の一時状態で試し、後述の `CONFIG_WARNING` で停止した。段階1は**未合格**。実ターン、実承認、既存スレッド操作は行っていない。

### 段階1の実施結果（2026-10-14）

- Windows 11 Homeの同一ホスト上で行う一時状態方式について、ユーザーの了承を得た。別OSのVMと同等の隔離ではなく、ホストのプロファイルやシステム設定へのアクセスがないことまでは証明できない。この方式を推奨の隔離OS手順と混同しない。
- 独立した `codex.exe` の数値版 `0.144.6` を確認した。最初の呼び出しはPowerShell変数の未設定で `CLI_PATH_REJECTED` となり、App Server起動前に停止した。引数不足を `MISSING_ARGUMENT` と分類する修正を追加した。
- 新規の合成状態を作成・検証して読取専用クライアントを実行した。初回は `UNEXPECTED_EVENT`、イベントの固定分類を追加した再実行では `CONFIG_WARNING` で停止した。[公式0.144.6の初期化実装](https://github.com/openai/codex/blob/rust-v0.144.6/codex-rs/app-server/src/request_processors/initialize_processor.rs)は `configWarning` を送信し得るが、今回の警告の原因・内容は未確認。生RPC、警告本文、ID、パス、stderrは記録していない。両回とも合成状態を削除した。
- `thread/list` の空状態、認証設定を読み込まなかったこと、警告の安全性は確認できていない。段階2以降は未実施。警告を無視して自動再試行しない。

## 既存起動経路の確認と隔離境界

- `run.ps1` の通常モードと `npm start` は `server.mjs` を経由して `codex app-server` を起動する。`run.ps1` は固定ワークスペースの実パスも表示する。準備・読取専用検証には使用しない。`-Demo` はモック専用で、実互換性は確認できない。
- Desktopの `desktop/main.cjs` はCLI検出後にApp Serverを起動し、`account/read` も呼ぶ。既存の `--inventory-isolated-smoke` / `CODEX_INVENTORY_SMOKE_PROFILE` はElectronの `userData` だけを一時化する。**Codexの `CODEX_HOME`、認証、履歴、CLI検出先、作業ディレクトリまでは隔離しない。** 実接続の入口にDesktopを使わない。
- `app-server-client.mjs` は子プロセスへ環境変数を渡す。`server.mjs` の埋め込み起動も既定では `process.env` とユーザーホームのcwdを使う。キー・プロキシ・Codex状態の環境変数を持つホストシェルから直接起動しない。
- 公式Codexの設定は `CODEX_HOME/config.toml` のほか、システム設定とcwd・親ディレクトリ・リポジトリ設定のレイヤーを読み得る。[公式設定ローダー](https://github.com/openai/codex/blob/main/codex-rs/config/src/loader/mod.rs)参照。**空の `CODEX_HOME` だけでは完全隔離を証明できない。** 実接続には、ホストのユーザープロファイルと共有フォルダーを持たない使い捨てWindows VMまたはWindows Sandboxを使う。両方とも用意できない場合は準備で停止する。

### Windows 11 Homeでの手作業ルート

Windows SandboxはWindows Homeでサポートされない。[Microsoftの対応エディション表](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-sandbox/windows-sandbox-overview)を参照。HomeではSandboxの有効化を試みず、次の順に**新規の使い捨てWindows VM**を用意する。既存VMやホスト上のCodex状態は使わない。

1. [Oracle VirtualBoxの公式配布ページ](https://www.virtualbox.org/wiki/Downloads)など、正規の仮想化ソフトを使用する。Windows 11のインストール媒体は[Microsoftの公式ページ](https://www.microsoft.com/software-download/windows11)から取得し、利用条件を確認する。VMの作成前に、ホスト側の空き容量、仮想化支援、ゲストOSの要件を確認する。Windows 11ゲストには少なくとも2仮想CPU、4 GB RAM、64 GBディスクと適切な仮想TPM・Secure Boot設定が必要。[MicrosoftのVM要件](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements)参照。
2. 新しいVMを作り、**共有フォルダーなし、共有クリップボード無効、ドラッグ&ドロップ無効、USBパススルーなし**にする。Guest Additionsで共有を有効にしない。新規のテスト用OSユーザーを使い、ホストのMicrosoftアカウント、Codex認証、ブラウザープロファイル、クラウド同期を持ち込まない。Windowsセットアップが実アカウントの入力を要求する場合は停止する。仮想化ソフトの既定NATはホストへ通信できる場合があるので、必要な公開ツールを隔離OS内で取得した後、**段階1の前にVMのネットワークアダプターを無効化**する。[VirtualBoxのネットワーク説明](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/networkingdetails.html)参照。
3. VM内で公式配布のGit、Node.js、対象Codex CLIを用意する。公開リポジトリの `codex/v07-smoke-isolation` をVM内へ直接取得し、期待したコミットを確認する。ホストのフォルダーやCLI実行ファイルを共有・コピーしない。CLIを `0.144.6` に固定し、異なる版なら[互換性調査](V07_PROTOCOL_COMPATIBILITY.ja.md)を再評価するまで停止する。
4. VM内のPowerShellで、下記「段階0」の `Prepare` と `Verify` を行う。`READY` を確認したらVMのネットワークが無効であることを確認し、下記「段階1」の**承認済み読取専用**コマンドだけを実行する。`initialize` / `initialized` と空の `thread/list` 以外へ進まない。固定の結果分類だけ記録し、生RPC、パス、ID、stderrをホストや公開リポジトリへ転送しない。
5. `Cleanup` が対象の合成一時ルートだけを削除することを確認して実行し、VMを停止する。必要な結果分類を控えた後、対象VMと仮想ディスクを仮想化ソフトから削除する。別VMやホストのファイルは削除しない。

手順3のVM内PowerShell例。GitとNode.jsはそれぞれ公式配布物をVM内へインストールしてから実行する。`codex.exe` が一意に見つからない、版が一致しない、または検査が失敗したら段階1へ進まない。インストール出力は公開しない。

```powershell
git clone --single-branch --branch codex/v07-smoke-isolation https://github.com/morio-23/codex-inventory.git codex-inventory-smoke
Set-Location .\codex-inventory-smoke
git merge-base --is-ancestor d5422ae HEAD
if ($LASTEXITCODE -ne 0) { throw 'Smoke source is not based on the prepared revision.' }
npm install --global @openai/codex@0.144.6
$globalNpmRoot = npm root --global
$cliCandidates = @(Get-ChildItem -LiteralPath $globalNpmRoot -Filter codex.exe -File -Recurse)
if ($cliCandidates.Count -ne 1) { throw 'Expected exactly one standalone codex.exe.' }
$smokeCli = $cliCandidates[0].FullName
& $smokeCli --version
```

VM内の操作をこちらから実行できない場合、手作業が必要なのはこのVM作成・設定と段階1コマンドの実行である。結果を共有する際は `READY`、CLI数値版、段階1の固定成功・失敗分類だけにする。段階2以降の推論・承認・再接続にはそれぞれ別途承認が必要。

## 段階0: 使い捨て環境の作成（実接続なし）

1. 使い捨てWindows VM / Sandboxを新規に用意し、ホストのホーム、Desktop設定、プロジェクト、クラウドドライブを共有しない。ソースとCLIは隔離OS内で公式公開配布物から取得する。ホストの `auth.json`、セッション、設定、CLIラッパーをコピーしない。共有フォルダーなしで取得できない場合は停止し、持ち込み方法を別途レビューする。
2. 隔離OS内で、このPRのソースを取得する。Codexのcwdにはリポジトリを使わず、下記の合成ワークスペースを使う。既存の `.codex` 設定や親ディレクトリ設定を持ち込まない。
3. **Codexを起動せず**、同じPowerShellセッションで次を実行する。`$smokeRoot` は画面・公開ログに出さず、そのセッション内だけで保持する。

```powershell
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-inventory-v07-smoke-' + [Guid]::NewGuid().ToString('N'))
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v07-smoke-environment.ps1 -Action Prepare -Root $smokeRoot
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v07-smoke-environment.ps1 -Action Verify -Root $smokeRoot
```

補助スクリプトはOSの一時ディレクトリ直下に、空の `codex-home`、`codex-sqlite`、合成 `workspace-a` / `workspace-b`、空の `electron-user-data` を作る。`config.toml` は説明コメントだけで、認証・MCP・プロバイダー・実パスを含まない。`Verify` は既知の合成ファイル以外が存在すれば失敗し、認証・履歴ファイルの**内容を読まない**。出力は固定文言だけで、絶対パスやIDを表示しない。これはファイル配置の確認であり、ホストOS上で実Codexを安全に起動できるという保証ではない。

実接続を承認された**後**、隔離OS内の同じセッションで `CODEX_HOME` と `CODEX_SQLITE_HOME` を各合成ディレクトリへ設定する。`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、一時ディレクトリも隔離OS自身のものであることを確認する。`OPENAI_API_KEY` などの認証環境変数は**名前の有無だけ**確認し、値を表示・保存しない。意図しない値があれば停止する。ホストの認証をコピーして解決しない。

CLI確認は隔離OS内で接続前に `codex --version` のみ実行し、`codex-cli` の数値版だけ記録する。前回調査の対象は `0.144.6`。異なる版なら[プロトコル事前調査](V07_PROTOCOL_COMPATIBILITY.ja.md)の型・Issue影響・モック差をその版で再評価するまで、**段階1へ進まない**。エラーの生出力にパスが含まれ得るため、公開記録に貼らない。

段階1の接続は、将来承認された場合に限り、同梱の `scripts/v07-smoke-readonly.mjs` を使う。隔離OS内のスタンドアロン `codex.exe` を `$smokeCli` に指定し、**明示承認後にのみ**次のコマンドを実行する。`.cmd` ラッパーやDesktopのGUI実行ファイルは受け付けない。

```powershell
# 実接続への明示承認を得るまで、以下は実行しない。
node .\scripts\v07-smoke-readonly.mjs --root $smokeRoot --cli $smokeCli --approved-readonly-app-server
```

このクライアントは準備状態とCLI版を再確認した後に初めて `codex.exe app-server` を起動する。子プロセスへ渡す環境変数をOS動作に必要なものと一時 `CODEX_HOME` / `CODEX_SQLITE_HOME` に絞り、`initialize` / `initialized` と `thread/list` だけを使う。結果は固定の成功・停止分類だけ表示し、生JSON-RPC、ID、パス、stderrを表示しない。初期一覧が空でなければ停止する。上記の実施結果はこのコマンドによる。

### 接続前の安全チェックリスト

- [ ] 別OSの使い捨てVM / Sandboxで、ホストのホーム・プロジェクト・Desktop状態の共有がない。
- [ ] 合成ワークスペース以外をCodexのcwdとしない。リポジトリ自体をcwdとしない。
- [ ] `Verify` が `READY` を返し、初期 `codex-home` に認証・履歴がない。新規の空の状態だけを使う。
- [ ] `CODEX_HOME` と `CODEX_SQLITE_HOME` は合成ルート内。その他のプロファイル変数は隔離OSのもの。
- [ ] 認証環境変数、既存のCLI/GUIプロセス、共有ドライブ、継承された設定・プラグイン・MCPがない。
- [ ] CLI版が `0.144.6` と一致する。違う場合は互換性照合をやり直す。
- [ ] 生JSON-RPC、stderr、トレース、スクリーンショットを保存しない記録方法と、停止・削除手順が用意されている。
- [ ] 該当段階の明示承認を得ている。承認がない段階へ自動移行しない。

## 段階別の実接続手順（段階1は停止、段階2以降は未実施）

| 段階 | 実行条件・操作 | 費用 / 禁止操作 | 合格基準・停止条件 |
| --- | --- | --- | --- |
| 1. 読取専用接続 | 上の全チェックと**App Server起動への明示承認**後、隔離OSの合成cwdから上記の最小RPCクライアントで `initialize` / `initialized`、空の状態への `thread/list` を確認。必要な追加読取RPCは事前に列挙して承認を取る。 | 推論は送らないため推論費用なし。`run.ps1`、Desktop、Inventory通常起動、ログイン、`thread/start`、`turn/start`、既存IDへの `thread/read` / `thread/resume` を禁止。 | ハンドシェイク成功、初期thread一覧が空、認証要求が発生しないこと。既存スレッド、既存アカウント、想定外のRPC・権限要求、パス逸脱が見えたら即停止。認証がないため `model/list` 等が失敗してもPASSにしない。 |
| 2. 合成推論 | 段階1完了後、**隔離OS内の新規認証と課金可能な1ターンへの別途明示承認**を得る。新しい合成スレッドをread-only、ネットワーク権限なし、合成cwdで1回だけ送信。 | 実推論は課金・利用枠消費の可能性。ホスト認証のコピー、実チャット・実プロジェクト、複数回の自動再送を禁止。 | `turn/start`応答と `turn/started` / `turn/completed` のID・状態・順序を匿名の一致判定で確認。予期しない実行、承認要求、再送、費用上限超過で停止。 |
| 3. 承認・拒否・中断 | **各操作・対象・権限への別途明示承認**後、合成ファイルだけを対象に拒否を先に確認。許可時は人が内容を読んでから判断し、正確なthreadId/turnIdで中断する。 | コマンド実行・ファイル変更・権限付与・追加推論があり得る。ワークスペース外、ネットワーク許可、セッション全体の許可、内容を隠したままの承認を禁止。 | 要求と応答が同じ合成スレッド・ターン・項目に結び付き、拒否後に操作されず、中断は対象だけに作用。誤配送・期限切れの受理・不明な権限要求で停止。 |
| 4. 切断・再接続 | **再起動と状態復元への別途明示承認**後、同一の合成状態だけで切断、App Server再起動、`thread/resume`、Inventory SSE復元を確認する。 | 実ターンが継続すると費用が生じ得る。Desktop所有スレッド、別OSプロファイル、外部履歴への再開を禁止。 | 実行・承認・完了状態がID照合で復元し、重複承認や別ターンへの再送がない。状態不明・競合・タイムアウト時は再送せず停止。 |

段階1用クライアントは許可済みメソッドだけを送信し、結果を固定の状態・エラー分類へ変換する。既存のInventory起動経路は初期に履歴探索や `account/read` を行うため、段階1の代用にしない。段階2以降も各段階を人が開始し、前段階の成功から自動実行しない。

## 記録と後片付け

公開可能な記録はCLIの数値版、段階名、メソッド名、成功・失敗・SKIP件数、エラー分類、ID一致の真偽、経過時間の概数だけ。実セッションID、threadId、turnId、認証情報、ユーザーパス、プロンプト、コマンド、stdout/stderr、RPC本文は保存・転載しない。内部のCodexログや合成セッションファイルも機微な一時物として扱い、PR、Issue、Playwright trace、スクリーンショットに追加しない。`--trace off` を維持する。

すべてのプロセスを終了し、合成状態以外を削除対象に含めていないことを確認してから、同じPowerShellセッションで実行する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v07-smoke-environment.ps1 -Action Cleanup -Root $smokeRoot -ConfirmCleanup
```

削除スクリプトは、OS一時ディレクトリ直下の規定名、合成マーカー、シンボリックリンク・ジャンクション不在を確認した後に、そのルートだけを削除する。確認に失敗した場合は削除せず、人が対象を再確認する。今回の段階1で使った合成一時状態は削除した。

**次の判断:** `CONFIG_WARNING` の原因を安全に特定し、ホスト上の隔離限界を再評価するまで段階1の再試行を停止する。段階2以降の推論・承認には別途明示承認が必要。
