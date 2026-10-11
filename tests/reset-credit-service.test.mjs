import test from 'node:test';
import assert from 'node:assert/strict';
import {ResetCreditService,resetCreditSummary,redeemableCredits} from '../reset-credit-service.mjs';

function fixture({count=2,credits,accountId='account-one',outcome='reset'}={}){
  const rows=credits===undefined?[
    {id:'ticket-later',resetType:'codexRateLimits',status:'available',grantedAt:1000,expiresAt:8000,title:'Later'},
    {id:'ticket-earlier',resetType:'codexRateLimits',status:'available',grantedAt:900,expiresAt:6000,title:'Earlier'}
  ]:credits;
  let available=count;
  let currentAccount=accountId;
  const calls=[];
  return {
    calls,
    switchAccount(value){currentAccount=value;},
    changeCount(value){available=value;},
    client:{
      async request(method,params){
        calls.push({method,params});
        if(method==='account/read')return {account:{type:'chatgpt',planType:'plus'}};
        if(method==='account/rateLimits/read')return {
          accountId:currentAccount,
          rateLimits:{primary:{usedPercent:95,windowDurationMins:300,resetsAt:5000}},
          rateLimitResetCredits:available===null?null:{
            availableCount:available,credits:rows===null?null:rows.filter(r=>r.status==='available')
          }
        };
        if(method==='account/rateLimitResetCredit/consume'){
          if(outcome==='reset'){available--;if(rows)rows.find(r=>r.id===params.creditId||!params.creditId).status='redeemed';}
          return {outcome};
        }
        throw Error('Unexpected request: '+method);
      }
    }
  };
}
test('summary preserves unknown balance and does not confuse missing details with zero',()=>{
  assert.deepEqual(resetCreditSummary({}),{availableCount:null,credits:null,detailsAvailable:false});
  assert.deepEqual(resetCreditSummary({rateLimitResetCredits:{availableCount:2,credits:null}}),
    {availableCount:2,credits:null,detailsAvailable:false});
  assert.deepEqual(resetCreditSummary({rateLimitResetCredits:{availableCount:0,credits:[]}}),
    {availableCount:0,credits:[],detailsAvailable:true});
  assert.equal(resetCreditSummary({rateLimitResetCredits:{availableCount:'2'}}).availableCount,null);
});
test('only valid, unexpired and available reset tickets can be selected',()=>{
  const raw={availableCount:5,credits:[
    {id:'late',resetType:'codexRateLimits',status:'available',grantedAt:1,expiresAt:80},
    {id:'early',resetType:'codexRateLimits',status:'available',grantedAt:1,expiresAt:60},
    {id:'spent',resetType:'codexRateLimits',status:'redeemed',grantedAt:1,expiresAt:90},
    {id:'expired',resetType:'codexRateLimits',status:'available',grantedAt:1,expiresAt:40},
    {id:'unknown',resetType:'unknown',status:'available',grantedAt:1,expiresAt:100}
  ]};
  const result=redeemableCredits(resetCreditSummary({rateLimitResetCredits:raw}),50_000);
  assert.deepEqual(result.map(row=>row.id),['early','late']);
});
test('prepare never consumes; confirm consumes exactly once and refreshes the balance',async()=>{
  const f=fixture();const manager=new ResetCreditService(f.client,{now:()=>1000_000});
  const p=await manager.prepare();
  assert.equal(p.selectedCredit.id,'ticket-earlier');
  assert.equal(p.availableCount,2);
  assert.equal(f.calls.filter(x=>x.method.endsWith('/consume')).length,0);
  const result=await manager.confirm(p.confirmationToken);
  assert.equal(result.outcome,'reset');
  assert.equal(result.resetCredits.availableCount,1);
  assert.equal(f.calls.filter(x=>x.method.endsWith('/consume')).length,1);
  const params=f.calls.find(x=>x.method.endsWith('/consume')).params;
  assert.equal(params.creditId,'ticket-earlier');
  assert.match(params.idempotencyKey,/^[\da-f-]{36}$/);
  await assert.rejects(()=>manager.confirm(p.confirmationToken),/期限|確認/);
  assert.equal(f.calls.filter(x=>x.method.endsWith('/consume')).length,1);
});
test('selected ticket and account identity are checked again before any consumption',async()=>{
  const f=fixture();const manager=new ResetCreditService(f.client,{now:()=>1000_000});
  const p=await manager.prepare({creditId:'ticket-later'});
  f.switchAccount('switched-account');
  await assert.rejects(()=>manager.confirm(p.confirmationToken),/アカウント/);
  assert.equal(f.calls.filter(x=>x.method.endsWith('/consume')).length,0);
});
test('used, expired or malformed ticket selection is rejected',async()=>{
  const f=fixture();const manager=new ResetCreditService(f.client,{now:()=>1000_000});
  await assert.rejects(()=>manager.prepare({creditId:'forged'}),/使用できません/);
  await assert.rejects(()=>manager.prepare({creditId:''}),/形式/);
  f.changeCount(0);
  await assert.rejects(()=>manager.prepare(),/ありません/);
  f.changeCount(null);
  await assert.rejects(()=>manager.prepare(),/取得できません/);
});
test('confirmation expires and never falls through to consume',async()=>{
  const f=fixture();let now=1000_000;
  const manager=new ResetCreditService(f.client,{now:()=>now,ttlMs:500});
  const p=await manager.prepare();now+=501;
  await assert.rejects(()=>manager.confirm(p.confirmationToken),/期限/);
  assert.equal(f.calls.filter(x=>x.method.endsWith('/consume')).length,0);
});
test('count-only tickets use official automatic selection and do not invent dates',async()=>{
  const f=fixture({count:1,credits:null});
  const manager=new ResetCreditService(f.client,{now:()=>1000_000});
  const p=await manager.prepare();
  assert.equal(p.selectedCredit,null);
  const result=await manager.confirm(p.confirmationToken);
  assert.equal(result.outcome,'reset');
  const args=f.calls.find(x=>x.method.endsWith('/consume')).params;
  assert.equal(Object.hasOwn(args,'creditId'),false);
});
test('nothingToReset / noCredit outcomes are surfaced without inventing consumption',async()=>{
  for(const outcome of ['nothingToReset','noCredit','alreadyRedeemed']){
    const f=fixture({outcome});
    const manager=new ResetCreditService(f.client,{now:()=>1000_000});
    const p=await manager.prepare();
    const result=await manager.confirm(p.confirmationToken);
    assert.equal(result.outcome,outcome);
    assert.equal(result.resetCredits.availableCount,2);
  }
});
