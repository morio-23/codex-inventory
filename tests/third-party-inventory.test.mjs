import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryFromLocks} from '../third-party-inventory.mjs';

test('license inventory includes nested and scoped dependencies and flags missing declarations',()=>{
  const report=inventoryFromLocks([{scope:'desktop',lock:{lockfileVersion:3,packages:{
    '':{name:'desktop',version:'1.0.0'},
    'node_modules/@vendor/tool':{version:'1.2.3',license:'MIT',dev:true},
    'node_modules/@vendor/tool/node_modules/child':{version:'2.3.4',optional:true},
    'node_modules/abc':{version:'2.0.0',license:'Apache-2.0'}
  }}}]);
  assert.deepEqual(report.packages.map(x=>x.name),['@vendor/tool','abc','child']);
  assert.equal(report.requiresReview,1);
  assert.equal(report.packages[0].dev,true);
  assert.equal(report.packages[2].declaredLicense,'REVIEW_REQUIRED');
});

test('malformed lockfile is rejected rather than counted as clear',()=>{
  assert.throws(()=>inventoryFromLocks([{scope:'root',lock:{packages:{}}}]),/malformed/);
});
