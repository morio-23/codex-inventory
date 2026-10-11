import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {codexCandidates,commandForCandidate,detectCodex,probeExecutable,findDesktopCodexBinaries} from '../desktop/codex-detect.mjs';

function sampleEnv(){
  return {
    USERPROFILE:'C:\\Users\\tester',
    APPDATA:'C:\\Users\\tester\\AppData\\Roaming',
    LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local',
    Path:'C:\\Tools;C:\\Windows\\System32',
    SCOOP:'C:\\Users\\tester\\scoop'
  };
}
test('Windows Codex discovery covers PATH, standalone, Scoop, WinGet, npm globals',()=>{
  const items=codexCandidates({env:sampleEnv(),platform:'win32'});
  for(const part of ['Tools','WinGet','npm','nodejs-lts','.local','shims']){
    assert.ok(items.some(path=>path.includes(part)),part+' should be scanned');
  }
  assert.equal(new Set(items).size,items.length);
  assert.ok(items.every(path=>/\.(?:exe|cmd|bat)$/i.test(path)));
});
test('manual override retains the selected path and is probed first',async()=>{
  const env=sampleEnv();
  const manuallySelected=join('/tmp','test-codex.exe');
  const inspected=[];
  const chosen=await detectCodex({env,platform:'win32',preferred:manuallySelected,
    exists:async path=>path===manuallySelected,
    probe:async(cmd,args,opts)=>{
      inspected.push([cmd,args,opts.env]);
      return {ok:true,version:'codex-cli 0.144.6'};
    }
  });
  assert.equal(chosen.path,manuallySelected);
  assert.equal(chosen.version,'codex-cli 0.144.6');
  assert.deepEqual(inspected[0][1],['--version']);
  assert.equal(chosen.command,manuallySelected);
});
test('a manually selected CLI path is never redirected to the running drive',()=>{
  const env=sampleEnv();
  // A drive-relative root path can be returned by path.join() on Windows.
  // Preserve it rather than silently converting it to C:\ or another drive.
  const selected=join('/tmp','test-codex.exe');
  const values=codexCandidates({env,platform:'win32',preferred:selected});
  assert.equal(values[0],selected);
});
test('the actual Codex GUI is never accepted as a CLI sidecar, regardless of version probe',async t=>{
  const root=await mkdtemp(join(tmpdir(),'codex-gui-safety-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const resources=join(root,'Programs','Codex','resources');
  await mkdir(resources,{recursive:true});
  await writeFile(join(resources,'Codex.exe'),'GUI application');
  await writeFile(join(resources,'codex.exe'),'lowercase executable in resources root');
  const env={LOCALAPPDATA:root,USERPROFILE:root,Path:''};
  const sidecars=await findDesktopCodexBinaries({env,platform:'win32'});
  assert.deepEqual(sidecars,[]);
});

test('absent or incompatible Codex CLI returns a recoverable detection result',async()=>{
  const env=sampleEnv();
  const item=codexCandidates({env,platform:'win32'})[0];
  const result=await detectCodex({env,platform:'win32',
    exists:async path=>path===item,
    probe:async()=>({ok:false,version:'not codex'})
  });
  assert.equal(result.path,null);
  assert.equal(result.failures.length,1);
  assert.equal(result.failures[0].path,item);
});
test('npm .cmd wrapper is invoked by fixed command name and a scoped PATH',()=>{
  const env=sampleEnv();
  const full=join('/tmp','npm','codex.cmd');
  const result=commandForCandidate(full,{env,platform:'win32'});
  assert.equal(result.command,'codex.cmd');
  assert.ok(result.env.PATH.startsWith(join('/tmp','npm')));
  assert.throws(()=>commandForCandidate(join('/tmp','npm','random.cmd'),{env,platform:'win32'}));
  assert.throws(()=>commandForCandidate(join('/tmp','danger.ps1'),{env,platform:'win32'}));
});
test('CLI version probe returns version only for a valid Codex CLI response',async()=>{
  const spawnProcess=(_cmd,_args)=>({
    stdout:{on(_evt,cb){queueMicrotask(()=>cb(Buffer.from('codex-cli 0.154.0\n')));}},
    stderr:{on(){}},
    once(event,cb){if(event==='close')setTimeout(()=>cb(0),10);},
    kill(){}
  });
  const r=await probeExecutable('fake',['--version'],{spawnProcess,timeoutMs:500});
  assert.equal(r.ok,true);
  assert.match(r.version,/codex-cli 0.154.0/);
});
test('cross-platform wrapper ignores non-Windows locations',()=>{
  assert.deepEqual(codexCandidates({env:sampleEnv(),platform:'linux'}),[]);
});

test('Codex Desktop embedded CLI sidecar is found only in targeted bounded resources folders',async t=>{
  const root=await mkdtemp(join(tmpdir(),'codex-desktop-detect-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const dir=join(root,'Programs','Codex','resources','app.asar.unpacked','bin');
  await mkdir(dir,{recursive:true});
  const binary=join(dir,'codex.exe');
  await writeFile(binary,'a fixture; not an executable');
  await writeFile(join(root,'Programs','Codex','resources','Codex.exe'),'GUI app, never use as CLI');
  const env={LOCALAPPDATA:root,Path:'',USERPROFILE:root};
  const found=await findDesktopCodexBinaries({env,platform:'win32'});
  assert.deepEqual(found,[binary]);
  const result=await detectCodex({env,platform:'win32',
    probe:async()=>({ok:true,version:'codex-cli 0.160.0'})
  });
  assert.equal(result.path,binary);
});

test('Microsoft Store Codex App local cache binary can be detected without standalone Codex CLI',async t=>{
  const root=await mkdtemp(join(tmpdir(),'codex-store-cache-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const pkg=join(root,'Packages','OpenAI.Codex_2p2nqsd0c76g0');
  const extracted=join(pkg,'LocalCache','Local','OpenAI','Codex','bin','a1b2c3d4');
  const direct=join(pkg,'LocalCache','Local','OpenAI','Codex','bin');
  await mkdir(extracted,{recursive:true});
  const cached=join(extracted,'codex.exe');
  const cachedDirect=join(direct,'codex.exe');
  await writeFile(cached,'fixture executable');
  await writeFile(cachedDirect,'fixture executable');
  const env={LOCALAPPDATA:root,USERPROFILE:root,Path:''};
  const found=await findDesktopCodexBinaries({env,platform:'win32'});
  assert.ok(found.includes(cached),'hashed Store runtime');
  assert.ok(found.includes(cachedDirect),'top-level Store runtime');
  const selected=await detectCodex({env,platform:'win32',
    probe:async(cmd,args)=>({
      ok:cmd===cached,version:'codex-cli 0.160.0'
    })
  });
  assert.equal(selected.path,cached);
  assert.equal(selected.command,cached);
});
test('Desktop cache discovery never treats Codex GUI or unrelated Store applications as an App Server',async t=>{
  const root=await mkdtemp(join(tmpdir(),'codex-store-negative-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'Packages','Unrelated.App_123','LocalCache','Local','OpenAI','Codex','bin');
  const gui=join(root,'Programs','Codex','resources');
  await mkdir(app,{recursive:true});await mkdir(gui,{recursive:true});
  await writeFile(join(app,'codex.exe'),'unrelated');
  await writeFile(join(gui,'Codex.exe'),'GUI executable, not a codex CLI');
  const candidates=await findDesktopCodexBinaries({
    env:{LOCALAPPDATA:root,USERPROFILE:root,Path:''},platform:'win32'
  });
  assert.deepEqual(candidates,[]);
});

test('Codex candidate fallback omits a previously probed but nonworking binary',async()=>{
  const env=sampleEnv();
  const existing=codexCandidates({env,platform:'win32'}).slice(0,2);
  const result=await detectCodex({
    env,platform:'win32',excluded:[existing[0]],
    exists:async name=>existing.includes(name),
    probe:async()=>({ok:true,version:'codex-cli 0.145.0'})
  });
  assert.equal(result.path,existing[1]);
});
