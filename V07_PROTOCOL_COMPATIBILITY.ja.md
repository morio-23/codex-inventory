# v0.7 App Serverプロトコル事前互換性調査

調査日: 2026-10-13。対象は `codex/v07-final-validation` の `3e782c0` から分岐したソースと、合成モックである。実Codex App Server、認証、既存セッション、実ターン、実承認には接続していない。本書の「整合」は公開型定義と合成モックで確認した範囲に限り、実接続のPASSを意味しない。

## 比較した版と資料

- ローカルCLIは、サーバーを起動しない `codex --version` だけで `codex-cli 0.144.6` と確認した。インストール元や認証設定は調べていない。
- この版に対応する公式リリースタグ `rust-v0.144.6` はコミット [`5d1fbf2`](https://github.com/openai/codex/tree/5d1fbf26c43abc65a203928b2e31561cb039e06d/codex-rs/app-server-protocol/schema/typescript) を指す。比較時の公式 `main` は [`12cca49`](https://github.com/openai/codex/tree/12cca49c81c8aa6a37a5cc4e39964ee3b70f9458/codex-rs/app-server-protocol/schema/typescript)（2026-10-12 UTC）。`main` の追加仕様を0.144.6へ遡及して断定しない。
- [公式App Server説明](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、両コミットの生成済みTypeScript型、[Rustのturn定義](https://github.com/openai/codex/blob/12cca49c81c8aa6a37a5cc4e39964ee3b70f9458/codex-rs/app-server-protocol/src/protocol/v2/turn.rs) を照合した。対象は Inventory の `app-server-client.mjs`、`codex-service.mjs`、`server.mjs` と `tests/fixtures/mock-app-server.mjs`。

## 互換性確認マトリクス

| 経路 | 公式0.144.6 / 現行mainとの照合 | Inventory・モックと今回の対応 | 実接続 |
| --- | --- | --- | --- |
| `initialize` → `initialized` | `capabilities.experimentalApi` と `requestAttestation` は両版の生成型で必須。初期応答の後に通知する。 | `requestAttestation:false` を明記し、モック契約テストを追加。 | 未検証 |
| `thread/start` | `cwd`、`approvalPolicy`、`sandbox`、`approvalsReviewer` は両版にある。 | `approvalsReviewer:'user'` を明記し、承認をUIへ経路指定。ワークスペース検証は既存実装を維持。 | 未検証 |
| `thread/read` | `threadId` と `includeTurns` は両版で有効。現行mainは全履歴取得を非推奨とし、ページングを推奨。 | 既存の全履歴取得を維持。モックは履歴項目の全形を再現しない。長い履歴の性能は未測定。 | 未検証 |
| `thread/resume` | `threadId` だけで再開できる。現行mainには `excludeTurns` が追加。実行中スレッドの再接続動作は条件付き。 | 既存スレッドを購読するとき再開する。別プロセス所有のスレッドとの競合はモックでは再現できない。 | 未検証 |
| `turn/start` | `threadId`、`input`、`cwd`、承認・サンドボックス設定は両版にある。生成型のテキスト入力には `text_elements` が必要。実装側Rustは省略値を許すが、型に揃える。 | `text_elements:[]` と `approvalsReviewer:'user'` を送信。読み取ったスレッド状態が既にactiveなら409で拒否。状態確認後に他クライアントが開始する競合は残る。 | 未検証 |
| `turn/interrupt` | `threadId` と正確な `turnId` が必要。 | Inventoryの既存送信形は合致。モックは古いIDを拒否するよう修正。古いターンを新しいターンへ読み替えて再試行しない。 | 未検証 |
| `turn/completed` | `{threadId,turn}`。`turn.status` は completed / interrupted / failed 等。現行mainの `Turn` は items、itemsView、時刻、エラー等も持つ。 | 状態とIDを使う既存処理は合致。モックのTurnは最小形で、完全なペイロード・通知順を再現しない。 | 未検証 |
| `item/commandExecution/requestApproval` | 両版で `threadId`、`turnId`、`itemId`、`startedAtMs`、`environmentId` がある。現行mainは `kind` を追加し、`writeStdin` を区別。旧版は `kind` なし。 | モックに時刻・環境・新しいkindを追加。`writeStdin` は専用の判断UIがないため拒否。kindなしの旧版要求は維持。 | 未検証 |
| `item/fileChange/requestApproval` | `startedAtMs` 等を持つ。応答は `decision` で、accept / acceptForSession / decline / cancel。 | モックに時刻を追加。既存の決定形式・スレッド・ワークスペース照合を維持。 | 未検証 |
| `item/permissions/requestApproval` | 時刻・環境・許可範囲を持つ。応答は `permissions` と `scope`、任意の `strictAutoReview`。 | モックに時刻・環境を追加。既存の許可プロファイル応答を維持。 | 未検証 |
| SSE切断・再接続 | App ServerのJSON-RPC通知とInventoryのブラウザー向けSSEは別の経路。公式型はInventory SSEの再送を規定しない。 | 既存のHTTPスナップショットで実行・承認状態を復元する。イベントIDとSSE再送はない。モックで復元を検証済み。 | 未検証 |

## 今回修正したモックとの差と残差

修正前のモックは承認要求の `startedAtMs`、`environmentId`、現行mainのコマンド `kind` を省略し、`turn/interrupt` の `turnId` を無視していた。`initialize` とテキスト入力も生成型の必須フィールドを確認しなかった。今回はこれらを合成データで検査し、実装の不足分だけ補った。コマンド `kind:'writeStdin'` は通常コマンドと異なる承認対象であり、Inventoryは誤承認を避けるため拒否する。

なお、モックは次を再現していない。

- 実サーバーで実行中の同一スレッドに2回目の `turn/start` を送ると入力がsteerとして扱われ得る動作。Inventory内の重複送信と、読み取り時点でactiveな外部ターンは拒否するが、別プロセスとの同時開始は原子的に防げない。
- 公式 `Turn` / `Thread` の全フィールド、UUIDv7の実ID、履歴のページング、複数承認コールバックの不透明なID、通知の全順序・遅延・再送。
- App Serverプロセス停止・再起動時の未処理承認とターンの復元、Desktop所有の同一スレッドへの同時接続、OS・CLI版による差。

### 応答・イベント・エラーの境界

- InventoryのJSON-RPCクライアントは応答IDでpendingを解決し、公式のエラー `code` / `message` を例外として渡す。接続切断時はpendingを拒否し、承認要求を破棄する。未知のサーバー要求はJSON-RPCのmethod-not-foundまたは安全側の拒否を返す。
- `turn/completed` は対象threadIdとturnIdが現在のターンに一致するときだけ状態を終える。開始応答より先に完了通知が来る場合は一時保存する。Inventory SSEの断線中に届かない通知は、再接続時のスナップショットで補う。
- `turn/start` のRPCタイムアウトは「ターンが開始されなかった」証明ではない。実サーバーが開始済みでも応答だけ失われる可能性があり、その場合の再送・復元はモックでは検証できない。自動再送はしない。`turn/interrupt` の古いIDエラーも別ターンへ自動再試行しない。

## 関連Issueの評価

- [openai/codex #36866](https://github.com/openai/codex/issues/36866): 実行中スレッドへの追加 `turn/start` が新ターンIDを返しても、入力は既存ターンへsteerされる可能性を報告。InventoryのターンIDと配送の前提に関わるため、既存active状態の送信を拒否した。ただしチェック後の競合は残り、ローカル0.144.6での再現は未検証。
- [openai/codex #40953](https://github.com/openai/codex/issues/40953): ターンIDを要求しない原子的な `thread/interrupt` の提案。現行APIに実装済みとは扱わない。Inventoryは既存の正確な `turnId` 付き `turn/interrupt` を維持する。競合で拒否された場合の手動再確認が必要。
- [openai/codex #21982](https://github.com/openai/codex/issues/21982): 承認イベントが届かない事例。レビュー担当設定が影響した報告がある一方、同設定でも届かないという追記もある。両版の `approvalsReviewer:'user'` を明示したが、ローカル0.144.6でのイベント配送保証にはならない。
- [openai/codex #36389](https://github.com/openai/codex/pull/36389): 履歴への複数プロセス書き込みを制限する変更。ローカル0.144.6のタグより後にmainへ入った。Desktop所有スレッドとの同時操作を安全と仮定しない。

Issueのオープン状態だけでは、対象CLIに同じ不具合があるとは判定しない。

## 実Codexでしか確認できない事項

1. ローカル0.144.6でのハンドシェイク、型定義と実ランタイムの許容範囲、CLI更新後の互換性。
2. 使い捨てスレッドでの `turn/start` 応答と `turn/started` / `turn/completed` の順序・ID一致、終了種別、異常終了。
3. コマンド・ファイル変更・権限要求それぞれの通知、承認ID、応答の受理・拒否・取消・期限切れ。
4. App ServerとInventoryの切断・再起動後の `thread/resume`、ターン・承認復元、ブラウザーSSE再接続。
5. DesktopとInventoryが同じスレッドを扱う場合の所有権、履歴ロック、steer・中断の境界。既存の実スレッドを試験対象にしない。

## 隔離環境での最小権限Smoke Test手順（今回は未実施）

隔離環境の作成・検証・削除と段階ごとの実行条件は [Smoke Test隔離準備](V07_SMOKE_ISOLATION.ja.md) に詳述した。準備用スクリプトは実App Serverを起動しない。

| 段階 | 操作と記録範囲 | 権限・費用 | 必要な事前承認 |
| --- | --- | --- | --- |
| 0. 準備 | 使い捨てOSプロファイル、空の合成ワークスペース、別の一時Codex状態ディレクトリを用意。既存Desktop、チャット、認証設定から隔離。CLI版の確認手順を用意。 | ローカル準備 | 実接続承認は不要。接続へ自動移行しない |
| 1. 読取専用接続 | 隔離App Serverを起動し、`initialize` / `initialized` と空の `thread/list` だけを試す。追加の読取RPCは対象と記録方法を別途確認する。 | サーバー起動と状態読取。既存アカウント・履歴へアクセスしない。 | 起動・接続への明示承認 |
| 2. 合成ターン | 新規スレッドをread-only、network offで作り、短い無害な合成入力を1回送る。応答IDとイベント順・状態だけを要約。 | **実推論・課金可能** | 課金可能な実ターンへの別途明示承認 |
| 3. 承認と中断 | 専用の使い捨て対象で拒否を先に試し、許可は内容を人が確認してから行う。 | **ファイル変更・コマンド実行・権限付与の可能性** | 各危険操作への別途明示承認 |
| 4. 再接続 | 同じ合成状態だけでApp Server再起動、`thread/resume`、SSE復元を確認する。 | 実ターン継続時は費用の可能性 | 再起動への別途明示承認 |
| 5. 片付け | 合成状態だけを削除。公開レポートには件数とエラー分類のみ記載する。 | 隔離環境に限定 | 削除対象の確認 |

読取専用の段階1だけでは `turn/start`、承認、完了、再接続の互換性は確認できない。Desktop所有のライブスレッドでは `thread/resume`、送信、中断、承認を行わない。今回の調査では表のどの段階も実行していない。

## 公開ソースのプライバシー確認

今回の差分は実装、合成モック、合成テスト、本書のみ。テスト入力とスレッド名は合成値で、実チャット、実セッションID、トークン、認証設定、個人用絶対パス、コマンド出力を追加していない。公式型定義の一時取得物はGitの除外ディレクトリに置き、コミットしない。本調査は公開済みの添付画像、実EXE、実環境設定の安全性を再保証しない。

| ローカル検証 | 結果 | 成功 / 失敗 / SKIP |
| --- | --- | --- |
| `npm run check` | 成功 | 1 / 0 / 0 コマンド |
| `npm test` | 成功 | 152 / 0 / 1 テスト。SKIPはWindowsシンボリックリンク制限 |
| `CODEX_E2E_REAL=0 npm run test:e2e -- --trace off` | 成功 | 54 / 0 / 4 テスト。4件の実Codex E2Eは未実施 |
| `node scripts/audit-v07-diff.mjs main` | 成功、共通祖先のある `origin/main` へフォールバック | 機微情報の設定済みパターン検出0。手動確認は別 |
| `powershell -ExecutionPolicy Bypass -File scripts/audit-public-source.ps1` | 成功 | 追跡テキストと履歴の設定済みパターン検出0。画像・添付の目視監査を代替しない |
| `git diff --check` | 成功 | 空白エラー0 |

**判定:** ソースと合成モックの契約差は一部修正したが、実App Serverとの互換性は未検証であり、v0.7公開前ブロッカーは解消していない。
