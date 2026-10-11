import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService} from '../codex-service.mjs';
import {normalizeModelCatalog,resolveModelSelection} from '../model-selection.mjs';

const fixture=fileURLToPath(new URL('./fixtures/mock-app-server.mjs',import.meta.url));
async function harness(t){
  const dir=await mkdtemp(join(tmpdir(),'codex-reasoning-test-'));
  const file=join(dir,'threads.json');
  const client=new AppServerClient({
    command:process.execPath,args:[fixture],timeoutMs:5000,
    env:{...process.env,MOCK_STORE_FILE:file}
  });
  const service=new CodexService(client,{workspace:dir});
  t.after(async()=>{client.close();await rm(dir,{recursive:true,force:true});});
  await service.start();
  return {client,service,file};
}
test('model/list preserves the catalog order and hides non-selectable models',()=>{
  const result=normalizeModelCatalog({data:[
    {model:'fast',displayName:'Fast',isDefault:true,hidden:false,
      defaultReasoningEffort:'high',
      supportedReasoningEfforts:[
        {reasoningEffort:'high',description:'Long'},
        {reasoningEffort:'low',description:'Short'},
        {reasoningEffort:'high',description:'Duplicate'}
      ]},
    {model:'private',hidden:true,isDefault:false,supportedReasoningEfforts:[
      {reasoningEffort:'ultra'}]},
    {model:'old',displayName:'Old',supportedReasoningEfforts:[]}
  ]});
  assert.equal(result.defaultModel,'fast');
  assert.deepEqual(result.models.map(x=>x.id),['fast','old']);
  assert.deepEqual(result.models[0].efforts.map(x=>x.id),['high','low']);
  assert.equal(result.models[0].defaultEffort,'high');
  assert.deepEqual(resolveModelSelection(result,{model:'fast',effort:'high'}),{model:'fast',effort:'high'});
  assert.deepEqual(resolveModelSelection(result,{model:'fast'}),{model:'fast',effort:'high'});
  assert.deepEqual(resolveModelSelection(result,{}),{});
});
test('unsupported effort, hidden model or malformed catalog are rejected before execution',()=>{
  const catalog=normalizeModelCatalog({data:[{
    model:'fast',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'}]
  }]});
  assert.throws(()=>resolveModelSelection(catalog,{model:'fast',effort:'high'}),{status:400});
  assert.throws(()=>resolveModelSelection(catalog,{model:'private'}),{status:400});
  assert.throws(()=>normalizeModelCatalog({data:null}),{status:503});
});
test('real mock App Server model catalog is exposed in supported order',async t=>{
  const {service}=await harness(t);
  const catalog=await service.listModels();
  assert.deepEqual(catalog.models.map(x=>x.id),['mock-model','mock-deep']);
  assert.deepEqual(catalog.models[1].efforts.map(x=>x.id),['high','xhigh','ultra']);
  assert.equal(catalog.defaultModel,'mock-model');
});
test('new and existing Codex threads forward selected model and effort to turn/start',async t=>{
  const {service,file}=await harness(t);
  const created=await service.createThread({model:'mock-deep',effort:'xhigh'});
  const {turnId,requestedModel,requestedEffort}=await service.startTurn({
    threadId:created.thread.id,prompt:'Run deep',model:'mock-deep',effort:'xhigh'
  });
  assert.ok(turnId);
  assert.equal(requestedModel,'mock-deep');
  assert.equal(requestedEffort,'xhigh');
  const stored=JSON.parse(await readFile(file,'utf8'));
  const thread=stored.threads.find(x=>x.id===created.thread.id);
  assert.equal(thread.turns[0].requestedModel,'mock-deep');
  assert.equal(thread.turns[0].requestedEffort,'xhigh');
});
test('specifying only reasoning uses the catalog default model; no override inherits thread settings',async t=>{
  const {service,file}=await harness(t);
  const first=await service.createThread();
  await service.startTurn({threadId:first.thread.id,prompt:'Default with high',effort:'high'});
  const second=await service.createThread();
  await service.startTurn({threadId:second.thread.id,prompt:'Inherited'});
  const rows=JSON.parse(await readFile(file,'utf8')).threads;
  assert.equal(rows.find(x=>x.id===first.thread.id).turns[0].requestedModel,'mock-model');
  assert.equal(rows.find(x=>x.id===first.thread.id).turns[0].requestedEffort,'high');
  assert.equal(rows.find(x=>x.id===second.thread.id).turns[0].requestedModel,null);
  assert.equal(rows.find(x=>x.id===second.thread.id).turns[0].requestedEffort,null);
});
test('invalid model/effort combinations fail closed before creating a Codex turn',async t=>{
  const {service,file}=await harness(t);
  const thread=(await service.createThread()).thread;
  await assert.rejects(()=>service.startTurn({
    threadId:thread.id,prompt:'must never submit',model:'mock-deep',effort:'low'
  }),{status:400});
  await assert.rejects(()=>service.startTurn({
    threadId:thread.id,prompt:'must never submit',model:'mock-hidden',effort:'medium'
  }),{status:400});
  assert.equal(service.running.size,0);
  const data=JSON.parse(await readFile(file,'utf8'));
  assert.equal(data.threads.find(x=>x.id===thread.id).turns.length,0);
});
