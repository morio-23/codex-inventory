# ソース公開・Windows版配布方針

**言語：[English](PUBLICATION_CHECKLIST.md) | 日本語**

Codex InventoryはMITライセンスの独立したオープンソースプロジェクトです。この公開リポジトリは**新しいGit履歴**で作成しており、以前のPrivate開発リポジトリのコミット・Issue・PR・個人パス入りの画像・EXE・ローカル設定は引き継いでいません。

## Actionsの追加課金なしで運用

GitHub Actionsは`workflow_dispatch`の**手動実行のみ**です。pushやPRでは起動しません。予算の承認なしに **Run workflow** を押さないでください。PRの検証はローカルで実施します。

~~~powershell
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
~~~

OS、Nodeバージョン、コミットSHA、PASS/FAIL/SKIP件数をPRに記載します。通常テストはモックApp Serverを使い、本物のリセットチケットを消費しません。実Codexテストは任意・明示的な実行で、本人の利用枠を使用します。ローカルPASSはGitHub ActionsのPASSではありません。

## 公開ソースのプライバシー

非公開プロジェクト、会話、アクセストークン、開発端末パス、ユーザープロファイルの設定や未加工のスクリーンショットをコミットしないでください。`scripts/audit-public-source.ps1`で一部の典型的な秘密情報パターンを確認できますが、完全な監査ではありません。変更や画像は目視確認が必要です。ビルド成果物や開発用証跡はGit管理から除外しています。

## Windows EXEは未配布

OSSとしてのソース公開とEXEの公開は別です。**現時点でGitHub Releasesに公式Windows EXEはありません。** 設定隔離、実Codexの許可・拒否、Setup導入・削除、通知センターの目視、電子署名の状態、第三者ライセンスとSHA-256を検証後に配布します。[受け入れ手順（日本語）](RELEASE_ACCEPTANCE.ja.md)を参照してください。古いテスト用EXEを公開しないでください。

## 非公式プロジェクト

Codex InventoryはOpenAIが開発・後援・認定・サポートする製品ではありません。MITはプロジェクトが所有するソースに適用され、第三者の依存ライブラリにはそれぞれのライセンスが適用されます。


## v0.7 並列チャット表示の公開前ゲート
- [ ] `npm run check`、`npm test`、`npm run test:e2e` を **ローカルのモック環境**で実行し、結果を個人情報抜きで要約する。
- [ ] `node scripts/audit-v07-diff.mjs main` と `powershell -ExecutionPolicy Bypass -File scripts/audit-public-source.ps1` をローカルで実行する。自動検出がPASSでも、変更差分・Git履歴・画像・PR添付を手動確認する。
- [ ] 左下ログ・通知・スクリーンショット・テスト成果物に実プロンプト、コマンド、パス、セッションID、トークン、機微な実行出力が含まれないことを確認する。
- [ ] 2チャットと別ワークスペースの並列実行・承認待ち・中断・イベント再接続をモックで確認する。
- [ ] 誤ったワークスペースへの書込と、別チャットの承認を拒否することを確認する。
- [ ] 実Codexへの課金可能なE2E、GitHub Actions、mainマージ、EXE公開は別途明示的な承認後のみ実施する。
