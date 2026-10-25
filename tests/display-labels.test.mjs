import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayLabels } from '../public/display-labels.js';

test('project labels use only the directory basename, not a private path',()=>{
  const labels=new DisplayLabels();
  const windows='C:\\Users\\synthetic\\CodexWorkSpace\\oshiport';
  const unix='/home/synthetic/work/knowledgehub';
  assert.equal(labels.projectLabel(windows,'ja'),'oshiport');
  assert.equal(labels.projectLabel(windows+'\\','en'),'oshiport');
  assert.equal(labels.projectLabel(unix,'en-US'),'knowledgehub');
  assert.equal(labels.projectLabel(unix,'ja'),'knowledgehub');
  assert.ok(!labels.projectLabel(windows).includes('Users'));
});

test('duplicate project basenames are disambiguated without revealing parents',()=>{
  const labels=new DisplayLabels();
  assert.equal(labels.projectLabel('C:\\first\\same'),'same');
  assert.equal(labels.projectLabel('D:\\second\\same'),'same (2)');
  assert.equal(labels.projectLabel('/third/SAME'),'SAME (3)');
  assert.equal(labels.projectLabel('C:\\first\\same'),'same');
});

test('invalid, root and control-character project folders have safe display labels',()=>{
  const labels=new DisplayLabels();
  assert.equal(labels.projectLabel('C:\\'),'プロジェクト1');
  assert.equal(labels.projectLabel('','en'),'Project 2');
  assert.equal(labels.projectLabel('C:\\synthetic\\test\u202e name'),'test name');
  assert.equal(labels.projectLabel('/synthetic/work/.','ja'),'プロジェクト3');
});

test('thread labels are anonymous, stable, and numbered separately from projects', () => {
  const labels = new DisplayLabels();
  labels.projectLabel('/synthetic/private-project-alpha', 'en');

  assert.equal(labels.threadLabel('synthetic-thread-private-alpha', 'en'), 'Chat 1');
  assert.equal(labels.threadLabel('synthetic-thread-private-beta', 'ja'), 'チャット2');
  assert.equal(labels.threadLabel('synthetic-thread-private-alpha', 'ja-JP'), 'チャット1');
  assert.equal(labels.threadLabel('synthetic-thread-private-beta', 'en-US'), 'Chat 2');
});

test('Codex thread name outranks the first-message preview and survives locale changes', () => {
  const labels = new DisplayLabels();
  const record = {id:'synthetic-thread-id',name:'Issue investigation',preview:'A different first message'};
  assert.equal(labels.threadLabel(record,'ja'),'Issue investigation');
  assert.equal(labels.threadLabel(record.id,'en'),'Issue investigation');
  assert.equal(labels.threadLabel({...record,name:'Updated by Codex'},'ja'),'Updated by Codex');
  assert.equal(labels.threadLabel(record.id,'ja'),'Updated by Codex');
});

test('untitled threads use their sanitized first user message and fall back to numbering', () => {
  const labels = new DisplayLabels();
  const id='synthetic-thread-untitled';
  assert.equal(labels.threadLabel({id,name:null,preview:'  日本語の修正依頼  \n  詳細'},'ja'),'日本語の修正依頼 詳細');
  assert.equal(labels.threadLabel(id,'en'),'日本語の修正依頼 詳細');
  assert.equal(labels.threadLabel({id:'new-empty',name:null,preview:''},'ja'),'チャット1');
  assert.equal(labels.threadLabel('new-empty','en'),'Chat 1');
  assert.equal(labels.threadLabel({id:'new-empty',name:null,preview:'First request'},'ja'),'First request');
});

test('titles strip non-printable and bidi controls and clip very long previews', () => {
  const labels = new DisplayLabels();
  const stripped=labels.threadLabel({id:'stripped',name:null,
    preview:'Auto prefix【ユーザー依頼】\n  Safe\u202e title\n here'},'ja');
  assert.equal(stripped,'Safe title here');
  const veryLong='a'.repeat(120);
  const shown=labels.threadLabel({id:'long',name:veryLong,preview:''});
  assert.equal(shown,'a'.repeat(80)+'…');
  assert.ok(!shown.includes('synthetic-thread-private-alpha'));
});

test('legacy thread display title can be read from saved user turns with no metadata',()=>{
  const labels=new DisplayLabels();
  const thread={id:'synthetic-legacy-thread',name:null,preview:''};
  assert.equal(labels.threadLabel(thread,'ja'),'チャット1');
  assert.equal(labels.rememberHistoryTitle(thread.id,[
    {role:'command',text:'SYNTHETIC_COMMAND'},
    {role:'assistant',text:'SYNTHETIC_ANSWER'},
    {role:'user',text:'  【ユーザー依頼】\n リポジトリの構成を調べて   '}
  ]),true);
  assert.equal(labels.threadLabel(thread,'ja'),'リポジトリの構成を調べて');
  assert.equal(labels.threadLabel(thread.id,'en'),'リポジトリの構成を調べて');
  assert.equal(labels.rememberHistoryTitle(thread.id,[{role:'user',text:'Ignored later'}]),false);
});

test('metadata takes precedence over history, empty list refresh never erases name',()=>{
  const labels=new DisplayLabels();
  const thread={id:'synthetic-title',name:null,preview:''};
  assert.equal(labels.rememberHistoryTitle(thread.id,[{role:'user',text:'Historical title'}]),true);
  assert.equal(labels.threadLabel(thread),'Historical title');
  assert.equal(labels.threadLabel({...thread,preview:'Preview title'}),'Preview title');
  assert.equal(labels.threadLabel({...thread,name:'Official name'}),'Official name');
  assert.equal(labels.threadLabel(thread),'Official name');
  assert.equal(labels.threadLabel({...thread,preview:'Different preview'}),'Official name');
});

test('assistant-only and empty saved histories do not invent a chat name',()=>{
  const labels=new DisplayLabels();
  const id='synthetic-empty';
  assert.equal(labels.rememberHistoryTitle(id,[]),false);
  assert.equal(labels.rememberHistoryTitle(id,[{role:'assistant',text:'Never use as title'}]),false);
  assert.equal(labels.threadLabel(id),'チャット1');
});
