import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/v07-smoke-environment.ps1',import.meta.url));
const root=()=>join(tmpdir(),`codex-inventory-v07-smoke-${randomBytes(16).toString('hex')}`);
const run=(action,path,extra=[])=>spawnSync('powershell.exe',[
  '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
  '-Action',action,'-Root',path,...extra
],{encoding:'utf8',windowsHide:true,timeout:15_000});

test('synthetic smoke state can be prepared, checked and removed without launching Codex',
  {skip:process.platform!=='win32'},()=>{
    const path=root();
    try{
      const prepared=run('Prepare',path);
      assert.equal(prepared.status,0,'synthetic preparation failed');
      assert.equal(existsSync(join(path,'codex-home','config.toml')),true);
      assert.equal(existsSync(join(path,'workspace-a','README.txt')),true);
      assert.equal(existsSync(join(path,'workspace-b','README.txt')),true);
      for(const dir of ['profile','profile/AppData/Roaming','profile/AppData/Local','profile/ProgramData','profile/Temp']){
        assert.equal(existsSync(join(path,dir)),true,'synthetic profile missing '+dir);
      }
      assert.equal(existsSync(join(path,'codex-home','auth.json')),false);
      assert.equal(run('Verify',path).status,0,'synthetic verification failed');
      assert.equal(run('Cleanup',path).status!==0,true,'cleanup needs an explicit switch');
      const removed=run('Cleanup',path,['-ConfirmCleanup']);
      assert.equal(removed.status,0,'synthetic cleanup failed');
      assert.equal(existsSync(path),false);
      assert.equal((prepared.stdout+prepared.stderr+removed.stdout+removed.stderr).includes(path),false);
    }finally{
      if(existsSync(path))run('Cleanup',path,['-ConfirmCleanup']);
    }
  });

test('preflight rejects synthetic credential files and paths outside disposable temp',
  {skip:process.platform!=='win32'},()=>{
    const path=root();
    try{
      assert.equal(run('Prepare',path).status,0);
      const fakeAuth=join(path,'codex-home','auth.json');
      writeFileSync(fakeAuth,'{}');
      const rejected=run('Verify',path);
      assert.notEqual(rejected.status,0);
      assert.equal((rejected.stdout+rejected.stderr).includes(path),false);
      unlinkSync(fakeAuth);
      assert.equal(run('Verify',path).status,0);
      assert.notEqual(run('Cleanup',fileURLToPath(new URL('..',import.meta.url)),
        ['-ConfirmCleanup']).status,0);
      assert.equal(existsSync(script),true);
    }finally{
      if(existsSync(path))assert.equal(run('Cleanup',path,['-ConfirmCleanup']).status,0);
    }
  });
