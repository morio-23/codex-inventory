import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AppServerClient} from './app-server-client.mjs';
import {CodexService,taskInstructions,sameWorkspace} from './codex-service.mjs';
import {listLocalTools,runLocalTool} from './local-tools.mjs';
import {createScriptApprovalStore} from './script-approvals.mjs';
import {ResetCreditService} from './reset-credit-service.mjs';
import {listPromptTemplates} from './prompt-templates.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const configuredWorkspace=process.env.CODEX_WORKSPACE?resolve(process.env.CODEX_WORKSPACE):null;
const workspace=configuredWorkspace;
const host='127.0.0.1';
const port=Number(process.env.PORT||8765);
const execFileAsync=promisify(execFile);
const assets=new Map([
  ['/',['public/index.html','text/html; charset=utf-8']],
  ['/styles.css',['public/styles.css','text/css; charset=utf-8']],
  ['/app.js',['public/app.js','text/javascript; charset=utf-8']],
  ['/markdown.js',['public/markdown.js','text/javascript; charset=utf-8']],
  ['/inventory-state.js',['public/inventory-state.js','text/javascript; charset=utf-8']],
  ['/i18n.js',['public/i18n.js','text/javascript; charset=utf-8']],
  ['/strings.en.js',['public/strings.en.js','text/javascript; charset=utf-8']],
  ['/templates.en.js',['public/templates.en.js','text/javascript; charset=utf-8']]
]);
export {taskInstructions};
export function allowedRequest(req, localPort=port) {
  const hostHeader=req.headers.host||'';
  if(![`localhost:${localPort}`,`127.0.0.1:${localPort}`].includes(hostHeader))return false;
  if(!['GET','POST'].includes(req.method))return false;
  if(req.method==='GET')return true;
  const origin=req.headers.origin;
  return (!origin||origin===`http://${hostHeader}`) && (req.headers['content-type']||'').startsWith('application/json');
}
export function json(res,status,value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  let raw='';
  for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>50_000)throw Object.assign(new Error('入力が大きすぎます'),{status:413});}
  try {return JSON.parse(raw);}catch{throw Object.assign(new Error('JSONが不正です'),{status:400});}
}
const validThreadId=id=>/^[A-Za-z0-9_-]{1,128}$/.test(id);
const validModelChoice=value=>['model','effort'].every(key=>
  !Object.hasOwn(value,key)||value[key]===null||
  (typeof value[key]==='string'&&value[key].length<=128));
function sendEvent(res,event){if(!res.destroyed&&!res.writableEnded)res.write(`data: ${JSON.stringify(event)}\n\n`);}

export function createHandler({service,port:localPort=port,workspace:cwd=workspace,root:assetRoot=root}={}) {
  if(!service)throw new Error('service is required');
  const listeners=new Set();
  const approvals=createScriptApprovalStore();
  const resetCredits=new ResetCreditService(service.client);
  const activeWorkspace=()=>service.autoDiscover?service.workspace:(cwd||service.workspace);
  const requireWorkspace=()=>{ 
    const value=activeWorkspace();
    if(!value)throw Object.assign(new Error('App Serverで検出したプロジェクトを選択してください'),{status:409});
    return value;
  };
  const scopedWorkspace=req=>{
    const cwd=requireWorkspace();
    // Unicode workspace paths must arrive encoded as ASCII in HTTP headers.
    // Invalid percent/UTF-8 sequences must fail closed, not bypass the
    // protection against a stale tab writing to another selected project.
    const header=req.headers['x-codex-workspace'];
    let requestedWorkspace=null;
    if(typeof header==='string'){
      try{requestedWorkspace=decodeURIComponent(header);}catch{}
    }
    if(service.autoDiscover&&!sameWorkspace(requestedWorkspace,cwd))
      throw Object.assign(new Error('プロジェクトが切り替わりました。画面を更新して再実行してください'),{status:409});
    return cwd;
  };
  service.on('event',event=>{for(const res of listeners)sendEvent(res,event);});
  return async function handle(req,res) {
    try {
      if(!allowedRequest(req,localPort))return json(res,403,{error:'ローカルホストからのみ利用できます。'});
      const url=new URL(req.url||'/',`http://${host}:${localPort}`);
      const path=url.pathname;
      if(req.method==='GET'&&path==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(': connected\n\n');listeners.add(res);
        const ping=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},20000);ping.unref?.();
        req.on('close',()=>{clearInterval(ping);listeners.delete(res);});return;
      }
      if(req.method==='GET'&&path==='/api/status'){
        try{
          await service.start();
          let discoveryError=null;
          if(service.autoDiscover){
            try{await service.discoverProjects();}
            catch(error){discoveryError=error.message;}
          }
          const selected=activeWorkspace();
          let exists=false;try{exists=selected?(await stat(selected)).isDirectory():false;}catch{}
          return json(res,200,{exists,workspace:selected,autoDiscover:!!service.autoDiscover,
            projectCount:service.projects?.length||0,discoveryError,
            connected:true,active:service.running.size,demo:process.env.CODEX_DEMO==='1'});
        }catch(e){
          return json(res,200,{exists:false,workspace:activeWorkspace(),
            autoDiscover:!!service.autoDiscover,connected:false,active:0,error:e.message});
        }
      }
      if(req.method==='GET'&&path==='/api/projects'){
        await service.start();
        return json(res,200,await service.discoverProjects({force:url.searchParams.get('refresh')==='1'}));
      }
      if(req.method==='POST'&&path==='/api/projects/select'){
        const input=await readJson(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||
          Object.keys(input).length!==1||typeof input.cwd!=='string')
          return json(res,400,{error:'プロジェクト指定の形式が不正です'});
        return json(res,200,await service.selectProject(input.cwd));
      }
      if(req.method==='GET'&&path==='/api/models'){
        await service.start();
        return json(res,200,await service.listModels());
      }
      if(req.method==='GET'&&path==='/api/threads')return json(res,200,await service.listThreads({all:url.searchParams.get('all')==='1'}));
      if(req.method==='POST'&&path==='/api/threads'){
        const data=await readJson(req);
        if(!data||typeof data!=='object'||Array.isArray(data)||
          typeof data.editing!=='boolean'||!validModelChoice(data))
          return json(res,400,{error:'モデル・推論レベルまたは編集許可の指定が不正です'});
        scopedWorkspace(req);
        return json(res,201,await service.createThread(data));
      }
      const m=path.match(/^\/api\/threads\/([^/]+)(?:\/(turn|interrupt))?$/);
      if(m){
        const id=m[1];if(!validThreadId(id))return json(res,400,{error:'不正なスレッドIDです'});
        if(req.method==='GET'&&!m[2])return json(res,200,await service.readThread(id));
        if(req.method==='POST'&&m[2]==='turn'){
          const input=await readJson(req);
          if(!input||typeof input!=='object'||Array.isArray(input)||
            typeof input.editing!=='boolean'||typeof input.prompt!=='string'||
            typeof input.action!=='string'||!validModelChoice(input))
            return json(res,400,{error:'モデル・推論レベルまたは入力形式が不正です'});
          scopedWorkspace(req);
          return json(res,202,await service.startTurn({threadId:id,...input}));
        }
        if(req.method==='POST'&&m[2]==='interrupt'){
          const current=scopedWorkspace(req);
          if(service.autoDiscover){
            const record=await service.readThread(id);
            if(!sameWorkspace(record.thread?.cwd,current))
              return json(res,409,{error:'別プロジェクトのチャットは中断できません。所属先を選択してください'});
          }
          return json(res,200,await service.interrupt(id));
        }
      }
      if(req.method==='GET'&&path==='/api/approvals'){
        const requestedWorkspace=scopedWorkspace(req);
        return json(res,200,service.listApprovals(requestedWorkspace));
      }
      const approvalMatch=path.match(/^\/api\/approvals\/([0-9]+)\/respond$/);
      if(req.method==='POST'&&approvalMatch){
        if(req.headers.origin!==`http://${req.headers.host}`)
          return json(res,403,{error:'承認は同一オリジンの画面からのみ操作できます'});
        const requestedWorkspace=scopedWorkspace(req);
        const input=await readJson(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||
          Object.keys(input).length!==1||typeof input.decision!=='string')
          return json(res,400,{error:'承認の入力形式が不正です'});
        return json(res,200,service.respondApproval({
          approvalId:approvalMatch[1],decision:input.decision,workspace:requestedWorkspace
        }));
      }
      if(req.method==='GET'&&path==='/api/usage')return json(res,200,await service.usage());
      if(req.method==='POST'&&path.startsWith('/api/reset-credits/')){
        if(req.headers.origin!==`http://${req.headers.host}`)
          return json(res,403,{error:'チケットの使用は同一オリジンの画面からのみ行えます'});
        const input=await readJson(req);
        if(!input||typeof input!=='object'||Array.isArray(input))
          return json(res,400,{error:'入力形式が不正です'});
        if(path==='/api/reset-credits/prepare'){
          if(Object.keys(input).some(k=>k!=='creditId'))
            return json(res,400,{error:'チケットの指定が不正です'});
          return json(res,200,await resetCredits.prepare({creditId:input.creditId??null}));
        }
        if(path==='/api/reset-credits/confirm'){
          if(Object.keys(input).length!==1||typeof input.confirmationToken!=='string')
            return json(res,400,{error:'最終確認の情報が不正です'});
          return json(res,200,await resetCredits.confirm(input.confirmationToken));
        }
      }
      if(req.method==='GET'&&path==='/api/items')return json(res,200,{items:listLocalTools()});
      if(req.method==='GET'&&path==='/api/templates')return json(res,200,{templates:listPromptTemplates()});
      const previewMatch=path.match(/^\/api\/local-tools\/(project-test|project-lint)\/preview$/);
      if(req.method==='GET'&&previewMatch)
        return json(res,200,await approvals.issue(previewMatch[1],scopedWorkspace(req)));
      const localMatch=path.match(/^\/api\/local-tools\/([a-z0-9-]+)$/);
      if(req.method==='POST'&&localMatch){
        const input=await readJson(req);
        if(!input||typeof input!=='object'||Array.isArray(input))
          return json(res,400,{error:'入力形式が不正です'});
        const cwd=scopedWorkspace(req);
        const requiresApproval=['project-test','project-lint'].includes(localMatch[1]);
        let approval;
        if(requiresApproval){
          if(Object.keys(input).length!==1||typeof input.approvalToken!=='string')
            return json(res,403,{error:'プレビュー画面での実行承認が必要です'});
          approval=approvals.consume(localMatch[1],cwd,input.approvalToken);
        }
        const controller=new AbortController();
        res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        return json(res,200,await runLocalTool(localMatch[1],{workspace:cwd,input,approval,signal:controller.signal}));
      }
      if(req.method==='GET'&&path==='/api/diff'){
        const cwd=scopedWorkspace(req);
        const [status,diff]=await Promise.all([
          execFileAsync('git',['status','--short'],{cwd,maxBuffer:1_000_000}),
          execFileAsync('git',['diff','--no-ext-diff','--stat'],{cwd,maxBuffer:1_000_000})
        ]);
        return json(res,200,{status:status.stdout||'(変更なし)',diff:diff.stdout||'(差分なし)'});
      }
      if(req.method==='GET'&&assets.has(path)){
        const [relative,type]=assets.get(path);
        const content=await readFile(join(assetRoot,relative));
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(content);
      }
      return json(res,404,{error:'見つかりません'});
    }catch(e){
      if(!res.headersSent)return json(res,e.status||(/already|実行中|再開/.test(e.message)?409:503),{error:e.message});
      res.end();
    }
  };
}

/**
 * Electron embeds this HTTP server in its own main process.
 * There is no fixed port, no Node.js prerequisite and no independent shell.
 * The user's native Codex CLI is still spawned via stdio JSON-RPC.
 */
export async function startInventoryServer({
  command,commandArgs=['app-server'],commandEnv=process.env,
  cwd=process.env.USERPROFILE||process.env.HOME||process.cwd(),
  selectedWorkspace=null,listenPort=0,knownProjects=[]
}={}){
  if(typeof command!=='string'||!command)throw new Error('Codex CLI実行ファイルが未選択です');
  const active=selectedWorkspace?resolve(selectedWorkspace):null;
  const client=new AppServerClient({
    command,args:commandArgs,cwd,env:commandEnv,
    timeoutMs:Number(process.env.CODEX_RPC_TIMEOUT_MS)||30000
  });
  const service=new CodexService(client,{
    workspace:active||cwd,
    autoDiscover:!active,knownProjects
  });
  const server=http.createServer();
  let closed=false;
  async function stop(){
    if(closed)return;
    closed=true;
    client.close();
    server.closeAllConnections?.();
    await new Promise(resolve=>{
      if(!server.listening){resolve();return;}
      server.close(()=>resolve());
    });
  }
  try{
    await new Promise((resolveStart,rejectStart)=>{
      server.once('error',rejectStart);
      server.listen(listenPort,'127.0.0.1',()=>{
        server.off('error',rejectStart);resolveStart();
      });
    });
    const actualPort=server.address().port;
    server.on('request',createHandler({
      service,port:actualPort,workspace:active,root
    }));
    await service.start();
    // Discovery is best effort: the UI handles no project/old CLI separately.
    await service.discoverProjects().catch(error=>
      console.warn('Codex project discovery:',error.message));
    return {
      url:`http://127.0.0.1:${actualPort}/`,
      port:actualPort,service,client,stop
    };
  }catch(error){
    await stop();
    throw error;
  }
}

if(process.env.CODEX_NO_LISTEN!=='1' && process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let client;
  if(process.env.CODEX_DEMO==='1')client=new AppServerClient({command:process.execPath,args:[join(root,'tests/fixtures/mock-app-server.mjs')],cwd:root,timeoutMs:Number(process.env.CODEX_RPC_TIMEOUT_MS)||30000});
  else client=new AppServerClient({cwd:workspace||root,timeoutMs:Number(process.env.CODEX_RPC_TIMEOUT_MS)||30000});
  const service=new CodexService(client,{workspace:workspace||root,autoDiscover:!configuredWorkspace});
  const httpServer=http.createServer(createHandler({service}));
  if(process.send)process.on('message',message=>{
    if(message==='shutdown'){
      client.close();
      httpServer.closeAllConnections();
      httpServer.close(()=>process.exit(0));
    }
  });
  httpServer.listen(port,host,()=>{
    console.log(`Codex Inventory v0.6: http://${host}:${port}\nMode: ${workspace?'固定 '+workspace:'自動検出（Codex App Server履歴）'}\nBackend: Codex App Server`);
    service.start().catch(error=>console.error('Codex App Server:',error.message));
  });
}
