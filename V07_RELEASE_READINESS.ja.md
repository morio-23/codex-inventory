# Codex Inventory v0.7.0-beta.1 — リリース準備・判定（作業用）
  
> **作業用 / 未承認** — 2026-10-23 JST。これはチェックリストであり、テストの実行記録や配布許可ではありません。GitHub Actions、mainへのマージ、EXE公開は実施しないでください。English: [V07_RELEASE_READINESS.md](V07_RELEASE_READINESS.md)。

## 1. 現状と事実

- 公開ソース：`main`（2026-10-23調査時のSHA: `13ad1fbcb2092934423091ec7647ced790a23259`）。
- 既存の配布版：[v0.6.0-beta.1](https://github.com/morio-23/codex-inventory/releases/tag/v0.6.0-beta.1) は2026-10-11に公開済み（Setup/Portable/SHA256SUMS.txt）。GitHubの `prerelease` フラグは `false`。これは過去のEXEの十分な受け入れ検証を証明しません。
- v0.7統合ソース：Draft [PR #16](https://github.com/morio-23/codex-inventory/pull/16) の先端 `ef96d6cecaa1c8714f6c0bc8b66144f930f7af30`。確認時点でmainより43コミットahead、behind 0。v0.7用EXEは作成・公開していません。
- 過去の検証結果：PR #16で構文チェック成功、Node 162 PASS / 0 FAIL / 1 SKIP。これは10/14時点のブランチ結果であり、この準備PRで再実行した結果ではありません。PR #15で合成モックE2E 54 PASS / 実Codex 4 SKIP。PR #16ではE2E再実行なし。
- **停止要因**：2026-10-14の実App Server読取専用Smokeは `CONFIG_WARNING` で停止。原因・内容未確認、空の `thread/list` 未確認、実ターン・実承認・再接続未実施。警告を握りつぶしてPASSにしない。

## 2. 統合順序と重複回避

各Draft PRは依存ブランチへの差分として作成されています。元の機能検討PR #7（A）、#8（C）、#9（B）は、統合PR #10に取り込まれた系統と重複します。**各PRをmainに個別マージしないこと。**

```text
main
  └─ #10 feat/v07-integration
       └─ #11 codex/v07-integration-review
            └─ #12 codex/v07-backend-concurrency
                 └─ #13 codex/v07-frontend-completion
                      └─ #14 codex/v07-final-validation
                           └─ #15 codex/v07-protocol-compat
                                └─ #16 codex/v07-smoke-isolation
                                     └─ release-readiness (この準備PR)
```

最終的に一本化した累積diffをレビューし、未承認の段階でmainの移動・タグ作成・ビルド成果物のアップロードを行わない。将来のマージ時はmain HEADを再取得し、履歴が更新されていれば再比較する。

## 3. タスクと完了条件

| ID | 作業 | GitHubだけで可能か | 完了条件 | 状況 |
|---|---|---|---|---|
| CI-01 | PR依存関係・累積差分の棚卸し | ○ | PRの重複と統合元が明確 | 初回確認済 |
| CI-02 | `CONFIG_WARNING` の切り分け | △（コードレビューのみ） | 隔離実機で原因特定・無害性確認または修正 | ブロック中 |
| CI-03 | リリース準備ブランチ・差分と資料 | ○ | mainを変更せずDraft PRに集約 | このPRで準備 |
| CI-04 | Node構文・単体検証 | ×（Windows/Node） | 最新SHAで0 FAIL、SKIP理由記録 | 未実施 |
| CI-05 | 合成E2E・レスポンシブ・SSE | ×（Playwright） | 最新SHAでモック0 FAIL | 未実施 |
| CI-06 | 隔離された実App Server読取接続 | ×（使い捨てVM） | initialize/initialized、空thread/list成功 | 未実施 |
| CI-07 | 実ターン・承認拒否・中断・再接続 | ×（使い捨てVM・明示承認） | 正しいthread/turn/workspaceへ配送、誤操作なし | 未実施 |
| CI-08 | ソース・履歴・画像・依存ライセンス監査 | △ | 機微情報なし、監査範囲と残余リスク記録 | 部分実施 |
| CI-09 | Setup/Portableビルド、署名・SHA確認 | ×（Windows） | 同一コミットから新規生成、両EXEのハッシュ一致 | 未実施 |
| CI-10 | 使い捨てVM起動・インストール/削除・通知 | ×（Windows） | 実機で確認、失敗なし | 未実施 |
| CI-11 | 日英リリースノート・導入説明 | ○ | 未検証をPASSと誤表記しない | 下書き準備 |
| CI-12 | main統合・タグ・GitHub Releases | ×（ゲート承認後のみ） | 配布物、公開URL、checksumの照合 | 未実施 |

## 4. 次にPCで実施する項目（手作業 / 自動では実行しない）

1. 新しい使い捨てWindows VMを用意し、**ホストの認証・履歴・クラウド同期・共有フォルダーを持ち込まない**。Windows 11 Home上でSandbox非対応の場合は、既存のホスト設定に手を加えず別VMを使う。詳細は [V07_SMOKE_ISOLATION.ja.md](V07_SMOKE_ISOLATION.ja.md)。
2. まず `CONFIG_WARNING` の原因を特定する。**警告をスキップして次段階に進まない。** サーバーの起動・読取だけでも権限範囲を確認する。
3. 最新の候補コミットを固定し、Windows上で `npm ci`、`npx playwright install chromium`、`npm run check`、`npm test`、`npm run test:e2e`、`git diff --check`、`node scripts/audit-v07-diff.mjs main` と `scripts/audit-public-source.ps1` を実行する。実Codexを使うE2Eは**別途明示許可後のみ**、一時環境に限定。
4. 合成ワークスペース2件 / チャット3件、2ペイン個別操作、別プロジェクトの誤承認拒否、停止、SSE再接続、画面幅390/768/1280/1920と日英UIを確認する。
5. `verify-release.ps1` の版更新・両EXE検証を行い、Disposable VMのSetup導入・削除とWindows通知を実画面で確認する。リリース版のバージョン更新（`package.json`、`desktop/package.json`、Lockfile、ビルド設定など）は**全箇所を照合してから**実施する。

## 5. Go / No-Go と公開の手続き

**No-Go（現在）**：実接続Smoke未合格、実承認未検証、新しいEXEの配布検証なし。モックテストがPASSでも一般向けEXE配布を正当化しない。

**Go条件（すべて必要）**：
- 実App Server接続・実ターン・承認分離・復元の該当ゲートが合格し、試験対象は使い捨て環境に限る。
- 最新リリースコミットでNode/Playwrightが0 FAIL。SKIPと除外範囲を日英で記載。
- Git履歴、変更ファイル、スクリーンショット、ビルド成果物、同梱ライセンスの機密・権利確認が完了。
- Setup/Portable、通知、アンインストール、初回起動とCLI未検出をDisposable VMで受け入れ。
- 安全な更新・配布手順と署名方針を明記し、未署名ならSmartScreenの警告を説明。

Go判定後に限り、レビュー済みの単一差分をmainへ統合し、`v0.7.0-beta.1`をタグ付けする。GitHub Releaseの**Pre-release** を選び、新規ビルドのSetup/Portableと`SHA256SUMS.txt`、日英ノートを添付する。アップロード後のハッシュ照合を行う。EXEはGitコミットやPR添付に入れない。GitHub Actionsは手動起動であっても課金承認なしに実行しない。

関連：[Issue #1](https://github.com/morio-23/codex-inventory/issues/1)、[Issue #6](https://github.com/morio-23/codex-inventory/issues/6)、[公開方針](PUBLICATION_CHECKLIST.ja.md)。
