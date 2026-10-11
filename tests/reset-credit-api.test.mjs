import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {CodexService} from '../codex-service.mjs';
import {createHandler} from '../server.mjs';

const mock=join(dirname(fileURLToPath(import.meta.url)),'fixtures/mock-app-server.mjs');
async function setup(t,extra={}){
  const client=new AppServerClient({command:process.execPath,args:[mock],timeoutMs:5000,env:{...process.env,MOCK_RESET_CREDITS:'1',...extra}});
  const service=new CodexService(client,{workspace:process.cwd()});
  const server=http.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  server.on('request',createHandler({service,port}));
  t.after(()=>{server.closeAllConnections();server.close();client.close();});
  await service.start();
  const base='http://127.0.0.1:'+port;
  return {
    client,service,base,
    post:(url,data,origin=base)=>fetch(base+url,{method:'POST',headers:{
      'Content-Type':'application/json',...(origin?{Origin:origin}:{})
    },body:JSON.stringify(data)})
  };
}
test('two-step reset ticket API never spends on reads, prepare or cancellation',async t=>{
  const {base,post,service,client}=await setup(t);
  const usage=await (await fetch(base+'/api/usage')).json();
  assert.equal(usage.resetCreditTickets.availableCount,2);
  assert.equal(usage.resetCreditTickets.credits.length,2);
  const attempt=await post('/api/reset-credits/prepare',{creditId:'mock-credit-near'});
  assert.equal(attempt.status,200);
  const plan=await attempt.json();
  assert.equal(plan.selectedCredit.id,'mock-credit-near');
  assert.ok(plan.primary.usedPercent>=0);
  const unchanged=await (await fetch(base+'/api/usage')).json();
  assert.equal(unchanged.resetCreditTickets.availableCount,2);
  assert.equal(service.running.size,0);
  // Abandoning the confirmation dialog intentionally does not invoke consume.
  assert.equal((await client.request('account/rateLimits/read',{})).rateLimitResetCredits.availableCount,2);
});
test('confirmation spends precisely one ticket and rejects replay and forged tokens',async t=>{
  const {base,post,client}=await setup(t);
  assert.equal((await post('/api/reset-credits/confirm',{confirmationToken:'f'.repeat(64)})).status,409);
  assert.equal((await post('/api/reset-credits/confirm',{confirmed:true})).status,400);
  assert.equal((await post('/api/reset-credits/prepare',{creditId:'fake-ticket'})).status,409);
  const prep=await (await post('/api/reset-credits/prepare',{creditId:'mock-credit-near'})).json();
  const consume=await post('/api/reset-credits/confirm',{confirmationToken:prep.confirmationToken});
  assert.equal(consume.status,200);
  const result=await consume.json();
  assert.equal(result.outcome,'reset');
  assert.equal(result.resetCredits.availableCount,1);
  const again=await post('/api/reset-credits/confirm',{confirmationToken:prep.confirmationToken});
  assert.equal(again.status,409);
  const fresh=await (await fetch(base+'/api/usage')).json();
  assert.equal(fresh.resetCreditTickets.availableCount,1);
  assert.equal(fresh.primary.usedPercent,0);
  const source=await client.request('account/rateLimits/read',{});
  assert.equal(source.rateLimitResetCredits.credits[0].id,'mock-credit-later');
});
test('missing or foreign Origin is rejected for all ticket mutations',async t=>{
  const {post,base}=await setup(t);
  const a=await post('/api/reset-credits/prepare',{},null);
  assert.equal(a.status,403);
  const b=await post('/api/reset-credits/prepare',{},'http://example.invalid');
  assert.equal(b.status,403);
  const c=await post('/api/reset-credits/confirm',{confirmationToken:'f'.repeat(64)},null);
  assert.equal(c.status,403);
  assert.equal((await (await fetch(base+'/api/usage')).json()).resetCreditTickets.availableCount,2);
});
test('count-only mode is explicit and can use official backend auto-selection',async t=>{
  const {base,post}=await setup(t,{MOCK_RESET_CREDITS_COUNT_ONLY:'1'});
  const usage=await (await fetch(base+'/api/usage')).json();
  assert.equal(usage.resetCreditTickets.availableCount,2);
  assert.equal(usage.resetCreditTickets.credits,null);
  const prep=await (await post('/api/reset-credits/prepare',{})).json();
  assert.equal(prep.selectedCredit,null);
  const confirmed=await (await post('/api/reset-credits/confirm',{confirmationToken:prep.confirmationToken})).json();
  assert.equal(confirmed.outcome,'reset');
  assert.equal(confirmed.resetCredits.availableCount,1);
});
test('nothingToReset does not decrease available count or start a Codex turn',async t=>{
  const {base,post,service}=await setup(t,{MOCK_RESET_NOTHING_TO_RESET:'1'});
  const prep=await (await post('/api/reset-credits/prepare',{})).json();
  const result=await (await post('/api/reset-credits/confirm',{confirmationToken:prep.confirmationToken})).json();
  assert.equal(result.outcome,'nothingToReset');
  assert.equal((await (await fetch(base+'/api/usage')).json()).resetCreditTickets.availableCount,2);
  assert.equal(service.running.size,0);
});
