# Codex Inventory vX.Y.Z — リリースノート（日本語）

**言語：[English](RELEASE_NOTES_TEMPLATE.md) | 日本語**

> これはひな形です。リリース受け入れ試験が完了し、配布物が承認されるまで**公開しないでください**。

## 主な変更点

- ［追加・修正機能］—［利用者への影響］
- ［追加・修正機能］—［利用者への影響］

## ダウンロード（Windows 11 x64）

以下を同じバージョンの **GitHub Release** に添付します。通常のGitコミットには含めません。

- CodexInventory-Setup-X.Y.Z-x64.exe — インストール版
- CodexInventory-Portable-X.Y.Z-x64.exe — インストール不要版
- SHA256SUMS.txt — 添付したEXEと一致するSHA-256
- 第三者ライセンス／著作権表示 — 同梱依存関係に応じて必要なもの

[GitHub Releases](https://github.com/morio-23/codex-inventory/releases) からダウンロードし、過去ビルドのEXEを流用しないでください。ダウンロード後にハッシュを照合してください。

## 動作要件と導入

Windows 11 x64、互換性のあるCodex CLI/App Server実行ファイル、認証済みのCodex環境が必要です。EXEを起動するだけならNode.jsは不要です。Codex CLIと認証情報は**同梱されません**。Setupの導入またはPortableの直接起動後、画面内のCLI検出・ログイン案内に従ってください。

## テスト結果・既知の制限

- Nodeテスト：［PASS/FAIL、件数、日付］
- PlaywrightモックE2E：［PASS/FAIL、件数、日付］
- 実Codexの許可／拒否：［PASS/FAIL/SKIP、詳細］
- 使い捨てVMでのSetup導入・削除：［PASS/FAIL/SKIP］
- Portable初回起動・別Windowsアカウント：［PASS/FAIL/SKIP］
- Windows通知センター：［PASS/FAIL/SKIP］
- 署名状態：［有効な発行者／**未署名β版**］
- 第三者ライセンス確認：［完了／未完了］
- 既知の不具合・制限：［列挙］

**セキュリティ：** HTTPサーバーは127.0.0.1でのみ使用します。トンネルやリバースプロキシ経由で外部公開しないでください。ローカルHTTP APIには別プロセスを認証する仕組みがありません。Codexの権限要求を確認してから許可してください。実際のリセットチケットの消費は取り消せません。

## 更新・サポート

自動アップデートはありません。Setup版は新バージョンをインストール、Portable版は新しいEXEへ置き換えてください。不具合は [GitHub Issues](https://github.com/morio-23/codex-inventory/issues)、脆弱性は [SECURITY.ja.md](SECURITY.ja.md) の手順で非公開報告してください。

本アプリはOpenAIの公式製品ではない独立したソフトウェアです。ソースコードは [MIT](LICENSE) で公開し、第三者コンポーネントにはそれぞれのライセンスが適用されます。
