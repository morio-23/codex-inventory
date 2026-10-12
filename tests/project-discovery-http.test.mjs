import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService} from '../codex-service.mjs';
import {createHandler} from '../server.mjs';

const mock=fileURLToPath(new URL('./fixtures/mock-app-server.mjs',import.meta.url));
async function httpHarness(t,{empty=false,unicode=false}={}){
  const root=await mkdtemp(join(tmpdir(),'inventory-project-http-'));
  const alpha=join(root,unicode?'日本語 🧪 100% alpha':'alpha'),
    beta=join(root,unicode?'別プロジェクト 🏯':'beta');
  await mkdir(alpha);await mkdir(beta);
  await writeFile(join(alpha,'README.md'),'ALPHA_PROJECT_MARKER');
  await writeFile(join(beta,'README.md'),'BETA_PROJECT_MARKER');
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000});
  const service=new CodexService(client,{workspace:root,autoDiscover:true});
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port,workspace:null}));
  t.after(async()=>{server.closeAllConnections();server.close();client.close();await rm(root,{recursive:true,force:true});});
  await service.start();
  async function create(cwd){return client.request('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only',ephemeral:false,model:'mock-model'});}
  const first=empty?null:await create(alpha),second=empty?null:await create(beta);
  const url='http://127.0.0.1:'+port;
  const post=(path,data,expected=service.workspace)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',Origin:url,...(expected?{'X-Codex-Workspace':encodeURIComponent(expected)}:{})},body:JSON.stringify(data)});
  return {root,alpha,beta,client,service,url,post,first,second};
}
test('no project in App Server history never falls back to Inventory current directory',async t=>{
  const {url,post}=await httpHarness(t,{empty:true});
  const status=await (await fetch(url+'/api/status')).json();
  assert.equal(status.connected,true);
  assert.equal(status.workspace,null);
  assert.equal(status.projectCount,0);
  const projects=await (await fetch(url+'/api/projects')).json();
  assert.deepEqual(projects.projects,[]);
  assert.equal((await post('/api/threads',{editing:false})).status,409);
  assert.equal((await post('/api/local-tools/project-preview',{})).status,409);
  assert.equal((await fetch(url+'/api/diff')).status,409);
});
test('projects API exposes grouped App Server cwd and switches all scoped operations',async t=>{
  const {url,post,alpha,beta,first,second}=await httpHarness(t);
  const status=await (await fetch(url+'/api/status')).json();
  assert.equal(status.autoDiscover,true);
  assert.equal(status.projectCount,2);
  const result=await (await fetch(url+'/api/projects')).json();
  assert.equal(result.projects.length,2);
  assert.ok(result.projects.every(p=>p.exists));
  const invalid=await post('/api/projects/select',{cwd:'/not-listed'});
  assert.equal(invalid.status,403);
  // Stale browser tabs cannot use the new active project inadvertently.
  const update=await post('/api/projects/select',{cwd:beta});
  assert.equal(update.status,200);
  assert.equal((await update.json()).workspace,beta);
  const stale=await post('/api/local-tools/project-preview',{},alpha);
  assert.equal(stale.status,409);
  const listed=await (await fetch(url+'/api/threads')).json();
  assert.deepEqual(listed.threads.map(x=>x.id),[second.thread.id]);
  const read=await post('/api/local-tools/project-preview',{});
  assert.equal(read.status,200);
  assert.match(JSON.stringify(await read.json()),/BETA_PROJECT_MARKER/);
  const denied=await post('/api/threads/'+first.thread.id+'/turn',{prompt:'foreign',action:'quest',editing:false});
  assert.equal(denied.status,409);
  const created=await post('/api/threads',{editing:false});
  assert.equal(created.status,201);
  assert.equal((await created.json()).thread.cwd,beta);
  await post('/api/projects/select',{cwd:alpha});
  const preview=await post('/api/local-tools/project-preview',{});
  assert.match(JSON.stringify(await preview.json()),/ALPHA_PROJECT_MARKER/);
});
test('switch requests reject invalid structure, discovery never trusts arbitrary posted path',async t=>{
  const {url,post,alpha}=await httpHarness(t);
  await fetch(url+'/api/status');
  assert.equal((await post('/api/projects/select',{})).status,400);
  assert.equal((await post('/api/projects/select',{cwd:alpha,extra:1})).status,400);
  assert.equal((await post('/api/projects/select',{cwd:'../../'})).status,403);
  assert.equal((await post('/api/projects/select',{cwd:''})).status,400);
});


test('model catalog API lists supported effort values and rejects incompatible turn overrides',async t=>{
  const {url,post,first,alpha,service}=await httpHarness(t);
  const modelsResponse=await fetch(url+'/api/models');
  assert.equal(modelsResponse.status,200);
  const catalog=await modelsResponse.json();
  assert.equal(catalog.defaultModel,'mock-model');
  assert.deepEqual(catalog.models.map(x=>x.id),['mock-model','mock-deep']);
  assert.deepEqual(catalog.models[1].efforts.map(x=>x.id),['high','xhigh','ultra']);
  // The model catalog is readable without an active project, but a turn is
  // intentionally rejected until the caller selects its owning workspace.
  const noProject=await post('/api/threads/'+first.thread.id+'/turn',{
    prompt:'MUST NOT RUN',action:'quest',editing:false,
    model:'mock-deep',effort:'low'
  });
  assert.equal(noProject.status,409);
  assert.match((await noProject.json()).error,/プロジェクトを選択/);

  // Select the actual owner of the existing thread so the request reaches
  // model/effort capability validation (400), not workspace protection (409).
  const selected=await post('/api/projects/select',{cwd:alpha});
  assert.equal(selected.status,200);
  assert.equal((await selected.json()).workspace,alpha);

  const bad=await post('/api/threads/'+first.thread.id+'/turn',{
    prompt:'Not supported',action:'quest',editing:false,
    model:'mock-deep',effort:'low'
  });
  assert.equal(bad.status,400);
  assert.match((await bad.json()).error,/対応していません/);
  assert.equal(service.running.size,0);
  const malformed=await post('/api/threads/'+first.thread.id+'/turn',{
    prompt:'Malformed',action:'quest',editing:false,
    model:['mock-deep'],effort:'high'
  });
  assert.equal(malformed.status,400);
  const created=await post('/api/threads',{editing:false,model:'mock-deep',effort:'ultra'});
  assert.equal(created.status,201);
  const illegal=await post('/api/threads',{editing:false,model:'mock-deep',effort:'low'});
  assert.equal(illegal.status,400);
});


test('Unicode workspace headers round-trip through fetch and reject stale or malformed paths',async t=>{
  const {url,post,alpha,beta,first,service}=await httpHarness(t,{unicode:true});
  assert.match(alpha,/日本語/);
  assert.ok(/[^\x00-\x7F]/.test(alpha));
  assert.equal(decodeURIComponent(encodeURIComponent(alpha)),alpha);
  assert.ok([...encodeURIComponent(alpha)].every(char=>char.charCodeAt(0)<128));

  const selected=await post('/api/projects/select',{cwd:alpha});
  assert.equal(selected.status,200);
  assert.equal(service.workspace,alpha);

  const preview=await post('/api/local-tools/project-preview',{});
  assert.equal(preview.status,200);
  assert.match(JSON.stringify(await preview.json()),/ALPHA_PROJECT_MARKER/);

  const created=await post('/api/threads',{editing:false});
  assert.equal(created.status,201);
  assert.equal((await created.json()).thread.cwd,alpha);

  // Other projects must never pass ownership checks even with valid encoding.
  const stale=await post('/api/threads/'+first.thread.id+'/turn',{
    prompt:'MUST NOT RUN',action:'quest',editing:false
  },beta);
  assert.equal(stale.status,409);

  // Malformed percent sequences cannot be decoded and must fail closed.
  const malformed=await fetch(url+'/api/threads',{
    method:'POST',
    headers:{'Content-Type':'application/json',Origin:url,'X-Codex-Workspace':'%E3%81%ZZ'},
    body:JSON.stringify({editing:false})
  });
  assert.equal(malformed.status,409);

  // A valid Unicode workspace may still send turns through the API.
  // The mock executes only a synthetic Codex turn, never real credentials.
  const turn=await post('/api/threads/'+first.thread.id+'/turn',{
    prompt:'Unicode workspace mock turn',action:'quest',editing:false
  });
  assert.equal(turn.status,202);
});

test('explicit workspace-scoped requests can operate across projects without changing the active picker',async t=>{
  const {url,post,first,second,alpha,beta,root,service}=await httpHarness(t);
  const selection=await post('/api/projects/select',{cwd:alpha});
  assert.equal(selection.status,200);
  const explicit=(route,cwd,body)=>fetch(url+route,{
    method:'POST',
    headers:{'content-type':'application/json',Origin:url,
      'X-Codex-Workspace':encodeURIComponent(cwd),'X-Codex-Workspace-Mode':'explicit'},
    body:JSON.stringify(body)
  });
  const cross=await explicit('/api/threads/'+first.thread.id+'/turn',beta,
    {prompt:'must reject',action:'quest',editing:false});
  assert.equal(cross.status,409,'cannot run another workspace thread');
  const outside=await explicit('/api/threads',root,{editing:false});
  assert.equal(outside.status,403,'unregistered parent folder is not a valid workspace');
  const [a,b]=await Promise.all([
    explicit('/api/threads/'+first.thread.id+'/turn',alpha,{prompt:'demo alpha',action:'quest',editing:false}),
    explicit('/api/threads/'+second.thread.id+'/turn',beta,{prompt:'demo beta',action:'quest',editing:false})
  ]);
  assert.equal(a.status,202);
  assert.equal(b.status,202);
  assert.equal(service.workspace,alpha,'explicit requests must not change the project picker');
  const legacy=await post('/api/threads',{editing:false});
  assert.equal(legacy.status,201);
  assert.equal((await legacy.json()).thread.cwd,alpha,'legacy request remains bound to selected project');
});
