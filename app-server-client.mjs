import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

/** One stdio JSON-RPC transport per Inventory process. Never reads auth token files. */
export class AppServerClient extends EventEmitter {
  constructor({command = process.env.CODEX_BIN || 'codex', args = ['app-server'], cwd = process.cwd(), env = process.env, spawnProcess = spawn, timeoutMs = 30000} = {}) {
    super();
    Object.assign(this, {command, args, cwd, env, spawnProcess, timeoutMs});
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.child = null;
    this.readyPromise = null;
    this.closed = false;
    this.stderrTail = '';
  }
  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.#launch().catch(error => { this.readyPromise = null; throw error; });
    return this.readyPromise;
  }
  async #launch() {
    this.closed = false;
    let child;
    try { child = this.spawnProcess(this.command, this.args, {cwd:this.cwd, env:this.env, stdio:['pipe','pipe','pipe'], windowsHide:true, shell:process.platform==='win32' && /^(codex|codex\.(?:cmd|bat))$/i.test(this.command)}); }
    catch (e) { throw new Error(`Codex App Serverを起動できません: ${e.message}`); }
    this.child = child;
    child.stdin?.on('error',error => this.#disconnect(error));
    child.on('error', error => this.#disconnect(new Error(`codex起動エラー: ${error.message}`)));
    child.on('exit', (code, signal) => this.#disconnect(new Error(`Codex App Serverが終了しました (${code ?? signal})`)));
    child.stderr?.on('data', chunk => { this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000); });
    createInterface({input:child.stdout}).on('line', line => this.#receive(line));
    const result = await this.request('initialize', {clientInfo:{name:'codex_inventory',title:'Codex Inventory',version:'0.6.0'},capabilities:{experimentalApi:false}}, {skipReady:true});
    this.notify('initialized', {});
    this.emit('ready', result);
    return result;
  }
  #send(payload) {
    if (this.closed || !this.child?.stdin?.writable) throw new Error('Codex App Serverが接続されていません');
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }
  notify(method, params) { this.#send({method,params}); }
  /** Reply exactly once to an App Server initiated approval request. */
  respondToServerRequest(id,result) {
    if (!this.serverRequests.has(id)) throw Object.assign(new Error('承認要求が存在しないか処理済みです'),{status:409});
    this.serverRequests.delete(id);
    this.#send({id,result});
  }
  async request(method, params, {skipReady=false, timeoutMs=this.timeoutMs} = {}) {
    if (!skipReady) await this.start();
    const id = this.nextId++;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} がタイムアウトしました`)); },timeoutMs);
      timer.unref?.();
      this.pending.set(id,{resolve,reject,timer});
      try { this.#send({id,method,params}); }
      catch(e) { clearTimeout(timer);this.pending.delete(id);reject(e); }
    });
  }
  #receive(line) {
    if (!line.trim()) return;
    let packet;
    try {packet=JSON.parse(line);} catch {this.emit('warning','JSON-RPC応答を読み取れません');return;}
    if (packet.id !== undefined && packet.method === undefined) {
      const pending=this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);clearTimeout(pending.timer);
      if (packet.error) { const err=new Error(packet.error.message||'Codex RPC error');err.code=packet.error.code;pending.reject(err); }
      else pending.resolve(packet.result);
    } else if (packet.method && packet.id !== undefined) {
      const methods = new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval']);
      if(methods.has(packet.method) && this.listenerCount('server-request')>0 && this.serverRequests.size<32){
        // Hold this JSON-RPC response until the user decides in Inventory.
        this.serverRequests.set(packet.id,packet.method);
        this.emit('server-request',{id:packet.id,method:packet.method,params:packet.params||{}});
        return;
      }
      // Unsupported permission escalation is fail-closed.
      const decision = packet.method === 'item/permissions/requestApproval' ? {permissions:{},scope:'turn'}
        : methods.has(packet.method) ? {decision:'decline'}
        : packet.method === 'item/tool/requestUserInput' ? {answers:{}}
        : packet.method === 'mcpServer/elicitation/request' ? {action:'decline',content:null}
        : null;
      this.#send(decision ? {id:packet.id,result:decision} : {id:packet.id,error:{code:-32601,message:'This client does not support this request'}});
      this.emit('warning',`サーバーからの確認要求を拒否しました: ${packet.method}`);
    } else if (packet.method) this.emit('notification',{method:packet.method,params:packet.params||{}});
  }
  #disconnect(error) {
    if (this.closed) return;
    this.closed=true;
    for (const p of this.pending.values()) {clearTimeout(p.timer);p.reject(error);}
    this.pending.clear();
    this.serverRequests.clear();
    this.emit('disconnect',error);
    this.child=null;
    this.readyPromise=null;
  }
  close() {
    for(const [id] of this.serverRequests){
      try{this.respondToServerRequest(id,this.serverRequests.get(id)==='item/permissions/requestApproval'
        ? {permissions:{},scope:'turn'} : {decision:'cancel'});}catch{}
    }
    if (this.child){
      // npm/Scoop Codex launchers can be .cmd wrappers. Terminate the entire
      // process tree before Electron exits, rather than only cmd.exe.
      if(process.platform==='win32'&&this.child.pid){
        const killed=spawnSync('taskkill',['/PID',String(this.child.pid),'/T','/F'],{
          windowsHide:true,stdio:'ignore',timeout:3500
        });
        if(killed.status!==0)try{this.child.kill();}catch{}
      }else try{this.child.kill();}catch{}
    }else this.#disconnect(new Error('閉じられました'));
  }
}
