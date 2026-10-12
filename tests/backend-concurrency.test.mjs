import test from 'node:test';
import assert from 'node:assert/strict';
import {join,dirname} from 'node:path';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService} from '../codex-service.mjs';
import {createHandler} from '../server.mjs';

const mock=join(dirname(fileURLToPath(import.meta.url)),'fixtures/mock-app-server.mjs');

async function projects(t,env={}){
  const root=await mkdtemp(join(tmpdir(),'inventory-synthetic-projects-'));
  const alpha=join(root,'alpha'),beta=join(root,'beta');
  await mkdir(alpha);await mkdir(beta);
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000,
    env:{...process.env,MOCK_TURN_DELAY_MS:'4000',...env}});
  t.after(async()=>{client.close();await rm(root,{recursive:true,force:true});});
  const service=new CodexService(client,{autoDiscover:true,knownProjects:[alpha,beta]});
  await service.start();
  await service.selectProject(alpha);
  return {client,service,alpha,beta};
}

test('parallel workspaces keep their turn ownership through project switches and scoped stops',async t=>{
  const {service,alpha,beta}=await projects(t);
  const a=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const b=(await service.createThread({editing:true,workspace:beta})).thread.id;
  const [turnA,turnB]=await Promise.all([
    service.startTurn({threadId:a,prompt:'synthetic alpha',editing:true,workspace:alpha}),
    service.startTurn({threadId:b,prompt:'synthetic beta',editing:true,workspace:beta})
  ]);
  await service.selectProject(beta);
  assert.equal(service.running.get(a),turnA.turnId);
  assert.equal(service.running.get(b),turnB.turnId);
  await assert.rejects(()=>service.startTurn({threadId:a,prompt:'duplicate',workspace:alpha}),/実行中/);
  await assert.rejects(()=>service.interrupt(a,{workspace:beta,turnId:turnA.turnId}),{status:409});
  await assert.rejects(()=>service.interrupt(a,{workspace:alpha,turnId:turnB.turnId}),{status:409});
  assert.equal(service.running.get(a),turnA.turnId);
  await service.interrupt(a,{workspace:alpha,turnId:turnA.turnId});
  for(let i=0;i<40&&service.running.has(a);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(service.running.has(a),false);
  assert.equal(service.running.get(b),turnB.turnId);
  await service.interrupt(b,{workspace:beta,turnId:turnB.turnId});
});

test('explicit HTTP stop requires the current turn while legacy single-chat stop remains valid',async t=>{
  const {service,alpha}=await projects(t);
  const id=(await service.createThread({workspace:alpha})).thread.id;
  const turn=await service.startTurn({threadId:id,prompt:'synthetic stop',workspace:alpha});
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:alpha}));
  t.after(()=>{server.closeAllConnections?.();server.close();});
  const endpoint='http://127.0.0.1:'+port+'/api/threads/'+id+'/interrupt';
  const headers={'Content-Type':'application/json','X-Codex-Workspace':encodeURIComponent(alpha),
    'X-Codex-Workspace-Mode':'explicit'};
  const stop=body=>fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await stop({})).status,400);
  assert.equal((await stop({turnId:'stale-turn'})).status,409);
  assert.equal(service.running.get(id),turn.turnId);
  assert.equal((await stop({turnId:turn.turnId})).status,200);
  for(let i=0;i<40&&service.running.has(id);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(service.running.has(id),false);
  const next=await service.startTurn({threadId:id,prompt:'synthetic legacy stop',workspace:alpha});
  assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',
    'X-Codex-Workspace':encodeURIComponent(alpha)},body:'{}'})).status,200);
  assert.equal(typeof next.turnId,'string');
});

test('a stale completion for another turn cannot clear a current turn',async t=>{
  const {client,service,alpha}=await projects(t);
  const id=(await service.createThread({workspace:alpha})).thread.id;
  const started=await service.startTurn({threadId:id,prompt:'synthetic running',workspace:alpha});
  client.emit('notification',{method:'turn/completed',params:{threadId:id,
    turn:{id:'stale-other-turn',status:'completed'}}});
  assert.equal(service.running.get(id),started.turnId);
  client.emit('notification',{method:'turn/completed',params:{threadId:id,turn:{status:'completed'}}});
  assert.equal(service.running.get(id),started.turnId);
  await service.interrupt(id,{workspace:alpha,turnId:started.turnId});
});

test('parallel editing in one workspace reports a path-free conflict and clears it on stop',async t=>{
  const {service,alpha,beta}=await projects(t);
  const a=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const b=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const c=(await service.createThread({editing:true,workspace:beta})).thread.id;
  const turnA=await service.startTurn({threadId:a,prompt:'synthetic edit A',editing:true,workspace:alpha});
  assert.deepEqual(service.activityState().workspaceConflicts,[]);
  const [turnB,turnC]=await Promise.all([
    service.startTurn({threadId:b,prompt:'synthetic edit B',editing:true,workspace:alpha}),
    service.startTurn({threadId:c,prompt:'synthetic edit C',editing:true,workspace:beta})
  ]);
  const state=service.activityState();
  assert.deepEqual(state.workspaceConflicts,[{threadIds:[a,b],reason:'parallel-edits'}]);
  assert.equal(JSON.stringify(state).includes(alpha),false);
  assert.equal(JSON.stringify(state).includes(beta),false);
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:alpha}));
  t.after(()=>{server.closeAllConnections?.();server.close();});
  const response=await fetch('http://127.0.0.1:'+port+'/api/activity-state');
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).workspaceConflicts,state.workspaceConflicts);
  await service.interrupt(a,{workspace:alpha,turnId:turnA.turnId});
  for(let i=0;i<40&&service.running.has(a);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(service.activityState().workspaceConflicts,[]);
  await Promise.all([
    service.interrupt(b,{workspace:alpha,turnId:turnB.turnId}),
    service.interrupt(c,{workspace:beta,turnId:turnC.turnId})
  ]);
});

test('simultaneous approvals cannot be delivered to another thread or turn',async t=>{
  const {service,alpha,beta}=await projects(t,{MOCK_APPROVAL_REQUEST:'1'});
  const a=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const b=(await service.createThread({editing:true,workspace:beta})).thread.id;
  const requests=[];
  service.on('event',event=>{if(event.type==='approval-request')requests.push(event.approval);});
  const [turnA,turnB]=await Promise.all([
    service.startTurn({threadId:a,prompt:'synthetic alpha approval',editing:true,workspace:alpha}),
    service.startTurn({threadId:b,prompt:'synthetic beta approval',editing:true,workspace:beta})
  ]);
  for(let i=0;i<40&&requests.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(requests.length,2);
  const approvalA=requests.find(item=>item.threadId===a);
  const approvalB=requests.find(item=>item.threadId===b);
  assert.equal(approvalA.turnId,turnA.turnId);
  assert.equal(approvalB.turnId,turnB.turnId);
  assert.throws(()=>service.respondApproval({approvalId:approvalA.approvalId,
    decision:'accept',workspace:alpha,threadId:b,turnId:turnB.turnId,explicit:true}),{status:409});
  assert.throws(()=>service.respondApproval({approvalId:approvalA.approvalId,
    decision:'accept',workspace:beta,threadId:a,turnId:turnA.turnId,explicit:true}),{status:409});
  assert.throws(()=>service.respondApproval({approvalId:approvalA.approvalId,
    decision:'accept',workspace:alpha,explicit:true}),{status:400});
  service.respondApproval({approvalId:approvalA.approvalId,decision:'decline',workspace:alpha,
    threadId:a,turnId:turnA.turnId,explicit:true});
  service.respondApproval({approvalId:approvalB.approvalId,decision:'decline',workspace:beta,
    threadId:b,turnId:turnB.turnId,explicit:true});
  assert.deepEqual(service.listApprovals().approvals,[]);
});

test('legacy single-chat approval remains usable but ambiguous same-workspace approvals require context',async t=>{
  const {service,alpha}=await projects(t,{MOCK_APPROVAL_REQUEST:'1'});
  const a=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const b=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const [turnA,turnB]=await Promise.all([
    service.startTurn({threadId:a,prompt:'synthetic first approval',editing:true,workspace:alpha}),
    service.startTurn({threadId:b,prompt:'synthetic second approval',editing:true,workspace:alpha})
  ]);
  for(let i=0;i<40&&service.listApprovals().approvals.length<2;i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  const requests=service.listApprovals().approvals;
  assert.equal(requests.length,2);
  const first=requests.find(item=>item.threadId===a);
  const second=requests.find(item=>item.threadId===b);
  assert.throws(()=>service.respondApproval({approvalId:first.approvalId,
    decision:'accept',workspace:alpha}),{status:409});
  service.respondApproval({approvalId:first.approvalId,decision:'decline',workspace:alpha,
    threadId:a,turnId:turnA.turnId,explicit:true});
  assert.equal(service.listApprovals().approvals.length,1);
  service.respondApproval({approvalId:second.approvalId,decision:'decline',workspace:alpha});
  assert.deepEqual(service.listApprovals().approvals,[]);
  assert.equal(turnB.threadId,b);
});

test('reconnect restores an active synthetic turn and its workspace ownership',async t=>{
  const root=await mkdtemp(join(tmpdir(),'inventory-synthetic-reconnect-'));
  const workspace=join(root,'project'),store=join(root,'mock-store.json');
  await mkdir(workspace);
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000,
    env:{...process.env,MOCK_STORE_FILE:store,MOCK_TURN_DELAY_MS:'30000'}});
  t.after(async()=>{client.close();await rm(root,{recursive:true,force:true});});
  const service=new CodexService(client,{workspace});
  await service.start();
  const id=(await service.createThread({editing:true})).thread.id;
  const started=await service.startTurn({threadId:id,prompt:'synthetic reconnect',editing:true});
  const disconnected=new Promise(resolve=>client.once('disconnect',resolve));
  client.child.kill();
  await disconnected;
  assert.equal(service.running.has(id),false);
  await service.start();
  assert.equal(service.running.get(id),started.turnId);
  assert.deepEqual(service.activityState().runningThreadIds,[id]);
  await assert.rejects(()=>service.startTurn({threadId:id,prompt:'duplicate after reconnect',
    editing:true}),/実行中/);
  await assert.rejects(()=>service.interrupt(id,{workspace:root,turnId:started.turnId}),{status:409});
  await service.interrupt(id,{workspace,turnId:started.turnId});
});

test('late exit from an old App Server child cannot disconnect a replacement',async t=>{
  const {client,service}=await projects(t);
  const oldChild=client.child;
  const disconnected=new Promise(resolve=>client.once('disconnect',resolve));
  oldChild.kill();
  await disconnected;
  await service.start();
  const replacement=client.child;
  t.after(()=>replacement.kill());
  oldChild.emit('exit',0,null);
  assert.equal(client.closed,false);
  assert.equal((await client.request('model/list',{})).data[0].id,'mock-model');
});

test('thread creation refuses a workspace moved after model lookup',async t=>{
  const {client,service,alpha}=await projects(t);
  const moved=join(dirname(alpha),'alpha-moved');
  const original=client.request.bind(client);
  let changed=false;
  client.request=async(method,...args)=>{
    const result=await original(method,...args);
    if(method==='model/list'&&!changed){changed=true;await rename(alpha,moved);}
    return result;
  };
  await assert.rejects(()=>service.createThread({workspace:alpha}),{status:403});
  assert.equal((await service.listThreads({all:true})).threads.length,0);
});

test('turn start refuses a workspace moved after ownership validation',async t=>{
  const {client,service,alpha}=await projects(t);
  const id=(await service.createThread({workspace:alpha})).thread.id;
  const moved=join(dirname(alpha),'alpha-moved');
  const original=client.request.bind(client);
  let changed=false;
  client.request=async(method,...args)=>{
    const result=await original(method,...args);
    if(method==='model/list'&&!changed){changed=true;await rename(alpha,moved);}
    return result;
  };
  await assert.rejects(()=>service.startTurn({threadId:id,prompt:'synthetic request',workspace:alpha,
    model:'mock-model'}),{status:403});
  assert.equal(service.running.has(id),false);
  const record=await service.readThread(id);
  assert.deepEqual(record.messages,[]);
});

test('approval for an unknown turn is rejected while the target thread is starting',async t=>{
  const {client,service,alpha}=await projects(t);
  const id=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const original=client.request.bind(client);
  let entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  client.request=async(method,...args)=>{
    if(method==='turn/start'){entered();await gate;}
    return original(method,...args);
  };
  const starting=service.startTurn({threadId:id,prompt:'synthetic pending',editing:true,workspace:alpha});
  await waiting;
  client.emit('notification',{method:'turn/started',params:{threadId:id,
    turn:{id:'forged-turn',status:'inProgress'}}});
  const requestId=777;
  client.serverRequests.set(requestId,'item/commandExecution/requestApproval');
  client.emit('server-request',{id:requestId,method:'item/commandExecution/requestApproval',
    params:{threadId:id,turnId:'forged-turn',cwd:alpha,command:'echo synthetic'}});
  const approvals=service.listApprovals().approvals;
  const reservation=service.running.get(id);
  release();
  const turn=await starting;
  assert.deepEqual(approvals,[]);
  assert.deepEqual(service.listApprovals().approvals,[]);
  assert.equal(client.serverRequests.has(requestId),false);
  assert.equal(reservation,'starting');
  await service.interrupt(id,{workspace:alpha,turnId:turn.turnId});
});

test('stale completion cannot release a starting reservation for another turn',async t=>{
  const {client,service,alpha}=await projects(t);
  const id=(await service.createThread({workspace:alpha})).thread.id;
  const original=client.request.bind(client);
  let entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  client.request=async(method,...args)=>{
    if(method==='turn/start'){entered();await gate;}
    return original(method,...args);
  };
  const starting=service.startTurn({threadId:id,prompt:'synthetic pending',workspace:alpha});
  await waiting;
  client.emit('notification',{method:'turn/completed',params:{threadId:id,
    turn:{id:'stale-other-turn',status:'completed'}}});
  const reservation=service.running.get(id);
  release();
  const turn=await starting;
  assert.equal(reservation,'starting');
  await service.interrupt(id,{workspace:alpha,turnId:turn.turnId});
});

test('matching early completion survives a later stale completion before the start response',async t=>{
  const {client,service,alpha}=await projects(t);
  const id=(await service.createThread({workspace:alpha})).thread.id;
  const original=client.request.bind(client);
  let entered,release;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  client.request=async(method,...args)=>{
    const result=await original(method,...args);
    if(method==='turn/start'){entered(result.turn.id);await gate;}
    return result;
  };
  const starting=service.startTurn({threadId:id,prompt:'synthetic early completion',workspace:alpha});
  const actualTurnId=await waiting;
  client.emit('notification',{method:'turn/completed',params:{threadId:id,
    turn:{id:actualTurnId,status:'completed'}}});
  client.emit('notification',{method:'turn/completed',params:{threadId:id,
    turn:{id:'stale-other-turn',status:'completed'}}});
  release();
  await starting;
  assert.equal(service.running.has(id),false);
});

test('approval request cannot claim a foreign cwd or file grant root',async t=>{
  const {client,service,alpha,beta}=await projects(t);
  const id=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const turn=await service.startTurn({threadId:id,prompt:'synthetic pending',editing:true,workspace:alpha});
  const variants=[
    ['item/commandExecution/requestApproval',{cwd:beta,command:'echo synthetic'}],
    ['item/fileChange/requestApproval',{grantRoot:beta}]
  ];
  for(const [method,extra] of variants){
    const requestId=800+client.serverRequests.size;
    client.serverRequests.set(requestId,method);
    client.emit('server-request',{id:requestId,method,
      params:{threadId:id,turnId:turn.turnId,...extra}});
  }
  assert.deepEqual(service.listApprovals().approvals,[]);
  await service.interrupt(id,{workspace:alpha,turnId:turn.turnId});
});

test('duplicate App Server approval request IDs cannot create a second decision target',async t=>{
  const {service,alpha}=await projects(t,{MOCK_APPROVAL_REQUEST:'1',MOCK_DUP_APPROVAL_ID:'1'});
  const id=(await service.createThread({editing:true,workspace:alpha})).thread.id;
  const started=await service.startTurn({threadId:id,prompt:'synthetic duplicate',editing:true,workspace:alpha});
  for(let i=0;i<40&&!service.listApprovals().approvals.length;i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  await new Promise(resolve=>setTimeout(resolve,20));
  const approvals=service.listApprovals().approvals;
  assert.equal(approvals.length,1);
  service.respondApproval({approvalId:approvals[0].approvalId,decision:'decline',
    workspace:alpha,threadId:id,turnId:started.turnId,explicit:true});
  assert.deepEqual(service.listApprovals().approvals,[]);
});
