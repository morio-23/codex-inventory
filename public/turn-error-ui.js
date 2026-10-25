// Only fixed, non-sensitive explanations can appear in user-visible notices.
// Never print an App Server's raw error string: it may contain private paths,
// prompts, or local process information.
const CATEGORIES=Object.freeze({
  WORKSPACE_MISMATCH:[
    '対象チャットが現在のプロジェクトに属していません。所属プロジェクトを選び直してください。',
    'This chat belongs to another workspace. Select its original project.'
  ],
  THREAD_BUSY:[
    'このチャットは別のCodexクライアントで処理中です。終了を待って履歴を再読込してください。',
    'This chat is busy in another Codex client. Wait for it to finish and reload the history.'
  ],
  THREAD_RESUME_FAILED:[
    '既存チャットの再開に失敗しました。履歴を再読込し、必要なら新規チャットで試してください。',
    'The existing chat could not be resumed. Reload history or try a new chat.'
  ],
  MODEL_REJECTED:[
    'モデルまたは推論レベルが拒否されました。Codex設定を継承して再確認してください。',
    'The model or reasoning effort was rejected. Try inheriting Codex settings.'
  ],
  EDIT_PERMISSION_REQUIRED:[
    '実装・修正にはファイル編集許可が必要です。内容を確認してから選択してください。',
    'Build and Fix require explicit file-edit permission.'
  ],
  CONNECTION_CHANGED:[
    'Codexとの接続が切り替わりました。状態を更新し、同じ依頼が実行されていないか確認してください。',
    'The Codex connection changed. Refresh and check whether the request already started.'
  ],
  REQUEST_TIMEOUT:[
    'Codexからの応答が間に合いませんでした。再送信前に履歴と実行状態を確認してください。',
    'Codex did not respond in time. Check history and running status before resending.'
  ],
  TURN_REJECTED:[
    'Codexが実行要求を拒否しました。送信前の内容と対象チャットを確認してください。',
    'Codex rejected the request. Check the chat and submission settings.'
  ]
});
const MATCHES=[
  ['WORKSPACE_MISMATCH',/別プロジェクト|別ワークスペース|プロジェクトが切り替わ|workspace (?:does not match|mismatch)|different workspace|wrong workspace/i],
  ['THREAD_BUSY',/別のクライアントで実行中|このスレッドは実行中|already (?:running|active|in progress)|thread (?:is )?(?:busy|active)|another client/i],
  ['THREAD_RESUME_FAILED',/thread\/resume|failed to (?:read|resume).*thread|could not resume|cannot resume|unknown thread|thread (?:not found|does not exist)|conversation (?:not found|does not exist)|rollout.*(?:missing|empty|not found)/i],
  ['MODEL_REJECTED',/モデル.*(?:不正|拒否|対応)|推論レベル.*(?:不正|拒否|対応)|(?:unsupported|invalid|unknown) (?:model|reasoning|effort)|model.*not (?:available|supported)/i],
  ['EDIT_PERMISSION_REQUIRED',/実装・修正には編集許可|file.edit permission required/i],
  ['CONNECTION_CHANGED',/接続が切り替わ|App Serverが終了|App Serverが接続されていません|connection (?:closed|lost|changed)|disconnected|not connected/i],
  ['REQUEST_TIMEOUT',/タイムアウト|timed? out|timeout/i]
];
export function classifyTurnError(error) {
  const raw=typeof error?.message==='string'?error.message.slice(0,1500):'';
  for(const [code,pattern] of MATCHES)if(pattern.test(raw))return code;
  return 'TURN_REJECTED';
}
export function turnFailureNotice(error,language='ja') {
  const category=classifyTurnError(error);
  const message=CATEGORIES[category][String(language).toLowerCase().startsWith('en')?1:0];
  return {category,text:(String(language).toLowerCase().startsWith('en')?'Could not start the request':'実行を開始できません')+
    ' ['+category+'] '+message};
}
