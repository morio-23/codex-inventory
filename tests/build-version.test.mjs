import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalBuildVersion,verifyLocalBuildVersion} from '../scripts/check-build-version.mjs';

test('v0.7 candidate versions, lockfiles and package targets agree',()=>{
  assert.equal(verifyLocalBuildVersion(),'0.7.0-beta.1');
});

const example=()=>({
  root:{name:'codex-inventory',version:'0.7.0-beta.1'},
  rootLock:{version:'0.7.0-beta.1',packages:{'':{name:'codex-inventory',version:'0.7.0-beta.1'}}},
  desktop:{name:'codex-inventory-desktop',version:'0.7.0-beta.1',build:{
    win:{target:['nsis','portable']},
    nsis:{artifactName:'CodexInventory-Setup-${version}-${arch}.${ext}'},
    portable:{artifactName:'CodexInventory-Portable-${version}-${arch}.${ext}'}
  }},
  desktopLock:{version:'0.7.0-beta.1',packages:{'':{name:'codex-inventory-desktop',version:'0.7.0-beta.1'}}},
  appServerSource:"clientInfo:{version:'0.7.0-beta.1'}"
});

test('version preflight rejects root and desktop disagreement',()=>{
  const p=example();p.desktop.version='0.6.0';
  assert.throws(()=>validateLocalBuildVersion(p),/BUILD_VERSION_MISMATCH/);
});

test('version preflight rejects stale root and desktop lockfiles',()=>{
  for(const name of ['rootLock','desktopLock']){
    for(const part of ['version','packages']){
      const p=example();
      if(part==='version')p[name].version='0.6.0';
      else p[name].packages[''].version='0.6.0';
      assert.throws(()=>validateLocalBuildVersion(p),/BUILD_VERSION_MISMATCH/);
    }
  }
});

test('preflight rejects missing or changed EXE target naming',()=>{
  for(const mode of ['target','artifact']){
    const p=example();
    if(mode==='target')p.desktop.build.win.target=['portable'];
    else p.desktop.build.nsis.artifactName='CodexInventory-Old-${version}.${ext}';
    assert.throws(()=>validateLocalBuildVersion(p),/BUILD_TARGET_MISMATCH/);
  }
});

test('preflight rejects stale App Server wire client version',()=>{
  const p=example();
  p.appServerSource="clientInfo:{version:'0.6.0'}";
  assert.throws(()=>validateLocalBuildVersion(p),/BUILD_RPC_CLIENT_VERSION_MISMATCH/);
});
