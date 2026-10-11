# Codex Inventoryへの貢献

**言語：[English](CONTRIBUTING.md) | 日本語**

貢献を検討してくれてありがとう。Codex Inventory は Codex App Server に接続する**独立した非公式**のローカルデスクトップクライアントであり、OpenAI の公式製品ではありません。

## Pull Requestを作成する前に

- 大きな機能変更、動作仕様変更、セキュリティに関わる変更は、先に Issue で相談してください。
- 変更範囲を絞り、不具合修正には再現手順と関連テスト、UI変更には変更前後のスクリーンショットを添えてください。
- APIキー、アカウント認証情報、個人のCodexチャット履歴、非公開プロジェクト、実際のリセットチケット識別子、ユーザープロファイル内のファイルをコミットしないでください。
- 自動テストには使い捨てのテストプロジェクトとモック App Server を使用してください。本物のリセットチケットを消費しないでください。
- Issue・PRの議論では相互に敬意を持ってください。

## ローカル開発

開発テストには Node.js 20以上（推奨22）、npm、Playwright Chromium が必要です。Windows デスクトップ版のパッケージングは Windows 11 x64で実行します。

~~~bash
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:e2e
~~~

Windows向けのビルドは[受け入れ手順（日本語）](RELEASE_ACCEPTANCE.ja.md)を参照してください。認証済みの実Codex CLIを使用するテストは、**明示的な有効化が必要**で、利用枠を消費する可能性があります。追加の環境分離・実Codex検証は[Windows版受け入れ手順](RELEASE_ACCEPTANCE.ja.md)を参照してください。

## Pull Requestに求める内容

変更内容・理由・実施した検証・未検証事項を記載してください。特にUI変更はモバイル相当の狭い幅とデスクトップ幅で変更前後の画像を添えてください。

モックテストが成功しても、Windowsインストーラー・実Codex権限要求・通知センターの実機動作を確認したことにはなりません。

貢献を送信することで、当リポジトリの[MITライセンス](LICENSE)のもとで、その貢献が取り込まれることに同意したものとします。第三者の成果物を含む場合は出典・ライセンスを明示し、提供する権利があることを確認してください。

## 脆弱性の報告

**悪用可能な脆弱性は公開Issueに記載しないでください。** GitHubの非公開脆弱性報告機能が使える場合はそれを使用し、使えない場合はメンテナーのGitHubプロフィール経由で非公開の連絡方法を相談してください。本物の認証情報は添付しないでください。

詳細は [SECURITY.ja.md](SECURITY.ja.md) を参照してください。

### コミット作成者のメール保護
個人メールを公開したくない場合は、コミット作成前にGitの `user.email` をGitHubのnoreplyアドレスに設定し、`git var GIT_AUTHOR_IDENT` と `git var GIT_COMMITTER_IDENT` を確認してください。後からコミットを書き換えても、旧コミットやPRのforce push履歴にメールアドレスが残る場合があります。
