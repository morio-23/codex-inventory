import {createInterface} from 'node:readline';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const store=process.env.MOCK_STORE_FILE;
const saved=store&&existsSync(store)?JSON.parse(readFileSync(store,'utf8')):null;
const threads=new Map(saved?.threads?.map(t=>[t.id,t])||[]);
let nextId=saved?.nextId||0;
const resetMockEnabled=process.env.MOCK_RESET_CREDITS==='1';
const startTime=Math.floor(Date.now()/1000);
let resetCredits=saved?.resetCredits||(resetMockEnabled?[
  {id:'mock-credit-near',title:'5h + 週間 Full Reset',description:'期限が近い保存済みリセット',status:'available',resetType:'codexRateLimits',grantedAt:startTime-1000,expiresAt:startTime+86400},
  {id:'mock-credit-later',title:'Full Reset',description:'保存済みリセット',status:'available',resetType:'codexRateLimits',grantedAt:startTime-600,expiresAt:startTime+172800}
]:[]);
const resetKeys=new Set(saved?.resetKeys||[]);
let resetConsumeCalls=saved?.resetConsumeCalls||0;
const persist=()=>{if(store)writeFileSync(store,JSON.stringify({nextId,threads:[...threads.values()],resetCredits,resetKeys:[...resetKeys],resetConsumeCalls}));};
const faults=new Set((process.env.MOCK_FAIL_METHODS||'').split(',').filter(Boolean));
const hangs=new Set((process.env.MOCK_HANG_METHODS||'').split(',').filter(Boolean));
const turnDelay=Number(process.env.MOCK_TURN_DELAY_MS||180);
const write=o=>process.stdout.write(JSON.stringify(o)+'\n');
const success=(id,result)=>write({id,result});
const fail=(id,message,code=-32600)=>write({id,error:{code,message}});
const event=(method,params)=>write({method,params});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let active=new Map();
let pendingApproval=null;
function compact(t){return {id:t.id,preview:t.preview||'',cwd:t.cwd,createdAt:t.createdAt,updatedAt:t.updatedAt,turns:t.turns,status:{type:active.has(t.id)?'active':'idle'}};}
async function handle({id,method,params={}}){
  if(method===undefined && id!==undefined && pendingApproval && id===pendingApproval.id){
    const p=pendingApproval;pendingApproval=null;
    p.resolve(arguments[0]?.result);
    return;
  }
  if(hangs.has(method))return;
  if(faults.has(method))return fail(id,`Mock failure: ${method}`);
  if(method===process.env.MOCK_DISCONNECT_METHOD){
    const marker=process.env.MOCK_DISCONNECT_MARKER;
    if(!marker||!existsSync(marker)){if(marker)writeFileSync(marker,'1');process.exit(7);}
  }
  if(method==='initialize')return success(id,{userAgent:'mock-app-server/1.0'});
  if(method==='initialized')return;
  if(method==='account/read')return success(id,{account:{type:'chatgpt',planType:'plus'}});
  if(method==='model/list')return success(id,{data:[
    {id:'mock-model',model:'mock-model',displayName:'Mock Standard',
      isDefault:true,hidden:false,defaultReasoningEffort:'medium',
      supportedReasoningEfforts:[
        {reasoningEffort:'low',description:'Shorter reasoning'},
        {reasoningEffort:'medium',description:'Default reasoning'},
        {reasoningEffort:'high',description:'Extended reasoning'}
      ]},
    {id:'mock-deep',model:'mock-deep',displayName:'Mock Deep',
      isDefault:false,hidden:false,defaultReasoningEffort:'high',
      supportedReasoningEfforts:[
        {reasoningEffort:'high',description:'Extended reasoning'},
        {reasoningEffort:'xhigh',description:'Extra high reasoning'},
        {reasoningEffort:'ultra',description:'Ultra reasoning'}
      ]},
    {id:'mock-hidden',model:'mock-hidden',displayName:'Mock Hidden',
      isDefault:false,hidden:true,defaultReasoningEffort:'medium',
      supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Hidden option'}]}
  ]});
  if(method==='account/rateLimits/read')return success(id,{
    accountId:'mock-account',
    rateLimits:{primary:{usedPercent:resetKeys.size?0:28,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600},
      secondary:{usedPercent:resetKeys.size?0:47,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000)+86400}},
    rateLimitResetCredits:resetMockEnabled?{
      availableCount:resetCredits.filter(credit=>credit.status==='available').length,
      credits:process.env.MOCK_RESET_CREDITS_COUNT_ONLY==='1'?null:resetCredits.filter(credit=>credit.status==='available')
    }:null
  });
  if(method==='account/rateLimitResetCredit/consume'){
    resetConsumeCalls++;
    if(!resetMockEnabled)return fail(id,'Reset tickets are not available');
    if(typeof params.idempotencyKey!=='string'||!params.idempotencyKey)return fail(id,'Missing idempotency key');
    if(resetKeys.has(params.idempotencyKey))return success(id,{outcome:'alreadyRedeemed'});
    const candidate=params.creditId?resetCredits.find(row=>row.id===params.creditId&&row.status==='available'):
      resetCredits.find(row=>row.status==='available');
    if(!candidate)return success(id,{outcome:'noCredit'});
    if(process.env.MOCK_RESET_NOTHING_TO_RESET==='1')return success(id,{outcome:'nothingToReset'});
    candidate.status='redeemed';resetKeys.add(params.idempotencyKey);persist();
    success(id,{outcome:'reset'});event('account/rateLimits/updated',{});return;
  }
  if(method==='thread/list'){
    const list=[...threads.values()].filter(t=>!params.cwd||params.cwd.includes(t.cwd)).sort((a,b)=>b.updatedAt-a.updatedAt).map(compact);
    return success(id,{data:list,nextCursor:null});
  }
  if(method==='thread/start'){
    if(!['read-only','workspace-write'].includes(params.sandbox))return fail(id,'Invalid sandbox mode');
    if(!['mock-model','mock-deep'].includes(params.model))return fail(id,'Unsupported model');
    const t={id:'mock-'+(++nextId),cwd:params.cwd,preview:'',createdAt:Math.floor(Date.now()/1000),updatedAt:Math.floor(Date.now()/1000),turns:[]};
    threads.set(t.id,t);persist();success(id,{thread:compact(t)});event('thread/started',{thread:compact(t)});return;
  }
  if(method==='thread/read'){
    const t=threads.get(params.threadId);if(!t)return fail(id,'Thread not found');
    if(params.includeTurns && !t.turns.length)return fail(id,process.env.MOCK_EMPTY_ROLLOUT==='1'
      ? `failed to read thread: thread-store internal error: rollout at mock is empty`
      : `thread ${t.id} is not materialized yet; includeTurns is unavailable before first user message`);
    const thread=compact(t);if(!params.includeTurns)thread.turns=[];
    return success(id,{thread});
  }
  if(method==='thread/resume'){
    const t=threads.get(params.threadId);if(!t)return fail(id,'Thread not found');
    return success(id,{thread:compact(t)});
  }
  if(method==='turn/start'){
    if(params.effort!==undefined){
      const options=params.model==='mock-deep'?['high','xhigh','ultra']:['low','medium','high'];
      if(!options.includes(params.effort))return fail(id,'Unsupported model/effort combination');
    }
    if(!['readOnly','workspaceWrite'].includes(params.sandboxPolicy?.type))return fail(id,'Invalid turn sandbox policy');
    const t=threads.get(params.threadId);if(!t)return fail(id,'Thread not found');
    if(active.has(t.id))return fail(id,'Thread already running');
    const message=params.input?.[0]?.text||'';
    const turn={id:'turn-'+Date.now()+'-'+(++nextId),status:'inProgress',requestedModel:params.model??null,requestedEffort:params.effort??null,items:[{id:'user-'+nextId,type:'userMessage',content:[{type:'text',text:message}]}]};
    t.turns.push(turn);t.preview=t.preview||message.split('【ユーザー依頼】\n').at(-1).slice(0,90);t.updatedAt=Math.floor(Date.now()/1000);
    active.set(t.id,{turn});persist();success(id,{turn:{id:turn.id,status:'inProgress',items:[]}});
    event('turn/started',{threadId:t.id,turn:{id:turn.id,status:'inProgress'}});
    if(process.env.MOCK_APPROVAL_REQUEST==='1'){
      const approvalKind=process.env.MOCK_APPROVAL_KIND||'command';
      const method=approvalKind==='file'?'item/fileChange/requestApproval':
        approvalKind==='permissions'?'item/permissions/requestApproval':'item/commandExecution/requestApproval';
      const approvalResult=await new Promise(resolve=>{
        const requestId=90000+nextId;
        pendingApproval={resolve,id:requestId};
        const requested={threadId:t.id,turnId:turn.id,itemId:'approve-'+nextId,
          reason:'Approval integration test'};
        if(approvalKind==='file')requested.grantRoot=t.cwd;
        else if(approvalKind==='permissions'){
          requested.cwd=t.cwd;
          requested.permissions={network:{enabled:true},fileSystem:null};
        }else{requested.command='echo APPROVAL_TEST';requested.cwd=t.cwd;}
        write({id:requestId,method,params:requested});
      });
      const allowed=approvalKind==='permissions'
        ? approvalResult?.permissions?.network?.enabled===true
        : ['accept','acceptForSession'].includes(approvalResult?.decision);
      if(!allowed){
        turn.status='failed';active.delete(t.id);persist();
        event('turn/completed',{threadId:t.id,turn:{id:turn.id,status:'failed'}});
        return;
      }
    }
    await wait(turnDelay/2);
    if(!active.has(t.id))return;
    const itemId='msg-'+nextId;const reply='【デモ】 '+message.split('【ユーザー依頼】\n').at(-1)+'\n\n- App Server 経由のチャット履歴\n- 複数スレッドの並行実行に対応';
    event('item/agentMessage/delta',{threadId:t.id,turnId:turn.id,itemId,delta:reply.slice(0,25)});
    await wait(turnDelay/2);
    if(!active.has(t.id))return;
    event('item/agentMessage/delta',{threadId:t.id,turnId:turn.id,itemId,delta:reply.slice(25)});
    turn.items.push({id:itemId,type:'agentMessage',text:reply});
    turn.status=['completed','failed','interrupted'].includes(process.env.MOCK_TURN_STATUS)?process.env.MOCK_TURN_STATUS:'completed';
    active.delete(t.id);persist();
    event('item/completed',{threadId:t.id,turnId:turn.id,item:{id:itemId,type:'agentMessage',text:reply}});
    event('thread/tokenUsage/updated',{threadId:t.id,tokenUsage:{total:{totalTokens:245+Number(t.id.split('-').at(-1))}}});
    event('turn/completed',{threadId:t.id,turn:{id:turn.id,status:turn.status}});
    if(process.env.MOCK_DUP_COMPLETION==='1')
      event('turn/completed',{threadId:t.id,turn:{id:turn.id,status:turn.status}});
    return;
  }
  if(method==='turn/interrupt'){
    const t=threads.get(params.threadId);const record=active.get(params.threadId);
    if(!t||!record)return fail(id,'No active turn');
    record.turn.status='interrupted';active.delete(params.threadId);persist();success(id,{});
    event('turn/completed',{threadId:params.threadId,turn:{id:record.turn.id,status:'interrupted'}});return;
  }
  fail(id,'Unknown method: '+method,-32601);
}
createInterface({input:process.stdin}).on('line',line=>{
  try {handle(JSON.parse(line)).catch(e=>process.stderr.write(e.stack+'\n'));}
  catch(e){process.stderr.write(e.message+'\n');}
});
