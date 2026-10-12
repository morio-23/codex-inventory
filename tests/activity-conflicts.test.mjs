import test from 'node:test';
import assert from 'node:assert/strict';
import {conflictCandidates} from '../public/conflict-warning-state.js';

test('conflict candidates contain only distinct thread IDs from parallel editing groups',()=>{
  const result=conflictCandidates({workspaceConflicts:[
    {workspace:'/synthetic/private-project',threadIds:['thread-a','thread-b','thread-a'],reason:'parallel-edits'},
    {workspace:'/synthetic/other',threadIds:['thread-c'],reason:'parallel-edits'},
    {threadIds:['thread-d','thread-e'],reason:'unrecognized'}
  ]});
  assert.deepEqual(result,[['thread-a','thread-b']]);
  assert.equal(JSON.stringify(result).includes('/synthetic/'),false);
});
