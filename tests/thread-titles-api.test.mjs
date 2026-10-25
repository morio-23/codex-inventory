import test from 'node:test';
import assert from 'node:assert/strict';
import {simplifyThread} from '../codex-service.mjs';

test('list and read simplification preserves Codex user-facing name',()=>{
  const raw={id:'synthetic-id',cwd:'C:\\synthetic',preview:'first message',
    name:'Manual title',createdAt:120,updatedAt:130,status:{type:'idle'}};
  const result=simplifyThread(raw);
  assert.equal(result.id,raw.id);
  assert.equal(result.name,'Manual title');
  assert.equal(result.preview,'first message');
  assert.equal(result.cwd,raw.cwd);
});

test('unnamed and older Codex thread records keep preview fallback',()=>{
  const result=simplifyThread({id:'synthetic-legacy',preview:'first request'});
  assert.equal(result.name,null);
  assert.equal(result.preview,'first request');
  assert.equal(simplifyThread({id:'synthetic-empty'}).name,null);
  assert.equal(simplifyThread({id:'synthetic-empty'}).preview,'');
});
