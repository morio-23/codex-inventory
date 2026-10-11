/** Built-in prompts are copied into a draft; selecting one never calls Codex. */
const entries=[
 ['repo-map','構造把握','調査','リポジトリの入口','対象リポジトリの主要ディレクトリ、起動点、技術スタック、開発コマンドを整理してください。最初はファイルを編集しないでください。'],
 ['focused-inspect','関連ファイル調査','調査','関連箇所に限定','目的: {goal}\n関連するファイルのみ調べ、根拠となるファイルパスと行番号を挙げてください。編集はしないでください。'],
 ['debug-root-cause','エラー原因の切り分け','不具合','原因と再現条件','以下のエラーを再現条件、根本原因、検証方法に分けて分析してください。\n{error_message}\nコードはまだ変更しないでください。'],
 ['minimal-fix','最小変更のバグ修正','実装','変更範囲を制限','現象: {error_message}\n再現手順と原因を確認し、必要最小限の修正を実装して検証してください。既存の動作を守ってください。'],
 ['feature','既存設計に沿った機能追加','実装','既存構造を尊重','追加したい機能: {goal}\n既存の実装規約とテストを確認し、段階的に実装してください。変更点と残課題を報告してください。'],
 ['diff-review','差分のリスクレビュー','レビュー','変更を対象化','以下の変更について、重大度順に不具合、回帰リスク、セキュリティ上の問題を指摘してください。\n対象: {selected_files}\n差分概要: {diff_summary}\n修正せず、根拠と提案を示してください。'],
 ['security-review','セキュリティレビュー','レビュー','権限と入力を確認','この変更の入力検証、認証認可、秘密情報、パス・コマンドインジェクション、外部通信のリスクをレビューしてください。根拠の行番号を付け、修正は行わないでください。'],
 ['test-design','テストケース設計','テスト','成功・失敗・境界値','機能: {goal}\n正常系、異常系、境界値、回帰のテストケースと受け入れ条件を整理してください。'],
 ['e2e-fix','E2E実装・再検証','テスト','ブラウザE2E','機能: {goal}\n実ブラウザE2Eを実装し、実行して失敗を修正し、再実行してください。Consoleエラーと操作結果も確認し、残課題を報告してください。'],
 ['performance','性能ボトルネック調査','調査','計測優先','対象: {goal}\n推測で変更せず、まず実測可能な指標、計測手順、主なボトルネック候補を挙げ、根拠に基づいて改善策を提案してください。'],
 ['refactor-plan','リファクタリング計画','計画','段階的な変更','対象: {selected_files}\n公開APIや既存動作を保つための変更分割、依存箇所、回帰テスト、切戻し案を作成してください。まず計画のみ。'],
 ['docs-update','README・設計書更新','文書','差分と整合','変更機能: {goal}\n実装コードを根拠にREADMEと設計書を更新してください。未実装・未検証の内容は完了と書かないでください。'],
 ['pr-description','PR説明文作成','文書','レビューしやすく','変更概要: {diff_summary}\n背景、主な変更、テスト結果、破壊的変更、残課題を含むPR本文をMarkdownで作成してください。'],
 ['ci-diagnosis','CI失敗の調査','不具合','ログから原因特定','失敗したCI: {error_message}\nまず失敗箇所を特定して再現し、環境差かコード不具合かを切り分け、修正と再実行を行ってください。'],
 ['implementation-plan','実装前の計画','計画','手順とリスク','目標: {goal}\nコード変更前に影響範囲、設計、実装順、テスト計画、リスク、未決事項を整理してください。'],
 ['finish-task','実装から検証まで','実装','最後まで確認','目標: {goal}\n必要な調査、実装、テスト、失敗の修正と再検証まで進めてください。破壊的操作と本番反映は事前確認し、最後にPASS/FAIL/SKIPを整理してください。']
];
export const promptTemplates=Object.freeze(entries.map(([id,title,category,description,body])=>Object.freeze({
  id,version:1,title,category,description,body,
  variables:[...new Set([...body.matchAll(/\{([a-z_]+)\}/g)].map(x=>x[1]))],
  recommendedMode:'read',requiredTools:[],tags:[category],
  executionKind:'template',
  costLabel:'テンプレート選択時はCodex利用枠の消費なし',
  source:'builtin'
})));
export function listPromptTemplates(){
  return promptTemplates.map(x=>({...x,variables:[...x.variables],requiredTools:[...x.requiredTools],tags:[...x.tags]}));
}
