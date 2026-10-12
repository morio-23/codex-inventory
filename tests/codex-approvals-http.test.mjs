import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService} from '../codex-service.mjs';
import {createHandler} from '../server.mjs';

const mock=join(dirname(fileURLToPath(import.meta.url)),'fixtures/mock-app-server.mjs');

test('approval HTTP API is project-scoped, origin checked and one-shot',async t=>{
  const cwd=process.cwd();
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000,
    env:{...process.env,MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'command'}});
  t.after(()=>client.close());
  const service=new CodexService(client,{workspace:cwd});
  await service.start();
  const {thread}=await service.createThread({editing:true});

  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:cwd}));
  t.after(()=>{server.closeAllConnections?.();server.close();});
  const url='http://127.0.0.1:'+port;
  const headers={'X-Codex-Workspace':encodeURIComponent(cwd)};
  const post=(id,decision,origin=url)=>fetch(url+'/api/approvals/'+id+'/respond',{
    method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({decision})
  });
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){service.off('event',handler);resolve(e.params.turn);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'HTTP approval',editing:true});
  const approval=await requested;
  const pending=await fetch(url+'/api/approvals',{headers});
  assert.equal(pending.status,200);
  assert.equal((await pending.json()).approvals[0].approvalId,approval.approvalId);
  assert.equal((await post(approval.approvalId,'accept','http://invalid.test')).status,403);
  assert.equal((await post(approval.approvalId,'unknown')).status,400);
  assert.equal((await post(approval.approvalId,'accept')).status,200);
  assert.equal((await post(approval.approvalId,'accept')).status,409);
  assert.equal((await finished).status,'completed');
  assert.deepEqual((await (await fetch(url+'/api/approvals',{headers})).json()).approvals,[]);
});

test('explicit approval is bound to its own workspace and never follows active-project switch',async t=>{
  const {mkdtemp,mkdir,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const root=await mkdtemp(join(tmpdir(),'codex-approval-workspaces-'));
  const alpha=join(root,'alpha'),beta=join(root,'beta');
  await mkdir(alpha);await mkdir(beta);
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000,
    env:{...process.env,MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'command'}});
  t.after(async()=>{client.close();await rm(root,{recursive:true,force:true});});
  const service=new CodexService(client,{workspace:alpha,autoDiscover:true,knownProjects:[alpha,beta]});
  await service.start();
  await service.discoverProjects({force:true});
  await service.selectProject(alpha);
  const {thread}=await service.createThread({editing:true,workspace:beta});
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:alpha}));
  t.after(()=>{server.closeAllConnections?.();server.close();});
  const url='http://127.0.0.1:'+port;
  const headers=cwd=>({'X-Codex-Workspace':encodeURIComponent(cwd),
    'X-Codex-Workspace-Mode':'explicit'});
  const requested=new Promise(resolve=>service.on('event',function handler(event){
    if(event.type==='approval-request'){service.off('event',handler);resolve(event.approval);}
  }));
  const finished=new Promise(resolve=>service.on('event',function handler(event){
    if(event.type==='codex'&&event.method==='turn/completed'){
      service.off('event',handler);resolve(event.params.turn);
    }
  }));
  await service.startTurn({threadId:thread.id,prompt:'synthetic approval test',editing:true,workspace:beta});
  const approval=await requested;
  const pending=await fetch(url+'/api/approvals',{headers:headers(beta)});
  assert.equal((await pending.json()).approvals[0].approvalId,approval.approvalId);
  const reply=(cwd,decision,threadId=approval.threadId,turnId=approval.turnId)=>fetch(url+'/api/approvals/'+approval.approvalId+'/respond',{
    method:'POST',headers:{...headers(cwd),Origin:url,'Content-Type':'application/json'},
    body:JSON.stringify({decision,threadId,turnId})
  });
  assert.equal((await fetch(url+'/api/approvals/'+approval.approvalId+'/respond',{
    method:'POST',headers:{...headers(beta),Origin:url,'Content-Type':'application/json'},
    body:JSON.stringify({decision:'accept'})
  })).status,400,'explicit approval requires thread and turn context');
  assert.equal((await reply(beta,'accept','mock-other-thread',approval.turnId)).status,409);
  assert.equal((await reply(beta,'accept',approval.threadId,'other-turn')).status,409);
  assert.equal((await reply(alpha,'accept')).status,409,'cannot approve via another workspace');
  assert.equal((await reply(beta,'accept')).status,200,'owning workspace can explicitly approve');
  assert.equal((await reply(beta,'accept')).status,409,'one-shot approval cannot be replayed');
  assert.equal((await finished).status,'completed');
  assert.equal(service.workspace,alpha,'approval must not move the selected project');
});
