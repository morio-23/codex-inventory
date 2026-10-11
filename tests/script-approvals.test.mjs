import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScriptApprovalStore} from '../script-approvals.mjs';
import {createHandler} from '../server.mjs';

async function tempWorkspace(t){
  const dir=await mkdtemp(join(tmpdir(),'inventory-approvals-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'package.json'),JSON.stringify({
    name:'test-project',private:true,
    scripts:{test:'node -e "console.log(\'APPROVAL_PASS\')"',lint:'node --check package.json'}
  }));
  return dir;
}
test('approval capability is one-time, time-bound, and bound to a specific item and workspace',async t=>{
  const workspace=await tempWorkspace(t);
  let time=1000;
  const store=createScriptApprovalStore({now:()=>time,ttlMs:100,maxPending:8});
  const a=await store.issue('project-test',workspace);
  assert.match(a.approvalToken,/^[0-9a-f]{64}$/);
  assert.equal(a.command,'npm run test');
  assert.deepEqual(a.steps.map(x=>x.name),['test']);
  assert.equal(store.pendingCount(),1);
  assert.equal(store.consume('project-test',workspace,a.approvalToken).manifestHash,a.manifestHash);
  assert.equal(store.pendingCount(),0);
  assert.throws(()=>store.consume('project-test',workspace,a.approvalToken),{status:409});
  const b=await store.issue('project-test',workspace);
  assert.throws(()=>store.consume('project-lint',workspace,b.approvalToken),{status:409});
  assert.throws(()=>store.consume('project-test',workspace,b.approvalToken),{status:409});
  const c=await store.issue('project-test',workspace);
  assert.throws(()=>store.consume('project-test',workspace+'-other',c.approvalToken),{status:409});
  const d=await store.issue('project-test',workspace);
  time=1101;
  assert.throws(()=>store.consume('project-test',workspace,d.approvalToken),{status:409});
});
test('script tool rejects arbitrary tokens and only runs with one approved snapshot over HTTP',async t=>{
  const cwd=await tempWorkspace(t);
  const service=new EventEmitter();
  service.running=new Map();
  let codexTurns=0;
  service.startTurn=()=>{codexTurns++;throw Error('Codex must not run');};
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:cwd}));
  t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+port;
  const post=(id,input,origin)=>fetch(url+'/api/local-tools/'+id,{
    method:'POST',
    headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},
    body:JSON.stringify(input)
  });
  assert.equal((await post('project-test',{})).status,403);
  assert.equal((await post('project-test',{approved:true})).status,403);
  assert.equal((await post('project-test',{approvalToken:'f'.repeat(64)})).status,409);
  assert.equal((await post('project-test',{approved:true},'http://evil.example')).status,403);
  const previewResponse=await fetch(url+'/api/local-tools/project-test/preview');
  assert.equal(previewResponse.status,200);
  const preview=await previewResponse.json();
  assert.equal(preview.command,'npm run test');
  const accepted=await post('project-test',{approvalToken:preview.approvalToken});
  assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
  const output=await accepted.json();
  assert.equal(output.codexTurnStarted,false);
  assert.match(output.sections[0].output,/APPROVAL_PASS/);
  assert.equal((await post('project-test',{approvalToken:preview.approvalToken})).status,409);
  assert.equal(codexTurns,0);
});
test('HTTP approval refuses changed lifecycle scripts and does not run malicious replacement',async t=>{
  const cwd=await tempWorkspace(t);
  const service=new EventEmitter();service.running=new Map();
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:cwd}));
  t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+port;
  const preview=await (await fetch(url+'/api/local-tools/project-test/preview')).json();
  // A modified pretest hook must invalidate the old approval even when test is unchanged.
  await writeFile(join(cwd,'package.json'),JSON.stringify({
    name:'test-project',private:true,
    scripts:{pretest:'node -e "process.exit(78)"',test:'node -e "console.log(\'APPROVAL_PASS\')"'}
  }));
  const response=await fetch(url+'/api/local-tools/project-test',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({approvalToken:preview.approvalToken})
  });
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/変更されました/);
  const replay=await fetch(url+'/api/local-tools/project-test',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({approvalToken:preview.approvalToken})
  });
  assert.equal(replay.status,409);
});
