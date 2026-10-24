# Issue #18 — CONFIG_WARNING の機密情報を出さない切り分け（v0.7）

2026-10-24作成。**診断追加の設計記録であり、実Codex接続の合格記録ではありません。** 本文の警告分類は公式Codex `rust-v0.144.6` のソースに基づく。別CLI版への適用を自動保証しない。

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

## Windows端末だけで先に実施できる確認（**実Codexを起動しない**）

```powershell
git fetch origin
git switch -c codex/v07-config-warning-triage-20261024 --track origin/codex/v07-config-warning-triage-20261024
npm run check
node --test tests/v07-smoke-readonly.test.mjs
npm test
git fetch origin main
git diff --check origin/main...HEAD
node scripts/audit-v07-diff.mjs main
```

実際に検証したSHA、NodeテストのPASS/FAIL/SKIP、差分監査のPASS/FAILだけを記録する。新しいコードはこの時点では未検証であるため、過去の`c523803`のPASSを流用しない。

## 実接続の再試験（必ず使い捨てWindows VM）

以前の同一ホスト上の一時`CODEX_HOME`は、OS全体・認証や設定レイヤーからの完全隔離を保証しない。**ホストの普段のCodex、実チャット、CLI状態を使って再実行しない。**

1. [既存の隔離手順](V07_SMOKE_ISOLATION.ja.md)に従って新しいVMを準備。ホストとの共有、同期、既存認証をなくし、対象CLI版を固定。
2. VM内でこの診断ブランチのコミットを取得してSHA照合。合成`codex-home`と作業フォルダをPrepare→Verifyし`READY`を確認。
3. VMのネットワークを遮断し、段階1の読取専用App Server接続だけを明示的に実行。成功なら`READONLY_OK`、警告が出れば`READONLY_STOP: CONFIG_...`の**コードのみ**記録。失敗したら進まず後片付け。
4. 分類結果によって、影響する隔離VM内の設定レイヤー・SQLite・exec policy・プロジェクト信頼設定を確認。原因が解決するまで警告を無視して進まない。Unknown時は実行対象CLI版・起動手順の公式ソースをさらに照合する。
5. 読取成功後も、推論・承認・ファイル操作・切断・再接続は別段階。費用・権限を含む各操作を個別に承認してから進む。

**現在の判定：NO-GO。** `CONFIG_WARNING` の原因特定・実機の修正結果、実ターン/承認/再接続、EXEビルド/Windows VM受け入れは未完了。Draft PR・main不変更・GitHub Actions不実行を維持する。
