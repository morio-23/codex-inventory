import test from 'node:test';
import assert from 'node:assert/strict';
import {listPromptTemplates} from '../prompt-templates.mjs';

test('all builtin templates have unique identities and editable content',()=>{
  const items=listPromptTemplates();
  assert.equal(items.length,16);
  assert.equal(new Set(items.map(x=>x.id)).size,16);
  for(const item of items){
    assert.ok(item.title&&item.body&&item.description);
    assert.equal(item.executionKind,'template');
    assert.equal(item.source,'builtin');
    assert.match(item.costLabel,/消費なし/);
    for(const variable of item.variables)assert.ok(item.body.includes('{'+variable+'}'));
  }
});
test('template objects are copies, not mutable builtin definitions',()=>{
  const copy=listPromptTemplates();
  const before=copy[0].body;
  copy[0].body='malicious';
  copy[0].variables.push('malicious');
  const next=listPromptTemplates();
  assert.equal(next[0].body,before);
  assert.equal(next[0].variables.includes('malicious'),false);
});
