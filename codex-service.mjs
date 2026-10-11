import { EventEmitter } from 'node:events';
import { resolve, win32, basename } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import {resetCreditSummary} from './reset-credit-service.mjs';
import {normalizeModelCatalog,resolveModelSelection} from './model-selection.mjs';

/** Refuse cross-workspace execution even for threads visible in the global list. */
export function sameWorkspace(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false;
  const windows=/^[A-Za-z]:[\\/]/;
  if(windows.test(a)||windows.test(b)) {
    if(!windows.test(a)||!windows.test(b))return false;
    return win32.normalize(a).toLowerCase()===win32.normalize(b).toLowerCase();
  }
  return resolve(a)===resolve(b);
}

export const taskInstructions = {
  inspect:'対象コードを読み、構造、問題点、関係するファイルを日本語で説明してください。明示されない限り変更しないでください。',
  build:'実装に必要なファイルを調べ、変更と検証を行ってください。結果を日本語で説明してください。',
  fix:'不具合を調査し、最小限の修正と検証を行ってください。原因と結果を日本語で説明してください。',
  test:'既存のテストを確認し、実行して結果を日本語で説明してください。',
  review:'現在の変更差分をレビューし、ファイルは変更せずリスクを報告してください。',
  map:'リポジトリ構成、エントリーポイント、依存関係、起動方法を日本語でまとめてください。',
  quest:'ユーザーの依頼を日本語で実行し、結果を説明してください。'
};

const clip = (value, max=1000) => typeof value==='string' ? value.slice(0,max) : '';
export function simplifyThread(thread) {
  return {id:thread.id,preview:thread.preview||'',cwd:thread.cwd||'',createdAt:thread.createdAt||0,updatedAt:thread.updatedAt||0,source:thread.source||null,status:thread.status||null};
}
export function projectHistory(thread) {
  const output=[];
  for (const turn of thread.turns||[]) {
    for (const item of turn.items||[]) {
      if (item.type==='userMessage') {
        const text=(item.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
        if(text)output.push({role:'user',text,turnId:turn.id,itemId:item.id});
      } else if (item.type==='agentMessage' && item.text) output.push({role:'assistant',text:item.text,turnId:turn.id,itemId:item.id});
      else if (item.type==='commandExecution') output.push({role:'command',text:clip(item.command,12000),turnId:turn.id,itemId:item.id});
      else if (item.type==='fileChange') output.push({role:'files',text:(item.changes||[]).map(x=>x.path||x.kind).join('\n'),turnId:turn.id,itemId:item.id});
    }
  }
  return output;
}
export function summarizeRateLimits(response) {
  const limits=response?.rateLimits??null;
  return {available:!!limits,primary:limits?.primary??null,secondary:limits?.secondary??null,
    resetCredits:resetCreditSummary(response).availableCount,
    resetCreditTickets:resetCreditSummary(response),
    note:limits?'usedPercentは使用済み割合。残量は100%-使用済み割合です。':'ChatGPT利用枠を取得できません。'};
}

/** The app-server owns the canonical on-disk threads; this service never invents persisted IDs. */
export class CodexService extends EventEmitter {
  constructor(client,{workspace=process.cwd(),autoDiscover=false,knownProjects=[]}={}) {
    super();this.client=client;this.autoDiscover=autoDiscover;this.workspace=autoDiscover?null:resolve(workspace);
    this.projects=[];this.discoveryAt=0;this.discoveryPromise=null;
    this.knownProjects=new Set(Array.isArray(knownProjects)?knownProjects.filter(x=>typeof x==='string'&&x.length<=4096):[]);
    this.approvals=new Map();this.approvalSequence=0;this.turnWorkspaces=new Map();
    this.running=new Map();this.finishedTurns=new Set();this.subscribed=new Set();this.tokenUsage=new Map();this.knownThreads=new Map();
    client.on('notification',e=>this.#notification(e));
    client.on('server-request',e=>this.#onApproval(e));
    client.on('disconnect',error=>{this.#clearApprovals();this.turnWorkspaces.clear();this.running.clear();this.subscribed.clear();this.emit('event',{type:'connection',error:error.message});});
    client.on('warning',message=>this.emit('event',{type:'warning',text:message}));
  }
  async start(){await this.client.start();}
  async listThreads({all=false,limit=100}={}) {
    if(!all&&!this.workspace)return {threads:[],nextCursor:null};
    const data=[];let cursor=null;let pages=0;
    do {
      const params={limit:Math.max(1,Math.min(100,limit)),sortKey:'updated_at'};
      if(!all)params.cwd=[this.workspace];
      if(cursor)params.cursor=cursor;
      const response=await this.client.request('thread/list',params);
      data.push(...(response?.data||[]).map(simplifyThread));
      cursor=response?.nextCursor||null;
      pages++;
    } while(cursor && pages<30);
    return {threads:data,nextCursor:cursor};
  }
  /** Discover projects only from Codex App Server thread cwd values. */
  async discoverProjects({force=false}={}){
    if(!this.autoDiscover){
      return {projects:[{cwd:this.workspace,name:basename(this.workspace),threadCount:0,updatedAt:0,exists:true}],
        workspace:this.workspace,autoDiscover:false};
    }
    if(this.discoveryPromise)return this.discoveryPromise;
    if(!force&&Date.now()-this.discoveryAt<15000)
      return {projects:this.projects,workspace:this.workspace,autoDiscover:true};
    this.discoveryPromise=(async()=>{
      const {threads}=await this.listThreads({all:true});
      const grouped=new Map();
      for(const thread of threads){
        const raw=thread.cwd;
        if(typeof raw!=='string'||!raw.trim()||!raw.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(raw))continue;
        const path=raw.trim();
        const key=/^[A-Za-z]:[\\/]/.test(path)?win32.normalize(path).toLowerCase():resolve(path);
        const item=grouped.get(key)||{cwd:path,
          name:/^[A-Za-z]:[\\/]/.test(path)?win32.basename(path):basename(path),
          threadCount:0,updatedAt:0,exists:false};
        item.threadCount++;item.updatedAt=Math.max(item.updatedAt,Number(thread.updatedAt)||0);
        grouped.set(key,item);
      }
      // Native folder selections are registered by Electron's trusted
      // dialog. Never expose an arbitrary-path registration HTTP endpoint.
      for(const path of this.knownProjects){
        const key=/^[A-Za-z]:[\\/]/.test(path)?win32.normalize(path).toLowerCase():resolve(path);
        if(!grouped.has(key))grouped.set(key,{cwd:path,
          name:/^[A-Za-z]:[\\/]/.test(path)?win32.basename(path):basename(path),
          threadCount:0,updatedAt:0,exists:false,registered:true});
      }
      const projects=await Promise.all([...grouped.values()].map(async item=>{
        try{const path=await realpath(item.cwd);const info=await stat(path);
          return {...item,canonicalPath:path,exists:info.isDirectory()};}
        catch{return item;}
      }));
      projects.sort((a,b)=>b.updatedAt-a.updatedAt||b.threadCount-a.threadCount);
      this.projects=projects;this.discoveryAt=Date.now();
      if(!this.workspace){
        const next=projects.find(item=>item.exists);
        if(next)this.workspace=next.cwd;
      }
      // A deleted folder is not silently replaced with Inventory's own cwd.
      return {projects,workspace:this.workspace,autoDiscover:true};
    })();
    try{return await this.discoveryPromise;}finally{this.discoveryPromise=null;}
  }
  async registerProject(cwd){
    if(!this.autoDiscover)throw Object.assign(new Error('固定ワークスペースではフォルダーを登録できません'),{status:409});
    if(typeof cwd!=='string'||!cwd||cwd.length>4096)
      throw Object.assign(new Error('フォルダーの指定が不正です'),{status:400});
    let canonical,information;
    try{canonical=await realpath(cwd);information=await stat(canonical);}
    catch{throw Object.assign(new Error('フォルダーが存在しません'),{status:400});}
    if(!information.isDirectory())throw Object.assign(new Error('フォルダーではありません'),{status:400});
    this.knownProjects.add(canonical);this.discoveryAt=0;
    // Select is limited to the discovered/registered allowlist.
    await this.discoverProjects({force:true});
    return this.selectProject(canonical);
  }
  async selectProject(cwd){
    if(!this.autoDiscover)throw Object.assign(new Error('固定ワークスペースで起動中のため切替できません'),{status:409});
    if(typeof cwd!=='string'||!cwd||cwd.length>4096)
      throw Object.assign(new Error('プロジェクトの指定が不正です'),{status:400});
    const {projects}=await this.discoverProjects({force:true});
    const target=projects.find(item=>item.exists&&sameWorkspace(item.cwd,cwd));
    if(!target)throw Object.assign(new Error('App Server履歴に存在する有効なプロジェクトを選択してください'),{status:403});
    try{
      const resolved=await realpath(target.cwd),info=await stat(resolved);
      if(!info.isDirectory()||resolved!==target.canonicalPath)throw Error('directory changed');
    }catch{throw Object.assign(new Error('選択したプロジェクトが見つからないか変更されています'),{status:409});}
    this.workspace=target.cwd;
    this.emit('event',{type:'project',workspace:this.workspace});
    return {workspace:this.workspace};
  }
  async readThread(id) {
    let response;
    try {response=await this.client.request('thread/read',{threadId:id,includeTurns:true},{timeoutMs:60000});}
    catch(error){
      if(!/not materialized yet.*includeTurns|rollout .* is empty/.test(error.message))throw error;
      const thread=this.knownThreads.get(id)||(await this.listThreads({all:true})).threads.find(item=>item.id===id);
      if(!thread)throw error;
      return {thread,messages:[],rawStatus:thread.status};
    }
    return {thread:simplifyThread(response.thread),messages:projectHistory(response.thread),rawStatus:response.thread.status};
  }
  async listModels(){
    const all=[];let cursor=null;
    for(let i=0;i<10;i++){
      const response=await this.client.request('model/list',cursor?{cursor}:{});
      if(!Array.isArray(response?.data))throw Object.assign(
        new Error('Codex App Serverからモデル一覧を取得できません'),{status:503});
      all.push(...response.data);
      if(!response.nextCursor)break;
      if(response.nextCursor===cursor)throw Object.assign(
        new Error('モデル一覧のページ情報が不正です'),{status:503});
      cursor=response.nextCursor;
      if(i===9)throw Object.assign(new Error('モデル一覧が大きすぎます'),{status:503});
    }
    return normalizeModelCatalog({data:all});
  }
  async selectedModel({model=null,effort=null}={}){
    if((model===null||model==='')&&(effort===null||effort===''))return {};
    return resolveModelSelection(await this.listModels(),{model,effort});
  }
  async createThread({editing=false,model=null,effort=null}={}) {
    const cwd=this.workspace;
    if(!cwd)throw Object.assign(new Error('先にプロジェクトを選択してください'),{status:409});
    const selected=await this.selectedModel({model,effort});
    const preferred=selected.model||((await this.listModels().catch(()=>null))?.defaultModel);
    if(!sameWorkspace(this.workspace,cwd))throw Object.assign(new Error('プロジェクトが切り替わりました。再度新規作成してください'),{status:409});
    const result=await this.client.request('thread/start',{cwd,approvalPolicy:'on-request',sandbox:editing?'workspace-write':'read-only',ephemeral:false,...(preferred?{model:preferred}:{})});
    const thread={...simplifyThread(result.thread),cwd:result.thread?.cwd||cwd};this.subscribed.add(thread.id);this.knownThreads.set(thread.id,thread);
    this.emit('event',{type:'thread',threadId:thread.id,thread});
    return {thread};
  }
  async ensureSubscribed(threadId) {
    if(this.subscribed.has(threadId))return;
    // A Desktop-owned thread may be readable but not resumable concurrently.
    await this.client.request('thread/resume',{threadId},{timeoutMs:60000});
    this.subscribed.add(threadId);
  }
  async startTurn({threadId,prompt,action='quest',editing=false,model=null,effort=null}) {
    if(!this.workspace)throw Object.assign(new Error('先にプロジェクトを選択してください'),{status:409});
    const cwd=this.workspace;
    if(!threadId||typeof prompt!=='string'||!prompt.trim()||prompt.length>10000||!Object.hasOwn(taskInstructions,action)) throw new Error('任務の内容が不正です');
    if((action==='fix'||action==='build')&&!editing)throw new Error('実装・修正には編集許可が必要です');
    if(this.running.has(threadId))throw new Error('このスレッドは実行中です');
    this.running.set(threadId,'starting');this.turnWorkspaces.set(threadId,cwd);
    try {
      const record=await this.readThread(threadId);
      if(!sameWorkspace(record.thread?.cwd,cwd)) throw Object.assign(new Error('別プロジェクトのチャットです。画面で所属プロジェクトを選択してください。'),{status:409});
      const selection=await this.selectedModel({model,effort});
      await this.ensureSubscribed(threadId);
      if(!sameWorkspace(this.workspace,cwd))throw Object.assign(new Error('プロジェクトが切り替わりました。送信をやり直してください'),{status:409});
      const text=action==='quest'?prompt.trim():`${taskInstructions[action]}\n\n【ユーザー依頼】\n${prompt.trim()}`;
      const input=[{type:'text',text}];
      const result=await this.client.request('turn/start',{threadId,input,cwd,...selection,approvalPolicy:'on-request',sandboxPolicy:editing?{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false}:{type:'readOnly'}},{timeoutMs:60000});
      const turnId=result?.turn?.id;
      if (!this.finishedTurns.has(turnId)) this.running.set(threadId,turnId||'started');
      else this.finishedTurns.delete(turnId);
      this.emit('event',{type:'turn-start',threadId,turnId,prompt:prompt.trim(),action,requestedModel:selection.model||null,requestedEffort:selection.effort||null});
      return {threadId,turnId,requestedModel:selection.model||null,requestedEffort:selection.effort||null};
    } catch(error) {this.running.delete(threadId);this.turnWorkspaces.delete(threadId);throw error;}
  }
  #clearApprovals(){
    for(const value of this.approvals.values())clearTimeout(value.timer);
    this.approvals.clear();
    this.emit('event',{type:'approval-reset'});
  }
  #rejectApprovalRequest(id,method){
    try{
      this.client.respondToServerRequest(id,method==='item/permissions/requestApproval'
        ? {permissions:{},scope:'turn'} : {decision:'decline'});
    }catch(error){this.emit('event',{type:'warning',text:'承認要求の拒否処理に失敗: '+error.message});}
  }
  #onApproval({id,method,params}){
    const threadId=params?.threadId,turnId=params?.turnId;
    const runningTurn=this.running.get(threadId);
    const workspace=this.turnWorkspaces.get(threadId);
    if(typeof threadId!=='string'||typeof turnId!=='string'||!workspace||
      !runningTurn||runningTurn!=='starting'&&runningTurn!=='started'&&runningTurn!==turnId){
      this.#rejectApprovalRequest(id,method);return;
    }
    const approvalId=String(++this.approvalSequence);
    const expiresAt=Date.now()+120_000;
    const timer=setTimeout(()=>{
      if(!this.approvals.has(approvalId))return;
      this.approvals.delete(approvalId);
      this.#rejectApprovalRequest(id,method);
      this.emit('event',{type:'approval-resolved',approvalId,threadId,decision:'decline',reason:'timeout'});
    },120_000);
    timer.unref?.();
    const isFile=method==='item/fileChange/requestApproval';
    const isPermissions=method==='item/permissions/requestApproval';
    // The permission profile is provided by the local Codex App Server, and
    // granting it is possible only through an explicit, scoped UI decision.
    const requestedPermissions=isPermissions?params.permissions:null;
    const entry={id,method,threadId,turnId,workspace,expiresAt,timer,requestedPermissions,
      public:{approvalId,threadId,turnId,workspace,expiresAt,
        kind:isPermissions?'permissions':isFile?'file':'command',
        command:params.command||null,cwd:params.cwd||null,
        reason:params.reason||null,grantRoot:params.grantRoot||null,
        networkHost:params.networkApprovalContext?.host||null,
        permissions:isPermissions?requestedPermissions:null}};
    this.approvals.set(approvalId,entry);
    this.emit('event',{type:'approval-request',approval:entry.public});
  }
  listApprovals(workspace=null){
    return {approvals:[...this.approvals.values()].filter(e=>!workspace||sameWorkspace(e.workspace,workspace)).map(e=>e.public)};
  }
  respondApproval({approvalId,decision,workspace}){
    if(!['accept','acceptForSession','decline','cancel'].includes(decision))
      throw Object.assign(new Error('承認操作が不正です'),{status:400});
    const entry=this.approvals.get(approvalId);
    if(!entry)throw Object.assign(new Error('承認要求は終了済みです'),{status:409});
    if(Date.now()>=entry.expiresAt){
      this.approvals.delete(approvalId);clearTimeout(entry.timer);
      this.#rejectApprovalRequest(entry.id,entry.method);
      this.emit('event',{type:'approval-resolved',approvalId,threadId:entry.threadId,decision:'decline',reason:'timeout'});
      throw Object.assign(new Error('承認要求は期限切れです'),{status:409});
    }
    if(!sameWorkspace(entry.workspace,workspace)||!sameWorkspace(entry.workspace,this.workspace))
      throw Object.assign(new Error('対象プロジェクトが一致しません'),{status:409});
    const runningTurn=this.running.get(entry.threadId);
    if(!runningTurn||runningTurn!=='starting'&&runningTurn!=='started'&&runningTurn!==entry.turnId)
      throw Object.assign(new Error('対象ターンは終了しています'),{status:409});
    let response;
    if(entry.method==='item/permissions/requestApproval'){
      const requested=entry.requestedPermissions;
      const granted={};
      if(decision==='accept'||decision==='acceptForSession'){
        if(!requested||typeof requested!=='object'||Array.isArray(requested))
          throw Object.assign(new Error('追加権限の内容が不正です'),{status:409});
        if(requested.network!=null)granted.network=requested.network;
        if(requested.fileSystem!=null)granted.fileSystem=requested.fileSystem;
      }
      response={permissions:granted,scope:decision==='acceptForSession'?'session':'turn'};
    }else response={decision};
    this.client.respondToServerRequest(entry.id,response);
    this.approvals.delete(approvalId);clearTimeout(entry.timer);
    this.emit('event',{type:'approval-resolved',approvalId,threadId:entry.threadId,decision});
    return {ok:true,approvalId,decision};
  }
  async interrupt(threadId){
    const turnId=this.running.get(threadId);
    if(!turnId||turnId==='starting')throw new Error('停止可能な実行がありません');
    for(const [key,entry] of this.approvals){
      if(entry.threadId!==threadId)continue;
      this.approvals.delete(key);clearTimeout(entry.timer);
      this.#rejectApprovalRequest(entry.id,entry.method)
      this.emit('event',{type:'approval-resolved',approvalId:key,threadId,decision:'cancel'});
    }
    await this.client.request('turn/interrupt',{threadId,turnId});
    return {ok:true};
  }
  async usage() {
    const [limits, account]=await Promise.allSettled([
      this.client.request('account/rateLimits/read',{}),
      this.client.request('account/read',{refreshToken:false})
    ]);
    const info=summarizeRateLimits(limits.status==='fulfilled'?limits.value:null);
    const a=account.status==='fulfilled'?account.value?.account:null;
    return {...info,authType:a?.type||null,planType:a?.planType||null,source:'app-server',sessionTokens:[...this.tokenUsage.entries()].map(([threadId,usage])=>({threadId,usage})),error:limits.status==='rejected'?limits.reason.message:null};
  }
  #notification({method,params}) {
    const threadId=params.threadId||params.thread?.id||null;
    if(method==='thread/tokenUsage/updated' && threadId)this.tokenUsage.set(threadId,params.tokenUsage||params);
    if(method==='turn/completed' && threadId){
      for(const [key,entry] of this.approvals)if(entry.threadId===threadId){
        this.approvals.delete(key);clearTimeout(entry.timer);
        this.#rejectApprovalRequest(entry.id,entry.method)
        this.emit('event',{type:'approval-resolved',approvalId:key,threadId,decision:'cancel'});
      }
      this.running.delete(threadId);this.turnWorkspaces.delete(threadId);if(params.turn?.id)this.finishedTurns.add(params.turn.id);}
    const forwarded = ['thread/started','thread/name/updated','thread/status/changed','thread/tokenUsage/updated','turn/started','turn/completed','item/started','item/completed','item/agentMessage/delta','item/commandExecution/outputDelta','turn/plan/updated','turn/diff/updated','account/rateLimits/updated'];
    if(forwarded.includes(method))this.emit('event',{type:'codex',method,threadId,params});
  }
}
