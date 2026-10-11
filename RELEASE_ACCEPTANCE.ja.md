# Codex Inventory v0.6 — Windows統合テスト手順

**言語：[English](RELEASE_ACCEPTANCE.md) | 日本語**

このチェックリストは**mainにすべてのソースを統合した後**の受け入れ検証用です。GitHub Actionsは利用しません（ユーザー方針：10月末までは追加課金なし）。

## 一括テスト

```powershell
cd C:\dev\codex-inventory
git switch main
git pull --ff-only
Set-ExecutionPolicy -Scope Process Bypass -Force
.\verify-release.ps1
```

このPublicリポジトリのmain対象コミットで実行します。`npm ci` → Playwright Chromium取得 → `npm run check` → `npm test` → `npm run test:e2e` → Windows Setup/Portable EXEビルド → 隔離したモックPortable EXEスモークを実行します。スモークは一時的なElectron userDataとモックCLIを使用し、既存のsettings.jsonの有無、サイズ、更新時刻、SHA-256を前後で比較します。バイナリは`dist/`に出力。通常の一括実行で**本物のリセットチケットを使用したり、実CodexのAIターンを開始したりしません**。

テストだけ先行する場合：

```powershell
.\verify-release.ps1 -SkipExe
```

`desktop/package-lock.json` はGit管理済みです。固定したlockfileを使い、配布前に `npm ci` と依存ライセンスの確認を行ってください。

`-SkipPortableSmoke` は診断用で、隔離スモークの判定はSKIPになります。`-RequireSigned` は未署名EXEを拒否します。ビルドではAuthenticode状態と `dist/THIRD_PARTY_REVIEW.json` を出力します。これはlockfile上の宣言台帳であり、ライセンス本文や法的確認の代わりにはなりません。`npm audit` と `npm audit --omit=dev`、同梱ライセンス、EXE内容、両EXEのハッシュを確認してください。EXEや試験プロファイルはGitに含めません。

## 使い捨てWindows環境での任意検証

認証済みCodex CLIを備えた使い捨てWindowsユーザーまたはVMで、以下の実Codex権限テストを実行します。モデル呼び出しと一時ファイルのみを使用します。許可要求が表示されなければ合格ではありません。本物のリセットチケットは使用しません。

~~~powershell
$env:CODEX_E2E_REAL='1'
$env:CODEX_E2E_APPROVAL='1'
npx playwright test tests/e2e/inventory.spec.mjs --grep '@real @approval' --workers=1
Remove-Item Env:CODEX_E2E_APPROVAL
Remove-Item Env:CODEX_E2E_REAL
~~~

拒否時は検証ファイルが存在せず、「今回のみ許可」時だけ期待する内容の一時ファイルが作成されることを確認します。Codexがツールを使わない場合や試験アカウントを使えない場合は、その理由とともにSKIPまたはFAILを記録します。個人情報を除いた証跡はGit管理外に保存します。

Setupは破棄可能なWindows Sandbox/VM内だけで実行します。一時インストール先でもユーザーのレジストリ設定が変わることがあります。

~~~powershell
$env:CODEX_INVENTORY_DISPOSABLE_VM='YES'
.\verify-setup-disposable-vm.ps1 -SetupExe .\dist\CodexInventory-Setup-0.6.0-x64.exe -DisposableVmConfirmed
Remove-Item Env:CODEX_INVENTORY_DISPOSABLE_VM
~~~

VM内で導入後の起動、アンインストール登録、削除後の残存ファイルを確認します。Codex CLIなしの初回起動では「再検出」「CLI選択」「インストール手順」「終了」を確認します。Windows通知センターで完了通知と承認通知を目視し、クリック後の前面復帰、最小化中の挙動、通知OFFも確認します。APIの `shown:true` だけでは合格にしません。

## 手動Windows受け入れ（別PC・別Windowsユーザーを含む）

- [ ] `dist/CodexInventory-Setup-0.6.0-x64.exe` をインストール・起動・アンインストールできる
- [ ] `dist/CodexInventory-Portable-0.6.0-x64.exe` をインストールせず起動できる
- [ ] Node.js未インストールでもGUIを起動できる。テスト/Lint実行のみnpmが必要なことを説明できる
- [ ] Codex CLI未インストール時に「再検出」「CLI選択」「インストール手順」が正常に動く
- [ ] Codex AppのみのPCで、Storeキャッシュ内の互換実行ファイルがあれば自動認識してApp Serverを起動できる
- [ ] CLI複数インストール時は先に選んだ候補が非互換でも、次の候補へフォールバックする
- [ ] ログイン済み/未ログインの状態を区別し、ユーザーの認証情報はEXEに同梱されていない
- [ ] 履歴0件でも「＋」のネイティブフォルダー選択でプロジェクトを追加し、チャットを作成できる
- [ ] 追加プロジェクトはEXE再起動後も残り、プロジェクト切替で他プロジェクトへ誤送信しない
- [ ] ホットバー、テンプレート、下書き、チャット選択が再起動後に維持される
- [ ] Codex Desktopチャット履歴を閲覧できる。別プロジェクトのスレッドはそのプロジェクト選択後のみ実行可能
- [ ] ローカルコード検索、Git差分、テスト/Lintが正しいcwdを参照し、承認なしのnpm実行を拒否する
- [ ] **Mock**のリセットチケットで選択→確認→最終同意の1回消費。キャンセルとリプレイ時0回
- [ ] 日本語/空白/長いパス、別ユーザープロファイル、ポート競合、二重起動、終了時のApp Serverプロセス残留を確認
- [ ] 最終配布物にユーザーの秘密情報・ローカル履歴・開発プロジェクト・テスト環境が含まれない
- [ ] `dist/SHA256SUMS.txt` と実EXEのハッシュが一致する
- [ ] ライセンス表記、未署名のSmartScreen警告、ユーザーに提供する更新方法を確認する

## 既知の制限

- Codex Appの実行中stdioサーバーへ直接相乗りはしません。互換`codex.exe`が見つかればInventory専用のApp Serverを起動します。
- CLIや互換サーバーが見つからない場合、ユーザー自身による公式Codex CLI導入が必要なことがあります。
- ElectronデスクトップEXEはNode/npm不要ですが、対象プロジェクトの`npm run test`/`lint`を使うには別途Node/npmが必要です。
- npmスクリプトはファイル変更や外部API課金があり得ます。承認画面とハッシュチェックはサンドボックスではありません。
- Windowsで実Codexにファイルを書かせる試験（明示的な任意テスト）は明示的なopt-in。既存プロジェクトは触らず一時ディレクトリだけを使用します。
- 実リセットチケットの使用は不可逆です。**自動E2Eでは決して消費しません**。
- 電子署名証明書がないため、公開EXEは未署名のままではSmartScreen警告の可能性があります。署名は証明書・発行者情報が準備できてから行います。
- 自動更新は含みません。新バージョンは新しいSetup/Portableを手動配布する運用です。

## 配布方法

EXEは `dist/` で生成します。このディレクトリは `.gitignore` でGit追跡対象から除外されます。**EXEを通常のGitコミットに含めたり、Git LFSに追加したりしません。** 公開の条件を満たしたビルドのみ、[GitHub Releases](https://github.com/morio-23/codex-inventory/releases)にSetup版とPortable版、`SHA256SUMS.txt`、既知の制限と日英リリースノートを添付します。アップロード後は添付ファイルのハッシュを再確認してください。

このPublicリポジトリでは検証前のEXEを配布しません。今後のコミット・スクリーンショット・設定値に機密情報がないか監査してください。EXEの署名状態、第三者ライセンス、実Codexでの承認と別PC/VMでの起動・インストールはそれぞれ別途確認が必要です。
