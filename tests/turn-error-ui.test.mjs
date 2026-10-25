import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTurnError,turnFailureNotice} from '../public/turn-error-ui.js';

test('only fixed diagnostic categories are returned for common Codex failures',()=>{
  const examples=[
    ['別プロジェクトのチャットです。画面で所属プロジェクトを選択してください。','WORKSPACE_MISMATCH'],
    ['このスレッドは別のクライアントで実行中です','THREAD_BUSY'],
    ['thread/resume failed: thread not found','THREAD_RESUME_FAILED'],
    ['Unsupported model','MODEL_REJECTED'],
    ['実装・修正には編集許可が必要です','EDIT_PERMISSION_REQUIRED'],
    ['接続が切り替わりました','CONNECTION_CHANGED'],
    ['turn/start がタイムアウトしました','REQUEST_TIMEOUT'],
    ["invalid params: missing field 'networkAccess' in sandboxPolicy",'INVALID_SANDBOX_POLICY'],
    ['Mock failure: turn/start','TURN_REJECTED']
  ];
  for(const [message,expected] of examples)
    assert.equal(classifyTurnError(new Error(message)),expected,message);
});

test('turn error UI does not leak sensitive raw App Server message',()=>{
  const privateMessage='turn/start failed C:\\Users\\private-account\\workspace ; Auth=secret-test-token';
  for(const lang of ['ja','en']){
    const result=turnFailureNotice(new Error(privateMessage),lang);
    assert.equal(result.category,'TURN_REJECTED');
    assert.doesNotMatch(result.text,/private-account|secret-test-token|Users|Auth=/);
    assert.match(result.text,/\[TURN_REJECTED\]/);
  }
});

test('unsafe or malformed failure details always produce generic fixed messaging',()=>{
  for(const error of [undefined,null,{message:null},{message:42},new Error('')]){
    const result=turnFailureNotice(error,'ja');
    assert.equal(result.category,'TURN_REJECTED');
    assert.match(result.text,/実行を開始できません/);
  }
});
