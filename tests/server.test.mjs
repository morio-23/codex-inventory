import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService,taskInstructions} from '../codex-service.mjs';
import {createHandler,allowedRequest} from '../server.mjs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
process.env.CODEX_NO_LISTEN='1';
const mock=join(dirname(fileURLToPath(import.meta.url)),'fixtures/mock-app-server.mjs');
test('task presets exist but reset is a UI action',()=>{
  assert.equal('build' in taskInstructions,true);
  assert.equal('reset' in taskInstructions,false);
});
test('reject forged origins and hosts',()=>{
  assert.equal(allowedRequest({method:'POST',headers:{host:'evil.example:8765',origin:'http://evil.example:8765','content-type':'application/json'}},8765),false);
  assert.equal(allowedRequest({method:'POST',headers:{host:'127.0.0.1:8765',origin:'http://evil.example','content-type':'application/json'}},8765),false);
  assert.equal(allowedRequest({method:'POST',headers:{host:'127.0.0.1:8765',origin:'http://127.0.0.1:8765','content-type':'application/json'}},8765),true);
});
test('HTTP API returns native threads and quota, enforces input safety',async t=>{
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000});
  const service=new CodexService(client,{workspace:process.cwd()});
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port}));
  t.after(()=>{server.closeAllConnections();server.close();client.close();});
  const root=`http://127.0.0.1:${port}`;
  const req=(path,data)=>fetch(root+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const status=await (await fetch(root+'/api/status')).json();assert.equal(status.connected,true);
  const created=await req('/api/threads',{editing:false});assert.equal(created.status,201);
  const {thread}=await created.json();
  const listed=await (await fetch(root+'/api/threads')).json();assert.equal(listed.threads[0].id,thread.id);
  const usage=await (await fetch(root+'/api/usage')).json();assert.equal(usage.primary.usedPercent,28);
  const bad=await req('/api/threads/bad:injection/turn',{prompt:'hello',action:'quest',editing:false});assert.equal(bad.status,400);
  const blocked=await req('/api/threads/'+thread.id+'/turn',{prompt:'fix it',action:'fix',editing:false});assert.notEqual(blocked.status,202);
  const valid=await req('/api/threads/'+thread.id+'/turn',{prompt:'hello',action:'quest',editing:false});assert.equal(valid.status,202);
  const read=await (await fetch(root+'/api/threads/'+thread.id)).json();assert.equal(read.thread.id,thread.id);
});

test('HTTP turn rejection returns only bounded stage and numeric RPC metadata',async t=>{
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000});
  const service=new CodexService(client,{workspace:process.cwd()});
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port}));
  t.after(()=>{server.closeAllConnections();server.close();client.close();});
  const root='http://127.0.0.1:'+port;
  await service.start();
  const {thread}=await service.createThread();
  const original=client.request.bind(client);
  client.request=(method,params,options)=>{
    if(method==='turn/start'){
      const error=new Error('synthetic protocol refusal with private path');
      error.code=-32602;
      throw error;
    }
    return original(method,params,options);
  };
  const response=await fetch(root+'/api/threads/'+thread.id+'/turn',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({prompt:'synthetic content',action:'quest',editing:false})
  });
  assert.equal(response.status,503);
  const data=await response.json();
  assert.equal(data.turnStage,'TURN_START_RPC');
  assert.equal(data.rpcCode,-32602);
  assert.equal(service.running.size,0);
});
