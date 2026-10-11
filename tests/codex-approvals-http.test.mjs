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
