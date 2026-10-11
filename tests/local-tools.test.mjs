import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {listLocalTools,runLocalTool} from '../local-tools.mjs';
import {createHandler} from '../server.mjs';

const exec=promisify(execFile);
async function gitWorkspace(t){
  const cwd=await mkdtemp(join(tmpdir(),'codex-inventory-local-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  await exec('git',['init','--quiet',cwd]);
  return cwd;
}
test('catalog labels local cost and approval requirements',()=>{
  const items=listLocalTools();
  assert.ok(items.length>=8);
  assert.equal(new Set(items.map(x=>x.id)).size,items.length);
  for(const item of items){
    assert.equal(item.executionKind,'local');
    assert.equal(item.readOnly,!item.approvalCommand);
    assert.match(item.costLabel,/Codex利用枠/);
  }
  assert.equal(items.filter(item=>item.approvalCommand).length,2);
});
test('read-only Git tools inspect staged, unstaged and untracked files',async t=>{
  const cwd=await gitWorkspace(t);
  await writeFile(join(cwd,'日本語.txt'),'sample');
  const untracked=await runLocalTool('git-untracked',{workspace:cwd});
  assert.equal(untracked.codexTurnStarted,false);
  assert.match(untracked.sections[0].output,/日本語.txt/);
  await exec('git',['add','--','日本語.txt'],{cwd});
  const staged=await runLocalTool('git-staged',{workspace:cwd});
  assert.match(staged.sections[1].output,/日本語.txt/);
  const status=await runLocalTool('git-status',{workspace:cwd});
  assert.match(status.sections[0].output,/日本語.txt/);
  const tracked=await runLocalTool('tracked-files',{workspace:cwd});
  assert.match(tracked.sections[0].output,/日本語.txt/);
  assert.ok(status.elapsedMs>=0);
});
test('fixed Git command is enforced even when a malicious item ID is requested',async t=>{
  const cwd=await gitWorkspace(t);
  let invoked=0;
  const executor=async(command,args,options)=>{
    invoked++;
    assert.equal(command,'git');
    assert.equal(options.shell,false);
    assert.equal(options.cwd,cwd);
    assert.equal(args.some(x=>x.includes(';')||x.includes('&&')),false);
    return {stdout:'ok'};
  };
  await assert.rejects(()=>runLocalTool('git-status;rm -rf /',{workspace:cwd,executor}),/未対応/);
  assert.equal(invoked,0);
  const result=await runLocalTool('git-history',{workspace:cwd,executor});
  assert.equal(result.codexTurnStarted,false);
  assert.equal(invoked,1);
});
test('local tools HTTP endpoint never calls Codex turn/start and cannot take shell arguments',async t=>{
  const cwd=await gitWorkspace(t);
  await writeFile(join(cwd,'demo.txt'),'demo');
  const service=new EventEmitter();
  service.running=new Map();
  let codexCalls=0;
  service.startTurn=()=>{codexCalls++;throw Error('Unexpected Codex call');};
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:cwd}));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+port;
  const listing=await (await fetch(base+'/api/items')).json();
  assert.ok(listing.items.some(x=>x.id==='git-status'));
  const post=async(id,body)=>fetch(base+'/api/local-tools/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const ok=await post('git-untracked',{});
  assert.equal(ok.status,200);
  const data=await ok.json();
  assert.match(data.sections[0].output,/demo.txt/);
  assert.equal(data.codexTurnStarted,false);
  assert.equal(codexCalls,0);
  const invalid=await post('git-untracked',{command:'rm -rf /'});
  assert.equal(invalid.status,400);
  const unknown=await post('not-an-item',{});
  assert.equal(unknown.status,404);
  assert.equal(codexCalls,0);
});
