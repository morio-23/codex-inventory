import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayLabels } from '../public/display-labels.js';

test('project labels are anonymous and retain their numbers across locale changes', () => {
  const labels = new DisplayLabels();
  const first = 'C:\\synthetic\\private-project-alpha';
  const second = '/synthetic/private-project-beta';

  assert.equal(labels.projectLabel(first, 'ja'), 'プロジェクト1');
  assert.equal(labels.projectLabel(second, 'ja'), 'プロジェクト2');
  assert.equal(labels.projectLabel(first, 'en'), 'Project 1');
  assert.equal(labels.projectLabel(second, 'en-US'), 'Project 2');
  assert.equal(labels.projectLabel(first), 'プロジェクト1');
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
