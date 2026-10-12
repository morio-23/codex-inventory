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
