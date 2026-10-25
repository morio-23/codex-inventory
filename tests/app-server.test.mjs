import test from 'node:test';
import assert from 'node:assert/strict';
import {join,dirname} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService,projectHistory,summarizeRateLimits,sameWorkspace} from '../codex-service.mjs';
const fake=join(dirname(fileURLToPath(import.meta.url)),'fixtures/mock-app-server.mjs');
async function harness(env={}){
  const client=new AppServerClient({command:process.execPath,args:[fake],timeoutMs:5000,env:{...process.env,...env}});
  const service=new CodexService(client,{workspace:process.cwd()});
  await service.start();
  return {client,service};
}
async function complete(service,id,action='quest'){
  if(!service.running.has(id))return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{service.off('event',handler);reject(new Error('turn timed out'));},3000);
    function handler(e){if(e.type==='codex'&&e.method==='turn/completed'&&e.threadId===id){clearTimeout(timer);service.off('event',handler);resolve();}}
    service.on('event',handler);
  });
}
test('JSON RPC handshake, thread creation and history retrieval',async t=>{
  const {client,service}=await harness();t.after(()=>client.close());
  const {thread}=await service.createThread({editing:false});
  assert.match(thread.id,/^mock-/);
  await service.startTurn({threadId:thread.id,prompt:'Hello Desktop',action:'quest',editing:false});
  await complete(service,thread.id);
  const data=await service.listThreads();
  assert.equal(data.threads.length,1);
  const read=await service.readThread(thread.id);
  assert.deepEqual(read.messages.map(m=>m.role),['user','assistant']);
  assert.match(read.messages[0].text,/Hello Desktop/);
  assert.match(read.messages[1].text,/App Server/);
});
test('v2 requests declare explicit review routing and complete text input shape',async t=>{
  const client=new AppServerClient({command:process.execPath,args:[fake],timeoutMs:5000});
  t.after(()=>client.close());
  const observed=new Map();
  const request=client.request.bind(client);
  client.request=(method,params,options)=>{
    if(['initialize','thread/start','turn/start'].includes(method))observed.set(method,params);
    return request(method,params,options);
  };
  const service=new CodexService(client,{workspace:process.cwd()});
  await service.start();
  const {thread}=await service.createThread();
  await service.startTurn({threadId:thread.id,prompt:'Synthetic contract input'});
  assert.equal(observed.get('initialize')?.capabilities?.requestAttestation,false);
  assert.equal(observed.get('thread/start')?.approvalsReviewer,'user');
  assert.equal(observed.get('turn/start')?.approvalsReviewer,'user');
  assert.deepEqual(observed.get('turn/start')?.input,[
    {type:'text',text:'Synthetic contract input',text_elements:[]}
  ]);
  // Official 0.144.5/0.164.0 v2 SandboxPolicy unions require networkAccess
  // for readOnly, and both excludeTmpdirEnvVar/excludeSlashTmp for
  // workspaceWrite. The old incomplete objects passed mocks but fail strict
  // real app-server deserialization before a Codex turn can begin.
  assert.deepEqual(observed.get('turn/start')?.sandboxPolicy,{
    type:'readOnly',networkAccess:false
  });
  await complete(service,thread.id);
  const {thread:editable}=await service.createThread({editing:true});
  await service.startTurn({threadId:editable.id,prompt:'Synthetic edit contract',editing:true});
  assert.deepEqual(observed.get('turn/start')?.sandboxPolicy,{
    type:'workspaceWrite',writableRoots:[process.cwd()],networkAccess:false,
    excludeTmpdirEnvVar:true,excludeSlashTmp:true
  });
  await complete(service,editable.id);
});

test('current command approval mock carries protocol correlation metadata',async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1'});
  t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>client.once('server-request',resolve));
  const started=await service.startTurn({threadId:thread.id,prompt:'Synthetic approval',editing:true});
  const approval=await requested;
  assert.equal(approval.method,'item/commandExecution/requestApproval');
  assert.equal(approval.params.threadId,thread.id);
  assert.equal(approval.params.turnId,started.turnId);
  assert.equal(approval.params.kind,'command');
  assert.equal(typeof approval.params.startedAtMs,'number');
  assert.equal(approval.params.environmentId,null);
  service.respondApproval({approvalId:service.listApprovals().approvals[0].approvalId,
    decision:'decline',workspace:process.cwd()});
  await complete(service,thread.id);
});

test('mock interrupt rejects a stale turn id and keeps the current turn',async t=>{
  const {client,service}=await harness({MOCK_TURN_DELAY_MS:'3000'});
  t.after(()=>client.close());
  const {thread}=await service.createThread();
  const started=await service.startTurn({threadId:thread.id,prompt:'Synthetic long turn'});
  await assert.rejects(()=>client.request('turn/interrupt',
    {threadId:thread.id,turnId:'synthetic-stale-turn'}));
  assert.equal(service.running.get(thread.id),started.turnId);
  await service.interrupt(thread.id,{turnId:started.turnId});
});

test('writeStdin approval fails closed without an actionable Inventory prompt',async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'writeStdin'});
  t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>client.once('server-request',resolve));
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){
      service.off('event',handler);resolve(e.params.turn);
    }
  }));
  await service.startTurn({threadId:thread.id,prompt:'Synthetic stdin approval',editing:true});
  await requested;
  assert.deepEqual(service.listApprovals().approvals,[]);
  assert.equal((await finished).status,'failed');
});
test('a newly created, unmaterialized thread has an empty readable history',async t=>{
  const {client,service}=await harness();t.after(()=>client.close());
  const {thread}=await service.createThread();
  const read=await service.readThread(thread.id);
  assert.equal(read.thread.id,thread.id);
  assert.deepEqual(read.messages,[]);
});
test('an empty rollout also has an empty readable history',async t=>{
  const {client,service}=await harness({MOCK_EMPTY_ROLLOUT:'1'});t.after(()=>client.close());
  const {thread}=await service.createThread();
  const read=await service.readThread(thread.id);
  assert.equal(read.thread.id,thread.id);
  assert.deepEqual(read.messages,[]);
});
test('two threads can run concurrently and each is protected against double run',async t=>{
  const {client,service}=await harness();t.after(()=>client.close());
  const a=(await service.createThread()).thread.id;
  const b=(await service.createThread()).thread.id;
  await Promise.all([
    service.startTurn({threadId:a,prompt:'Alpha'}),
    service.startTurn({threadId:b,prompt:'Beta'})
  ]);
  assert.equal(service.running.size,2);
  await assert.rejects(()=>service.startTurn({threadId:a,prompt:'not allowed'}),/実行中/);
  await Promise.all([complete(service,a),complete(service,b)]);
  assert.equal(service.running.size,0);
});
test('an externally active thread is not steered by a new Inventory turn',async t=>{
  const {client,service}=await harness({MOCK_TURN_DELAY_MS:'3000'});
  t.after(()=>client.close());
  const {thread}=await service.createThread();
  let turnStarts=0;
  const request=client.request.bind(client);
  client.request=(method,params,options)=>{
    if(method==='turn/start')turnStarts++;
    return request(method,params,options);
  };
  const external=await client.request('turn/start',{threadId:thread.id,cwd:process.cwd(),
    input:[{type:'text',text:'Synthetic external turn',text_elements:[]}],
    approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly',networkAccess:false}});
  await assert.rejects(()=>service.startTurn({threadId:thread.id,prompt:'Do not steer'}),{status:409});
  assert.equal(turnStarts,1);
  await client.request('turn/interrupt',{threadId:thread.id,turnId:external.turn.id});
});
test('rate limits show actual used percent and reset timestamps',async t=>{
  const {client,service}=await harness();t.after(()=>client.close());
  const usage=await service.usage();
  assert.equal(usage.primary.usedPercent,28);
  assert.equal(usage.primary.windowDurationMins,300);
  assert.equal(usage.secondary.usedPercent,47);
  assert.equal(usage.available,true);
  assert.equal(summarizeRateLimits({}).available,false);
});
test('project history ignores unknown item structures and preserves user/agent order',()=>{
  const values=projectHistory({turns:[{id:'a',items:[{type:'userMessage',content:[{type:'text',text:'hello'}]},{type:'tool',data:'ignore'},{type:'agentMessage',text:'world'}]}]});
  assert.deepEqual(values.map(x=>x.text),['hello','world']);
});
test('editing is gated and prompts are validated',async t=>{
  const {client,service}=await harness();t.after(()=>client.close());
  const id=(await service.createThread()).thread.id;
  await assert.rejects(()=>service.startTurn({threadId:id,prompt:'Fix',action:'fix',editing:false}),/編集許可/);
  await assert.rejects(()=>service.startTurn({threadId:id,prompt:'',action:'quest',editing:false}),/不正/);
  assert.equal(service.running.size,0);
});

test('workspace ownership is enforced before starting a Codex turn',async t=>{
  const {client,service}=await harness();t.after(()=>client.close());
  const other=join(process.cwd(),'other-workspace');
  const created=await client.request('thread/start',{cwd:other,approvalPolicy:'never',sandbox:'read-only',ephemeral:false,model:'mock-model'});
  const foreignId=created.thread.id;
  const view=await service.readThread(foreignId);
  assert.equal(view.thread.cwd,other);
  await assert.rejects(()=>service.startTurn({threadId:foreignId,prompt:'Do not execute this',action:'quest',editing:false}),/別プロジェクト/);
  const untouched=await client.request('thread/read',{threadId:foreignId,includeTurns:false});
  assert.equal(untouched.thread.turns.length,0);
  assert.equal(service.running.size,0);
  const own=(await service.createThread()).thread.id;
  await service.startTurn({threadId:own,prompt:'Own workspace is permitted',editing:false});
  await complete(service,own);
});
test('workspace matching is case insensitive for Windows paths and strict for foreign paths',()=>{
  assert.equal(sameWorkspace('F:\\CodexWorkSpace\\APP','f:/codexworkspace/app'),true);
  assert.equal(sameWorkspace('F:/work/one','F:/work/two'),false);
  assert.equal(sameWorkspace('/home/user/one','/home/user/two'),false);
  assert.equal(sameWorkspace(null,'/home/user/one'),false);
});

test('Codex command approvals remain pending until explicit one-shot user decision',async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1'});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const pending=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('approval not received')),2500);
    service.on('event',function handler(e){
      if(e.type==='approval-request'){clearTimeout(timeout);service.off('event',handler);resolve(e.approval);}
    });
  });
  const started=await service.startTurn({threadId:thread.id,prompt:'Approval test',editing:true});
  const approval=await pending;
  assert.equal(approval.threadId,thread.id);
  assert.equal(approval.turnId,started.turnId);
  assert.equal(approval.command,'echo APPROVAL_TEST');
  assert.equal(service.listApprovals().approvals.length,1);
  assert.throws(()=>service.respondApproval({
    approvalId:approval.approvalId,decision:'accept',workspace:'/another/workspace'
  }),{status:409});
  assert.equal(service.listApprovals().approvals.length,1);
  const result=service.respondApproval({
    approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()
  });
  assert.equal(result.decision,'accept');
  assert.throws(()=>service.respondApproval({
    approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()
  }),{status:409});
  await complete(service,thread.id);
  assert.equal(service.listApprovals().approvals.length,0);
});
for(const kind of ['command','file','permissions'])test(`expired ${kind} approval is rejected even before its timer callback runs`,async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:kind});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'Expired approval',editing:true});
  const approval=await requested;
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){
      service.off('event',handler);resolve(e.params.turn);
    }
  }));
  t.mock.method(Date,'now',()=>approval.expiresAt+1);
  assert.throws(()=>service.respondApproval({
    approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()
  }),{status:409});
  t.mock.restoreAll();
  assert.deepEqual(service.listApprovals().approvals,[]);
  assert.equal((await finished).status,'failed');
});
for(const kind of ['command','file','permissions'])test(`${kind} approval stays bound to its project across project switches`,async t=>{
  const other=await mkdtemp(join(tmpdir(),'codex-inventory-approval-project-'));
  t.after(()=>rm(other,{recursive:true,force:true}));
  const client=new AppServerClient({command:process.execPath,args:[fake],timeoutMs:5000,
    env:{...process.env,MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:kind}});
  t.after(()=>client.close());
  const service=new CodexService(client,{autoDiscover:true,knownProjects:[process.cwd(),other]});
  await service.start();
  await service.selectProject(process.cwd());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'Project switch approval',editing:true});
  const approval=await requested;
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){
      service.off('event',handler);resolve(e.params.turn);
    }
  }));
  await service.selectProject(other);
  assert.deepEqual(service.listApprovals(other).approvals,[]);
  assert.throws(()=>service.respondApproval({
    approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()
  }),{status:409});
  assert.equal(service.listApprovals(process.cwd()).approvals.length,1);
  await service.selectProject(process.cwd());
  service.respondApproval({approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()});
  assert.equal((await finished).status,'completed');
});
for(const kind of ['command','file','permissions'])test(`disconnect clears pending ${kind} approvals and a new connection can receive requests`,async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:kind});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'Before disconnect',editing:true});
  const approval=await requested;
  const disconnected=new Promise(resolve=>client.once('disconnect',resolve));
  client.child.kill();
  await disconnected;
  assert.deepEqual(service.listApprovals().approvals,[]);
  assert.throws(()=>service.respondApproval({
    approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()
  }),{status:409});
  await service.start();
  const replacement=(await service.createThread({editing:true})).thread;
  const nextRequest=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  await service.startTurn({threadId:replacement.id,prompt:'After reconnect',editing:true});
  const nextApproval=await nextRequest;
  assert.notEqual(nextApproval.approvalId,approval.approvalId);
  service.respondApproval({approvalId:nextApproval.approvalId,decision:'decline',workspace:process.cwd()});
  await complete(service,replacement.id);
});
for(const kind of ['command','file','permissions'])test(`${kind} approval rejection prevents execution and leaves no pending requests`,async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:kind});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const pending=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'Reject me',editing:true});
  const approval=await pending;
  service.respondApproval({approvalId:approval.approvalId,decision:'decline',workspace:process.cwd()});
  await complete(service,thread.id);
  assert.equal(service.listApprovals().approvals.length,0);
});

test('file-change approval sends supported Codex protocol decision',async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'file'});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){service.off('event',handler);resolve(e.params.turn);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'File approval',editing:true});
  const approval=await requested;
  assert.equal(approval.kind,'file');
  assert.equal(approval.grantRoot,process.cwd());
  service.respondApproval({approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()});
  assert.throws(()=>service.respondApproval({approvalId:approval.approvalId,decision:'accept',workspace:process.cwd()}),{status:409});
  assert.equal((await finished).status,'completed');
});
test('network permission approval uses granted profile/scope, not a command decision',async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'permissions'});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){service.off('event',handler);resolve(e.params.turn);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'Network permission',editing:true});
  const approval=await requested;
  assert.equal(approval.kind,'permissions');
  assert.deepEqual(approval.permissions.network,{enabled:true});
  service.respondApproval({approvalId:approval.approvalId,decision:'acceptForSession',workspace:process.cwd()});
  assert.throws(()=>service.respondApproval({approvalId:approval.approvalId,decision:'acceptForSession',workspace:process.cwd()}),{status:409});
  assert.equal((await finished).status,'completed');
});
test('network permission denial sends an empty permission profile',async t=>{
  const {client,service}=await harness({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'permissions'});t.after(()=>client.close());
  const {thread}=await service.createThread({editing:true});
  const requested=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='approval-request'){service.off('event',handler);resolve(e.approval);}
  }));
  const finished=new Promise(resolve=>service.on('event',function handler(e){
    if(e.type==='codex'&&e.method==='turn/completed'){service.off('event',handler);resolve(e.params.turn);}
  }));
  await service.startTurn({threadId:thread.id,prompt:'Network decline',editing:true});
  const approval=await requested;
  service.respondApproval({approvalId:approval.approvalId,decision:'decline',workspace:process.cwd()});
  assert.equal((await finished).status,'failed');
});

test('a mock RPC turn rejection is tagged with a precise safe stage',async t=>{
  const {client,service}=await harness({MOCK_FAIL_METHODS:'turn/start'});
  t.after(()=>client.close());
  const {thread}=await service.createThread();
  await assert.rejects(
    ()=>service.startTurn({threadId:thread.id,prompt:'synthetic read-only request',editing:false}),
    error=>{
      assert.equal(error.turnStage,'TURN_START_RPC');
      assert.equal(service.running.size,0);
      return true;
    });
});

test('failure before turn/start is tagged THREAD_RESUME without starting a turn',async t=>{
  const {client,service}=await harness();
  t.after(()=>client.close());
  const {thread}=await service.createThread();
  service.subscribed.delete(thread.id);
  const original=client.request.bind(client);
  let turnStarts=0;
  client.request=(method,params,options)=>{
    if(method==='thread/resume')throw new Error('synthetic private resume failure');
    if(method==='turn/start')turnStarts++;
    return original(method,params,options);
  };
  await assert.rejects(
    ()=>service.startTurn({threadId:thread.id,prompt:'synthetic no-op request',editing:false}),
    error=>error.turnStage==='THREAD_RESUME');
  assert.equal(turnStarts,0);
});

test('new turn uses metadata-only read when full history raises -32601',async t=>{
  const {client,service}=await harness({MOCK_PAGINATED_EMPTY_READ:'1'});
  t.after(()=>client.close());
  const {thread}=await service.createThread({editing:false});
  const reads=[];
  const request=client.request.bind(client);
  client.request=(method,params,options)=>{
    if(method==='thread/read')reads.push(params.includeTurns);
    return request(method,params,options);
  };
  // Reproduce real paginated-store behavior before any turn exists.
  await assert.rejects(()=>service.readThread(thread.id),
    error=>error.code===-32601 && /list_turns is not supported yet/.test(error.message));
  const created=await service.startTurn({
    threadId:thread.id,prompt:'Synthetic first read-only turn',editing:false});
  assert.ok(created.turnId);
  assert.deepEqual(reads,[true,false]);
  await complete(service,thread.id);
  const history=await service.readThread(thread.id);
  assert.equal(history.messages[0].role,'user');
});

test('failed metadata-only guard never calls turn/start or trusts cached thread ID',async t=>{
  const {client,service}=await harness();
  t.after(()=>client.close());
  const {thread}=await service.createThread({editing:false});
  const request=client.request.bind(client);
  let turnStarts=0;
  client.request=(method,params,options)=>{
    if(method==='thread/read'&&params.includeTurns===false){
      const error=new Error('unsupported metadata-only thread read');
      error.code=-32601;
      throw error;
    }
    if(method==='turn/start')turnStarts++;
    return request(method,params,options);
  };
  await assert.rejects(
    ()=>service.startTurn({threadId:thread.id,prompt:'Must not execute',editing:false}),
    error=>error.code===-32601&&error.turnStage==='THREAD_READ');
  assert.equal(turnStarts,0);
  assert.equal(service.running.size,0);
});
