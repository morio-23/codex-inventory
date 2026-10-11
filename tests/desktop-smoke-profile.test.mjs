import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const {isolatedSmokeProfile}=require('../desktop/smoke-profile.cjs');

test('normal launch has no userData override',()=>{
  assert.equal(isolatedSmokeProfile({env:{},argv:[],tempRoot:tmpdir()}),null);
});

test('smoke override requires a flag and a path strictly inside the temp root',async t=>{
  const root=await mkdtemp(join(tmpdir(),'inventory-smoke-profile-'));
  const outside=await mkdtemp(join(tmpdir(),'inventory-smoke-outside-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
  const profile=join(root,'profile');
  assert.throws(()=>isolatedSmokeProfile({env:{CODEX_INVENTORY_SMOKE_PROFILE:profile},argv:[],tempRoot:root}),/isolated-smoke/);
  await assert.rejects(stat(profile),{code:'ENOENT'});
  assert.throws(()=>isolatedSmokeProfile({env:{CODEX_INVENTORY_SMOKE_PROFILE:outside},argv:['--inventory-isolated-smoke'],tempRoot:root}),/外です/);
  assert.throws(()=>isolatedSmokeProfile({env:{CODEX_INVENTORY_SMOKE_PROFILE:root},argv:['--inventory-isolated-smoke'],tempRoot:root}),/外です/);
  assert.equal(isolatedSmokeProfile({env:{CODEX_INVENTORY_SMOKE_PROFILE:profile},argv:['--inventory-isolated-smoke'],tempRoot:root}),profile);
  assert.equal((await stat(profile)).isDirectory(),true);
});

test('smoke override rejects symlink escapes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'inventory-smoke-link-'));
  const outside=await mkdtemp(join(tmpdir(),'inventory-smoke-target-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
  const redirect=join(root,'redirect');
  try{await symlink(outside,redirect,'dir');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('symlink creation unavailable');return;}throw error;}
  assert.throws(()=>isolatedSmokeProfile({env:{CODEX_INVENTORY_SMOKE_PROFILE:redirect},argv:['--inventory-isolated-smoke'],tempRoot:root}),/外です/);
});
