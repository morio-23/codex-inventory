import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService,sameWorkspace} from '../codex-service.mjs';

const fake=fileURLToPath(new URL('./fixtures/mock-app-server.mjs',import.meta.url));
async function setup(t){
  const root=await mkdtemp(join(tmpdir(),'inventory-project-test-'));
  const alpha=join(root,'alpha'),beta=join(root,'beta'),missing=join(root,'not-installed');
  await mkdir(alpha);await mkdir(beta);
  await writeFile(join(alpha,'README.md'),'alpha');
  await writeFile(join(beta,'README.md'),'beta');
  const client=new AppServerClient({command:process.execPath,args:[fake],timeoutMs:6000});
  const service=new CodexService(client,{autoDiscover:true,workspace:root});
  t.after(async()=>{client.close();await rm(root,{recursive:true,force:true});});
  await service.start();
  const add=async cwd=>client.request('thread/start',{
    cwd,approvalPolicy:'never',sandbox:'read-only',ephemeral:false,model:'mock-model'
  });
  return {root,alpha,beta,missing,client,service,add};
}
test('startup has no fallback to Inventory source; discovery groups App Server cwd paths',async t=>{
  const ctx=await setup(t);
  assert.equal(ctx.service.workspace,null);
  let first=await ctx.service.discoverProjects({force:true});
  assert.deepEqual(first.projects,[]);
  assert.equal(first.workspace,null);
  await assert.rejects(()=>ctx.service.createThread(),/プロジェクトを選択/);
  const a=await ctx.add(ctx.alpha);await ctx.add(ctx.alpha);
  const b=await ctx.add(ctx.beta);await ctx.add(ctx.missing);
  const found=await ctx.service.discoverProjects({force:true});
  assert.equal(found.projects.length,3);
  assert.equal(found.projects.find(x=>sameWorkspace(x.cwd,ctx.alpha)).threadCount,2);
  assert.equal(found.projects.find(x=>sameWorkspace(x.cwd,ctx.beta)).threadCount,1);
  assert.equal(found.projects.find(x=>sameWorkspace(x.cwd,ctx.missing)).exists,false);
  assert.ok(sameWorkspace(found.workspace,ctx.alpha)||sameWorkspace(found.workspace,ctx.beta));
  assert.equal(found.projects.find(x=>sameWorkspace(x.cwd,ctx.alpha)).name,basename(ctx.alpha));
});
test('project switching filters native threads and anchors newly created threads to selected cwd',async t=>{
  const ctx=await setup(t);
  const a=await ctx.add(ctx.alpha);
  const b=await ctx.add(ctx.beta);
  await ctx.service.discoverProjects({force:true});
  await ctx.service.selectProject(ctx.beta);
  const filtered=await ctx.service.listThreads();
  assert.deepEqual(filtered.threads.map(x=>x.id),[b.thread.id]);
  const added=await ctx.service.createThread();
  assert.equal(added.thread.cwd,ctx.beta);
  const global=await ctx.service.listThreads({all:true});
  assert.ok(global.threads.some(x=>x.id===a.thread.id));
  await assert.rejects(()=>ctx.service.startTurn({
    threadId:a.thread.id,prompt:'Do not cross project'
  }),/別プロジェクト/);
  const untouched=await ctx.client.request('thread/read',{threadId:a.thread.id,includeTurns:false});
  assert.equal(untouched.thread.turns.length,0);
  await ctx.service.selectProject(ctx.alpha);
  assert.deepEqual((await ctx.service.listThreads()).threads.map(x=>x.id),[a.thread.id]);
});
test('only existing projects discovered from Codex App Server may be selected',async t=>{
  const ctx=await setup(t);
  await ctx.add(ctx.alpha);
  await ctx.add(ctx.missing);
  await ctx.service.discoverProjects({force:true});
  await assert.rejects(()=>ctx.service.selectProject(ctx.beta),{status:403});
  await assert.rejects(()=>ctx.service.selectProject(ctx.missing),{status:403});
  await assert.rejects(()=>ctx.service.selectProject('../../tmp'),{status:403});
  await assert.rejects(()=>ctx.service.selectProject(''),{status:400});
});
test('legacy -Workspace remains fixed and cannot be switched by API',async t=>{
  const ctx=await setup(t);
  const fixed=new CodexService(ctx.client,{workspace:ctx.alpha});
  const list=await fixed.discoverProjects({force:true});
  assert.equal(list.autoDiscover,false);
  assert.equal(list.workspace,ctx.alpha);
  assert.deepEqual(list.projects.map(x=>x.cwd),[ctx.alpha]);
  await assert.rejects(()=>fixed.selectProject(ctx.beta),{status:409});
});

test('trusted native folder registration permits a project with no Codex chat history',async t=>{
  const ctx=await setup(t);
  const registered=await ctx.service.registerProject(ctx.alpha);
  assert.equal(registered.workspace,ctx.alpha);
  const entries=await ctx.service.discoverProjects({force:true});
  const project=entries.projects.find(p=>sameWorkspace(p.cwd,ctx.alpha));
  assert.ok(project);
  assert.equal(project.threadCount,0);
  assert.equal(project.registered,true);
  const created=await ctx.service.createThread({editing:false});
  assert.equal(created.thread.cwd,ctx.alpha);
  const restored=new CodexService(ctx.client,{autoDiscover:true,knownProjects:[ctx.beta]});
  await restored.start();
  const known=await restored.discoverProjects({force:true});
  assert.ok(known.projects.some(p=>sameWorkspace(p.cwd,ctx.beta)&&p.threadCount===0));
});
test('registered paths must be real existing directories and fixed mode rejects registration',async t=>{
  const ctx=await setup(t);
  await assert.rejects(()=>ctx.service.registerProject(ctx.missing),{status:400});
  await assert.rejects(()=>ctx.service.registerProject(''),{status:400});
  const fixed=new CodexService(ctx.client,{workspace:ctx.alpha});
  await assert.rejects(()=>fixed.registerProject(ctx.beta),{status:409});
});
