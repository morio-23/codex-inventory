import { EventEmitter } from 'node:events';
import { resolve, relative, isAbsolute, win32, basename } from 'node:path';
import {realpathSync} from 'node:fs';
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

function withinWorkspace(path,workspace){
  if(typeof path!=='string'||typeof workspace!=='string'||
    !(isAbsolute(path)||win32.isAbsolute(path)))return false;
  try{
    const target=realpathSync(path),root=realpathSync(workspace);
    const windows=/^[A-Za-z]:[\\/]|^\\\\/.test(root);
    const delta=windows?win32.relative(root,target):relative(root,target);
    return delta===''||delta!=='..'&&!delta.startsWith(windows?'..\\':'../')&&
      !(windows?win32.isAbsolute(delta):isAbsolute(delta));
  }catch{return false;}
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
  return {id:thread.id,name:typeof thread.name==='string'?thread.name:null,preview:thread.preview||'',cwd:thread.cwd||'',createdAt:thread.createdAt||0,updatedAt:thread.updatedAt||0,source:thread.source||null,status:thread.status||null};
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
    this.connectionEpoch=0;this.needsRecovery=true;this.recoveryPromise=null;
    this.knownProjects=new Set(Array.isArray(knownProjects)?knownProjects.filter(x=>typeof x==='string'&&x.length<=4096):[]);
    this.approvals=new Map();this.approvalSequence=0;this.turnWorkspaces=new Map();
    this.running=new Map();this.editingThreads=new Set();this.finishedTurns=new Set();this.recentCompletions=[];this.earlyCompletions=new Map();this.earlyApprovals=new Map();this.subscribed=new Set();this.tokenUsage=new Map();this.knownThreads=new Map();this.freshEmptyThreads=new Set();
    client.on('notification',e=>this.#notification(e));
    client.on('server-request',e=>this.#onApproval(e));
    client.on('disconnect',error=>{this.connectionEpoch++;this.needsRecovery=true;this.#clearApprovals();this.turnWorkspaces.clear();this.running.clear();this.editingThreads.clear();this.finishedTurns.clear();this.recentCompletions=[];this.earlyCompletions.clear();this.earlyApprovals.clear();this.subscribed.clear();this.freshEmptyThreads.clear();this.emit('event',{type:'connection',error:error.message});});
    client.on('warning',message=>this.emit('event',{type:'warning',text:message}));
  }
  async start(){
    await this.client.start();
    if(!this.needsRecovery)return;
    if(!this.recoveryPromise){
      const epoch=this.connectionEpoch;
      this.recoveryPromise=this.#recoverRunning(epoch).then(()=>{
        if(epoch===this.connectionEpoch)this.needsRecovery=false;
      }).finally(()=>{this.recoveryPromise=null;});
    }
    await this.recoveryPromise;
  }
  async #recoverRunning(epoch){
    const {threads}=await this.listThreads({all:true});
    for(const thread of threads){
      if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
      if(thread.status?.type!=='active')continue;
      let workspace;
      try{workspace=await this.validateWorkspace(thread.cwd);}catch{continue;}
      const response=await this.client.request('thread/read',
        {threadId:thread.id,includeTurns:true},{timeoutMs:60000});
      const turn=[...(response.thread?.turns||[])].reverse().find(item=>
        item?.status==='inProgress'||item?.status==='in_progress');
      if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
      if(typeof turn?.id!=='string'||!sameWorkspace(response.thread?.cwd,workspace))continue;
      this.running.set(thread.id,turn.id);this.turnWorkspaces.set(thread.id,workspace);
      // The App Server does not expose the original sandbox choice here.
      // Treat an unknown recovered turn as an editor for conservative warnings.
      this.editingThreads.add(thread.id);
    }
    this.#emitActivityState();
  }
  activityState(){
    const groups=[];
    for(const threadId of this.running.keys()){
      const workspace=this.turnWorkspaces.get(threadId);
      if(!workspace)continue;
      let group=groups.find(item=>sameWorkspace(item.workspace,workspace));
      if(!group){group={workspace,threadIds:[],editing:0};groups.push(group);}
      group.threadIds.push(threadId);
      if(this.editingThreads.has(threadId))group.editing++;
    }
    return {runningThreadIds:[...this.running.keys()],runningTurns:[...this.running]
      .filter(([,turnId])=>turnId!=='starting'&&turnId!=='started')
      .map(([threadId,turnId])=>({threadId,turnId})),recentCompletions:[...this.recentCompletions],workspaceConflicts:groups
      .filter(item=>item.editing>1)
      .map(item=>({threadIds:item.threadIds,reason:'parallel-edits'}))};
  }
  #emitActivityState(){this.emit('event',{type:'activity-state',...this.activityState()});}
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
  /** Explicit request context validated independently of the project picker. */
  async validateWorkspace(cwd){
    if(typeof cwd!=='string'||!cwd||cwd.length>4096)
      throw Object.assign(new Error('プロジェクト指定の形式が不正です'),{status:400});
    if(!this.autoDiscover){
      if(!sameWorkspace(cwd,this.workspace))throw Object.assign(new Error('固定ワークスペース以外を指定できません'),{status:403});
      try{if(!(await stat(await realpath(this.workspace))).isDirectory())throw Error('not a directory');}
      catch{throw Object.assign(new Error('固定ワークスペースが変更・削除されています'),{status:409});}
      return this.workspace;
    }
    const {projects}=await this.discoverProjects({force:true});
    const match=projects.find(item=>item.exists&&sameWorkspace(item.cwd,cwd));
    if(!match)throw Object.assign(new Error('登録または検出済みのプロジェクトを指定してください'),{status:403});
    try{
      const canonical=await realpath(match.cwd),info=await stat(canonical);
      if(!info.isDirectory()||canonical!==match.canonicalPath)throw Error('invalid workspace');
    }catch{
      throw Object.assign(new Error('選択プロジェクトが変更・削除されています'),{status:409});
    }
    return match.cwd;
  }
  async readThread(id) {
    let response;
    try {response=await this.client.request('thread/read',{threadId:id,includeTurns:true},{timeoutMs:60000});}
    catch(error){
      // Some paginated stores reject full history for a brand-new thread with
      // -32601: "list_turns is not supported yet". Treat it as empty ONLY if
      // this App Server process just created the ID, no turn has begun, and
      // an independent metadata-only read still confirms idle/no preview.
      // Never invent empty history for an arbitrary persisted/Desktop thread.
      if(error.code===-32601&&/list_turns is not supported yet/i.test(error.message)&&
         this.freshEmptyThreads.has(id)){
        const meta=await this.readThreadForTurn(id);
        if(meta.rawStatus?.type==='idle'&&!meta.thread.preview)
          return {...meta,messages:[]};
      }
      if(!/not materialized yet.*includeTurns|rollout .* is empty/.test(error.message))throw error;
      const thread=this.knownThreads.get(id)||(await this.listThreads({all:true})).threads.find(item=>item.id===id);
      if(!thread)throw error;
      return {thread,messages:[],rawStatus:thread.status};
    }
    return {thread:simplifyThread(response.thread),messages:projectHistory(response.thread),rawStatus:response.thread.status};
  }
  /** Minimal read before a turn. Never hydrate history just to validate
   *  workspace ownership or whether another client owns the active turn.
   *  Paginated or unmaterialized threads can reject includeTurns:true with
   *  JSON-RPC -32601 (unsupported list_turns), even on the first user turn.
   *  A failed metadata read always fails closed; no guessing from cached IDs.
   */
  async readThreadForTurn(id) {
    const response=await this.client.request('thread/read',
      {threadId:id,includeTurns:false},{timeoutMs:60000});
    const raw=response?.thread;
    if(!raw||raw.id!==id||typeof raw.cwd!=='string'||!raw.cwd||
       typeof raw.status?.type!=='string')
      throw Object.assign(new Error('チャットの安全確認に必要なメタデータを取得できません'),{status:409});
    return {thread:simplifyThread(raw),rawStatus:raw.status};
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
  async createThread({editing=false,model=null,effort=null,workspace=null}={}) {
    await this.start();
    const epoch=this.connectionEpoch;
    const cwd=workspace?await this.validateWorkspace(workspace):this.workspace;
    if(!cwd)throw Object.assign(new Error('先にプロジェクトを選択してください'),{status:409});
    const selected=await this.selectedModel({model,effort});
    const preferred=selected.model||((await this.listModels().catch(()=>null))?.defaultModel);
    await this.validateWorkspace(cwd);
    if(!workspace&&!sameWorkspace(this.workspace,cwd))throw Object.assign(new Error('プロジェクトが切り替わりました。再度新規作成してください'),{status:409});
    if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
    const result=await this.client.request('thread/start',{cwd,approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:editing?'workspace-write':'read-only',ephemeral:false,...(preferred?{model:preferred}:{})});
    const thread={...simplifyThread(result.thread),cwd:result.thread?.cwd||cwd};this.subscribed.add(thread.id);this.knownThreads.set(thread.id,thread);this.freshEmptyThreads.add(thread.id);
    this.emit('event',{type:'thread',threadId:thread.id,thread});
    return {thread};
  }
  async ensureSubscribed(threadId) {
    if(this.subscribed.has(threadId))return;
    // A Desktop-owned thread may be readable but not resumable concurrently.
    await this.client.request('thread/resume',{threadId},{timeoutMs:60000});
    this.subscribed.add(threadId);
  }
  // Only an enumerated stage identifier may be surfaced to the renderer.
  // Do not store or display the raw Codex RPC error, paths or prompt.
  async #turnPhase(stage,operation){
    try{return await operation();}
    catch(error){
      if(error&&typeof error==='object')error.turnStage=stage;
      throw error;
    }
  }
  async startTurn({threadId,prompt,action='quest',editing=false,model=null,effort=null,workspace=null}) {
    await this.#turnPhase('APP_SERVER_INIT',()=>this.start());
    const epoch=this.connectionEpoch;
    const cwd=workspace?await this.#turnPhase('WORKSPACE_CHECK',()=>this.validateWorkspace(workspace)):this.workspace;
    if(!cwd)throw Object.assign(new Error('先にプロジェクトを選択してください'),{status:409,turnStage:'WORKSPACE_CHECK'});
    if(!threadId||typeof prompt!=='string'||!prompt.trim()||prompt.length>10000||!Object.hasOwn(taskInstructions,action)) throw new Error('任務の内容が不正です');
    if((action==='fix'||action==='build')&&!editing)throw new Error('実装・修正には編集許可が必要です');
    if(this.running.has(threadId))throw new Error('このスレッドは実行中です');
    this.running.set(threadId,'starting');this.turnWorkspaces.set(threadId,cwd);
    if(editing)this.editingThreads.add(threadId);
    this.#emitActivityState();
    try {
      const record=await this.#turnPhase('THREAD_READ',()=>this.readThreadForTurn(threadId));
      if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
      if(!sameWorkspace(record.thread?.cwd,cwd)) throw Object.assign(new Error('別プロジェクトのチャットです。画面で所属プロジェクトを選択してください。'),{status:409});
      if(record.rawStatus?.type==='active')throw Object.assign(new Error('このスレッドは別のクライアントで実行中です'),{status:409});
      const selection=await this.#turnPhase('MODEL_SELECTION',()=>this.selectedModel({model,effort}));
      if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
      await this.#turnPhase('THREAD_RESUME',()=>this.ensureSubscribed(threadId));
      if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
      await this.#turnPhase('WORKSPACE_CHECK',()=>this.validateWorkspace(cwd));
      if(!workspace&&!sameWorkspace(this.workspace,cwd))throw Object.assign(new Error('プロジェクトが切り替わりました。送信をやり直してください'),{status:409,turnStage:'WORKSPACE_CHECK'});
      const text=action==='quest'?prompt.trim():`${taskInstructions[action]}\n\n【ユーザー依頼】\n${prompt.trim()}`;
      const input=[{type:'text',text,text_elements:[]}];
      const result=await this.#turnPhase('TURN_START_RPC',()=>this.client.request('turn/start',{threadId,input,cwd,...selection,approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:editing?
        {type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,
          excludeTmpdirEnvVar:true,excludeSlashTmp:true}:
        {type:'readOnly',networkAccess:false}},{timeoutMs:60000}));
      if(epoch!==this.connectionEpoch)throw Object.assign(new Error('接続が切り替わりました'),{status:409});
      const turnId=result?.turn?.id;
      this.freshEmptyThreads.delete(threadId);
      const early=this.earlyCompletions.get(threadId)?.get(turnId);
      this.earlyCompletions.delete(threadId);
      const completedEarly=early||null;
      if (!this.finishedTurns.has(turnId)&&!completedEarly) this.running.set(threadId,turnId||'started');
      else {this.finishedTurns.delete(turnId);this.running.delete(threadId);this.turnWorkspaces.delete(threadId);this.editingThreads.delete(threadId);}
      this.#drainEarlyApprovals(threadId,completedEarly?null:turnId);
      this.#emitActivityState();
      this.emit('event',{type:'turn-start',threadId,turnId,prompt:prompt.trim(),action,requestedModel:selection.model||null,requestedEffort:selection.effort||null});
      if(completedEarly)this.emit('event',{type:'codex',method:'turn/completed',threadId,params:completedEarly});
      return {threadId,turnId,requestedModel:selection.model||null,requestedEffort:selection.effort||null};
    } catch(error) {if(epoch===this.connectionEpoch){this.#drainEarlyApprovals(threadId,null);this.running.delete(threadId);this.turnWorkspaces.delete(threadId);this.editingThreads.delete(threadId);this.earlyCompletions.delete(threadId);this.#emitActivityState();}throw error;}
  }
  #drainEarlyApprovals(threadId,turnId){
    const requests=this.earlyApprovals.get(threadId)||[];
    this.earlyApprovals.delete(threadId);
    for(const request of requests){
      if(turnId&&request.params?.turnId===turnId)this.#onApproval(request);
      else this.#rejectApprovalRequest(request.id,request.method);
    }
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
      params.cwd!=null&&!withinWorkspace(params.cwd,workspace)||
      params.grantRoot!=null&&!withinWorkspace(params.grantRoot,workspace)||
      method==='item/commandExecution/requestApproval'&&params.kind!==undefined&&params.kind!=='command'){
      this.#rejectApprovalRequest(id,method);return;
    }
    if(runningTurn==='starting'){
      const pending=this.earlyApprovals.get(threadId)||[];
      if(pending.length>=10){this.#rejectApprovalRequest(id,method);return;}
      pending.push({id,method,params});this.earlyApprovals.set(threadId,pending);
      return;
    }
    if(runningTurn!==turnId){this.#rejectApprovalRequest(id,method);return;}
    const approvalId=String(++this.approvalSequence);
    const expiresAt=Date.now()+120_000;
    const timer=setTimeout(()=>{
      if(!this.approvals.has(approvalId))return;
      this.approvals.delete(approvalId);
      this.#rejectApprovalRequest(id,method);
      this.emit('event',{type:'approval-resolved',approvalId,threadId,turnId,decision:'decline',reason:'timeout'});
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
  respondApproval({approvalId,decision,workspace,threadId=null,turnId=null,explicit=false}){
    if(!['accept','acceptForSession','decline','cancel'].includes(decision))
      throw Object.assign(new Error('承認操作が不正です'),{status:400});
    const entry=this.approvals.get(approvalId);
    if(!entry)throw Object.assign(new Error('承認要求は終了済みです'),{status:409});
    if(Date.now()>=entry.expiresAt){
      this.approvals.delete(approvalId);clearTimeout(entry.timer);
      this.#rejectApprovalRequest(entry.id,entry.method);
      this.emit('event',{type:'approval-resolved',approvalId,threadId:entry.threadId,turnId:entry.turnId,decision:'decline',reason:'timeout'});
      throw Object.assign(new Error('承認要求は期限切れです'),{status:409});
    }
    if(explicit&&(typeof threadId!=='string'||typeof turnId!=='string'))
      throw Object.assign(new Error('承認対象のチャットとターンを指定してください'),{status:400});
    if((threadId!==null||turnId!==null)&&(threadId!==entry.threadId||turnId!==entry.turnId))
      throw Object.assign(new Error('承認対象のチャットまたはターンが一致しません'),{status:409});
    if(threadId===null&&turnId===null&&[...this.approvals.values()]
      .filter(value=>sameWorkspace(value.workspace,workspace)).length>1)
      throw Object.assign(new Error('複数の承認要求があります。対象を指定してください'),{status:409});
    if(!sameWorkspace(entry.workspace,workspace)||(!explicit&&!sameWorkspace(entry.workspace,this.workspace)))
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
    this.emit('event',{type:'approval-resolved',approvalId,threadId:entry.threadId,turnId:entry.turnId,decision});
    return {ok:true,approvalId,decision};
  }
  async interrupt(threadId,{workspace=this.workspace,turnId:expectedTurnId=null}={}){
    await this.start();
    const turnId=this.running.get(threadId);
    if(!turnId||turnId==='starting')throw new Error('停止可能な実行がありません');
    if(!sameWorkspace(this.turnWorkspaces.get(threadId),workspace)||
      expectedTurnId!==null&&expectedTurnId!==turnId)
      throw Object.assign(new Error('対象ターンまたはプロジェクトが一致しません'),{status:409});
    for(const [key,entry] of this.approvals){
      if(entry.threadId!==threadId)continue;
      this.approvals.delete(key);clearTimeout(entry.timer);
      this.#rejectApprovalRequest(entry.id,entry.method)
      this.emit('event',{type:'approval-resolved',approvalId:key,threadId,turnId:entry.turnId,decision:'cancel'});
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
    if(method==='turn/started'&&threadId&&this.running.has(threadId)){
      const active=this.running.get(threadId);
      if(active==='starting'||active!==params.turn?.id)return;
    }
    if(method==='turn/completed' && threadId){
      const active=this.running.get(threadId),completedId=params.turn?.id;
      if(active==='starting'){
        if(typeof completedId==='string'){
          let pending=this.earlyCompletions.get(threadId);
          if(!pending){pending=new Map();this.earlyCompletions.set(threadId,pending);}
          pending.set(completedId,params);
          while(pending.size>10)pending.delete(pending.keys().next().value);
        }
        return;
      }
      if(active!==completedId||typeof completedId!=='string')return;
      for(const [key,entry] of this.approvals)if(entry.threadId===threadId){
        this.approvals.delete(key);clearTimeout(entry.timer);
        this.#rejectApprovalRequest(entry.id,entry.method)
        this.emit('event',{type:'approval-resolved',approvalId:key,threadId,turnId:entry.turnId,decision:'cancel'});
      }
      this.running.delete(threadId);this.turnWorkspaces.delete(threadId);this.editingThreads.delete(threadId);
      this.finishedTurns.add(completedId);
      while(this.finishedTurns.size>100)this.finishedTurns.delete(this.finishedTurns.values().next().value);
      this.recentCompletions.push({threadId,turnId:completedId,
        status:['completed','failed','interrupted'].includes(params.turn.status)?params.turn.status:'completed'});
      if(this.recentCompletions.length>50)this.recentCompletions.shift();
      this.#emitActivityState();}
    const forwarded = ['thread/started','thread/name/updated','thread/status/changed','thread/tokenUsage/updated','turn/started','turn/completed','item/started','item/completed','item/agentMessage/delta','item/commandExecution/outputDelta','turn/plan/updated','turn/diff/updated','account/rateLimits/updated'];
    if(forwarded.includes(method))this.emit('event',{type:'codex',method,threadId,params});
  }
}
