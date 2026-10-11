import {randomBytes,randomUUID} from 'node:crypto';

const error=(message,status=409)=>Object.assign(new Error(message),{status});
const validCount=count=>Number.isSafeInteger(count)&&count>=0?count:null;
const validDate=value=>Number.isSafeInteger(value)&&value>0?value:null;
const validCreditId=id=>typeof id==='string'&&id.length>0&&id.length<=256;
const outcomes=new Set(['reset','alreadyRedeemed','nothingToReset','noCredit']);

/** Only the public Codex App Server API is used. No token or private HTTP endpoints. */
export function resetCreditSummary(response){
  const source=response?.rateLimitResetCredits;
  const availableCount=validCount(source?.availableCount);
  const credits=Array.isArray(source?.credits)?source.credits.filter(value=>value&&typeof value==='object')
    .map(value=>({
      id:validCreditId(value.id)?value.id:null,
      title:typeof value.title==='string'?value.title.slice(0,160):null,
      description:typeof value.description==='string'?value.description.slice(0,300):null,
      status:typeof value.status==='string'?value.status:'unknown',
      resetType:typeof value.resetType==='string'?value.resetType:'unknown',
      grantedAt:validDate(value.grantedAt),
      expiresAt:validDate(value.expiresAt)
    }))
    .filter(value=>value.id!==null):null;
  return {availableCount,credits,detailsAvailable:credits!==null};
}
export function redeemableCredits(summary,nowMs=Date.now()){
  return (summary.credits||[]).filter(row=>
    row.status==='available'&&row.resetType==='codexRateLimits'&&
    (row.expiresAt===null||row.expiresAt*1000>nowMs)
  ).sort((a,b)=>(a.expiresAt??Number.MAX_SAFE_INTEGER)-(b.expiresAt??Number.MAX_SAFE_INTEGER));
}

/**
 * Prepare generates a short-lived single-use capability, but only confirm()
 * ever invokes account/rateLimitResetCredit/consume.
 */
export class ResetCreditService{
  constructor(client,{now=()=>Date.now(),ttlMs=60_000}={}){
    this.client=client;this.now=now;this.ttlMs=ttlMs;
    this.pending=new Map();this.inFlight=false;
  }
  async #snapshot(){
    const [limits,account]=await Promise.all([
      this.client.request('account/rateLimits/read',{}),
      this.client.request('account/read',{refreshToken:false})
    ]);
    if(account?.account?.type!=='chatgpt')throw error('リセットチケットを使うにはChatGPTでのCodexログインが必要です',403);
    const tickets=resetCreditSummary(limits);
    return {tickets,accountId:limits?.accountId||null,
      primary:limits?.rateLimits?.primary??null,
      secondary:limits?.rateLimits?.secondary??null};
  }
  async prepare({creditId=null}={}){
    if(this.inFlight)throw error('別のチケットを処理中です。完了後に再確認してください');
    if(creditId!==null&&!validCreditId(creditId))throw error('チケットIDの形式が不正です',400);
    const snap=await this.#snapshot();
    if(snap.tickets.availableCount===null)throw error('チケット残枚数を取得できません。0枚とみなさず、後ほど再確認してください');
    if(snap.tickets.availableCount===0)throw error('利用可能なリセットチケットがありません');
    const available=redeemableCredits(snap.tickets,this.now());
    let selected=null;
    if(creditId!==null){
      selected=available.find(c=>c.id===creditId);
      if(!selected)throw error('選択したチケットは使用できません。更新して選び直してください');
    }else if(available.length){
      selected=available[0];
    }else if(snap.tickets.credits!==null&&snap.tickets.credits.length){
      throw error('表示中のチケットに使用可能なものがありません。更新して確認してください');
    }
    // If only a count is known, the official protocol accepts missing creditId.
    for(const [key,value] of this.pending)if(value.expiresAt<=this.now())this.pending.delete(key);
    while(this.pending.size>=8)this.pending.delete(this.pending.keys().next().value);
    const confirmationToken=randomBytes(32).toString('hex');
    const expiresAt=this.now()+this.ttlMs;
    this.pending.set(confirmationToken,{creditId:selected?.id??null,
      accountId:snap.accountId,expiresAt,idempotencyKey:randomUUID()});
    return {confirmationToken,expiresAt,selectedCredit:selected,
      availableCount:snap.tickets.availableCount,primary:snap.primary,secondary:snap.secondary,
      warning:'リセットチケットを1枚使用します。この操作は取り消せません。実行後に利用枠を再取得します。'};
  }
  async confirm(confirmationToken){
    if(typeof confirmationToken!=='string'||!/^[0-9a-f]{64}$/.test(confirmationToken))
      throw error('最終確認が必要です。チケットを選び直してください',403);
    const item=this.pending.get(confirmationToken);
    this.pending.delete(confirmationToken); // one-use, also blocks simultaneous replay
    if(!item||item.expiresAt<=this.now())throw error('確認の期限が切れました。もう一度やり直してください');
    if(this.inFlight)throw error('別のチケットを処理中です。処理が終わるまで待ってください');
    this.inFlight=true;
    let attempted=false;
    try{
      const snap=await this.#snapshot();
      if(item.accountId!==snap.accountId)throw error('Codexのアカウントが切り替わりました。再確認してください');
      if(snap.tickets.availableCount===null||snap.tickets.availableCount===0)
        throw error('現在のチケット残枚数が確認できません。もう一度更新してください');
      if(item.creditId!==null&&!redeemableCredits(snap.tickets,this.now()).some(row=>row.id===item.creditId))
        throw error('このチケットはすでに利用済み、期限切れ、または取得できません。再確認してください');
      if(item.creditId===null&&snap.tickets.credits?.length)
        throw error('チケット情報が更新されました。使用するチケットを選び直してください');
      attempted=true;
      const response=await this.client.request('account/rateLimitResetCredit/consume',{
        idempotencyKey:item.idempotencyKey,...(item.creditId?{creditId:item.creditId}:{})
      },{timeoutMs:60_000});
      if(!outcomes.has(response?.outcome))
        throw error('チケットの処理結果を判定できません。再実行せず利用状況を更新してください',502);
      let refreshed=null,refreshError=null;
      try{refreshed=(await this.#snapshot()).tickets;}
      catch(e){refreshError='最新の残枚数は取得できません。更新ボタンで再確認してください';}
      return {outcome:response.outcome,resetCredits:refreshed,refreshError};
    }catch(e){
      if(attempted)throw error('チケット使用の結果が不明です。二重消費を避けるため再実行せず、利用状況を更新してください。'+e.message,e.status||503);
      throw e;
    }finally{this.inFlight=false;}
  }
}
