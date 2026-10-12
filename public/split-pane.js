// Independent secondary view for concurrent Codex work. No sensitive data is persisted in Git.
export class SplitPane {
  constructor({api,post,notify,getLanguage,getLocale,getCatalog,getPrimaryThreadId,getRunning,
    getMessages,setMessages,appendMessage,renderMarkdown,getApprovals,afterApproval,onSharedStatus}) {
    Object.assign(this,{api,post,notify,getLanguage,getLocale,getCatalog,getPrimaryThreadId,
      getRunning,getMessages,setMessages,appendMessage,renderMarkdown,getApprovals,afterApproval,onSharedStatus});
    this.root=document.getElementById('secondary-pane');
    this.wrap=document.getElementById('quest-panes');
    this.layout=document.querySelector('.app-layout');
    this.toggle=document.getElementById('split-toggle');
    this.threadSelect=document.getElementById('secondary-thread');
    this.prompt=document.getElementById('secondary-prompt');
    this.model=document.getElementById('secondary-model');
    this.effort=document.getElementById('secondary-effort');
    this.editing=document.getElementById('secondary-editing');
    this.action=document.getElementById('secondary-action');
    this.output=document.getElementById('secondary-log');
    this.threadId=null;
    this.workspace='';
    this.threads=[];
    this.drafts=new Map();
    this.enabled=false;
    this.loading=false;
    this.toggle.addEventListener('click',()=>this.setSplit(!this.enabled));
    this.threadSelect.addEventListener('change',()=>void this.selectThread(this.threadSelect.value));
    this.model.addEventListener('change',()=>this.fillModels(true));
    this.prompt.addEventListener('input',()=>{if(this.threadId)this.drafts.set(this.threadId,this.prompt.value);});
    document.getElementById('secondary-send').addEventListener('click',()=>void this.send());
    document.getElementById('secondary-stop').addEventListener('click',()=>void this.stop());
    document.getElementById('secondary-reload').addEventListener('click',()=>void this.loadThread());
    document.getElementById('secondary-new').addEventListener('click',()=>void this.createThread());
    this.root.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&this.root.contains(document.activeElement)){
        event.preventDefault();event.stopPropagation();void this.send();
      }
    });
    try{this.enabled=localStorage.getItem('codex-inventory:split-enabled')==='on';}catch{}
    this.applyLayout();
    this.fillModels(false);
  }
  applyLayout(){
    this.root.hidden=!this.enabled;
    this.wrap.classList.toggle('is-split',this.enabled);
    this.layout.classList.toggle('split-view',this.enabled);
    this.toggle.setAttribute('aria-pressed',String(this.enabled));
    this.toggle.textContent=this.enabled?'▣ 1画面':'◫ 2画面';
    if(this.enabled)void this.refreshThreads();
  }
  setSplit(on){
    this.enabled=!!on;
    try{localStorage.setItem('codex-inventory:split-enabled',this.enabled?'on':'off');}catch{}
    this.applyLayout();
    this.onSharedStatus();
  }
  shortLabel(thread,index){
    // Thread.preview is commonly a real prompt; show only a synthetic ordinal in this selector.
    const project=this.workspaceLabel(thread.cwd);
    return project+' / '+(this.getLanguage()==='en'?'Chat ':'チャット ')+(index+1);
  }
  workspaceLabel(cwd){
    const value=String(cwd||'').replace(/[/\\]+$/,'').split(/[/\\]/).pop()||'Workspace';
    // Never expose full local paths in selector or native notifications.
    return /^[a-zA-Z0-9_-]{1,24}$/.test(value)?value:(this.getLanguage()==='en'?'Project':'プロジェクト');
  }
  async refreshThreads(){
    if(!this.enabled||this.loading)return;
    this.loading=true;
    try{
      const data=await this.api('/api/threads?all=1');
      this.threads=Array.isArray(data.threads)?data.threads.filter(x=>x&&typeof x.id==='string'&&typeof x.cwd==='string'):[];
      const prior=this.threadId;
      this.threadSelect.replaceChildren();
      const empty=document.createElement('option');empty.value='';empty.textContent=this.getLanguage()==='en'?'Select another chat':'別のチャットを選択';this.threadSelect.append(empty);
      this.threads.forEach((thread,i)=>{
        const opt=document.createElement('option');opt.value=thread.id;opt.textContent=this.shortLabel(thread,i);
        this.threadSelect.append(opt);
      });
      this.threadSelect.value=this.threads.some(x=>x.id===prior)?prior:'';
      if(!this.threadSelect.value){
        this.threadId=null;this.workspace='';this.prompt.value='';this.output.replaceChildren();
        this.updateButtons();
      }
    }catch(error){this.notify('分割画面のチャット一覧取得に失敗: '+error.message,true);}
    finally{this.loading=false;}
  }
  async selectThread(id){
    if(this.threadId)this.drafts.set(this.threadId,this.prompt.value);
    const thread=this.threads.find(x=>x.id===id);
    this.threadId=thread?.id||null;
    this.workspace=thread?.cwd||'';
    this.prompt.value=this.drafts.get(this.threadId)||'';
    this.updateButtons();this.renderLog();this.renderApprovals();
    if(thread)await this.loadThread();
  }
  async loadThread(){
    const id=this.threadId;if(!id)return;
    try{
      const data=await this.api('/api/threads/'+encodeURIComponent(id));
      if(id!==this.threadId)return;
      const history=(data.messages||[]).map(x=>({role:x.role,text:x.text,itemId:x.itemId||null}));
      const pending=(this.getMessages(id)||[]).filter(x=>x.pending);
      this.setMessages(id,[...history,...pending]);
      this.renderLog();
    }catch(error){this.notify('分割チャットの履歴取得に失敗: '+error.message,true);}
  }
  fillModels(preserve=true){
    const catalog=this.getCatalog();
    const oldModel=preserve?this.model.value:'';
    const oldEffort=preserve?this.effort.value:'';
    this.model.replaceChildren();
    const inherit=document.createElement('option');inherit.value='';inherit.textContent=this.getLanguage()==='en'?'Inherit Codex settings':'Codex設定を継承';this.model.append(inherit);
    for(const item of catalog.models||[]){
      const option=document.createElement('option');option.value=item.id;option.textContent=item.label||item.id;this.model.append(option);
    }
    this.model.value=(catalog.models||[]).some(x=>x.id===oldModel)?oldModel:'';
    const selected=(catalog.models||[]).find(x=>x.id===(this.model.value||catalog.defaultModel));
    this.effort.replaceChildren();
    const fallback=document.createElement('option');fallback.value='';fallback.textContent=this.getLanguage()==='en'?'Default':'既定';this.effort.append(fallback);
    for(const effort of selected?.efforts||[]){
      const option=document.createElement('option');option.value=effort.id;option.textContent=effort.id;this.effort.append(option);
    }
    this.effort.value=(selected?.efforts||[]).some(x=>x.id===oldEffort)?oldEffort:'';
    this.model.disabled=!(catalog.models||[]).length;
    this.effort.disabled=!(selected?.efforts||[]).length;
  }
  updateButtons(){
    const has=!!this.threadId;
    const running=has&&this.getRunning().has(this.threadId);
    const duplicate=has&&this.threadId===this.getPrimaryThreadId();
    const status=document.getElementById('secondary-status');
    status.textContent=!has?'未選択':duplicate?'左ペインと同じチャット':running?'実行中':'待機中';
    status.dataset.state=running?'running':'idle';
    document.getElementById('secondary-send').disabled=!has||running||duplicate;
    document.getElementById('secondary-stop').disabled=!has||!running||duplicate;
    document.getElementById('secondary-new').disabled=!this.workspace;
    this.threadSelect.disabled=!this.enabled;
  }
  renderLog(){
    const root=this.output;
    const scrollBottom=root.scrollHeight-root.scrollTop-root.clientHeight<35;
    const oldTop=root.scrollTop;
    root.replaceChildren();
    if(!this.threadId)return;
    const fragment=document.createDocumentFragment();
    for(const message of this.getMessages(this.threadId)||[]){
      const entry=document.createElement('div');entry.className='log-entry '+(message.role==='assistant'?'answer':message.role==='user'?'user-message':'command');
      const label=document.createElement('span');label.className='stamp';
      label.textContent=message.role==='assistant'?'Codex':message.role==='user'?'You':message.role==='command'?'Command':'Files';
      entry.append(label);
      const body=document.createElement('div');body.className='log-content';
      if(message.role==='assistant')body.append(this.renderMarkdown(String(message.text||'')));
      else body.textContent=String(message.text||'');
      entry.append(body);fragment.append(entry);
    }
    root.append(fragment);
    root.scrollTop=scrollBottom?root.scrollHeight:oldTop;
  }
  async send(){
    const id=this.threadId,cwd=this.workspace,prompt=this.prompt.value.trim();
    if(!id||!cwd||this.getRunning().has(id)||id===this.getPrimaryThreadId())return;
    if(!prompt){this.prompt.focus();return;}
    if(prompt.length>10000){this.notify('依頼は10,000文字以内にしてください',true);return;}
    const action=this.action.value,editing=this.editing.checked;
    if(['fix','build'].includes(action)&&!editing){this.notify('実装・修正には編集許可が必要です',true);return;}
    const running=this.getRunning();running.add(id);this.updateButtons();this.onSharedStatus();
    const optimistic=this.appendMessage(id,'user',prompt);
    const scoped={workspace:cwd,explicit:true};
    try{
      await this.api('/api/threads/'+encodeURIComponent(id)+'/turn',this.post({
        prompt,action,editing,model:this.model.value||null,effort:this.effort.value||null
      }),scoped);
      this.drafts.set(id,'');
      if(this.threadId===id&&this.prompt.value.trim()===prompt)this.prompt.value='';
      this.notify('分割チャットで実行を開始しました');
    }catch(error){
      running.delete(id);
      this.setMessages(id,(this.getMessages(id)||[]).filter(m=>m!==optimistic));
      this.renderLog();
      this.notify('分割チャットの実行失敗: '+error.message,true);
    }finally{this.updateButtons();this.onSharedStatus();}
  }
  async stop(){
    const id=this.threadId,cwd=this.workspace;
    if(!id||!cwd||!this.getRunning().has(id)||id===this.getPrimaryThreadId())return;
    try{
      await this.api('/api/threads/'+encodeURIComponent(id)+'/interrupt',this.post({}),{workspace:cwd,explicit:true});
      this.notify('対象チャットに中断を要求しました');
    }catch(error){this.notify('中断失敗: '+error.message,true);}
  }
  async createThread(){
    const cwd=this.workspace;
    if(!cwd)return;
    try{
      const response=await this.api('/api/threads',this.post({
        editing:this.editing.checked,model:this.model.value||null,effort:this.effort.value||null
      }),{workspace:cwd,explicit:true});
      await this.refreshThreads();
      if(response.thread&&!this.threads.some(x=>x.id===response.thread.id))this.threads.unshift(response.thread);
      await this.selectThread(response.thread.id);
      this.threadSelect.value=this.threadId;
    }catch(error){this.notify('新しいチャットの作成に失敗: '+error.message,true);}
  }
  renderApprovals(){
    const list=document.getElementById('secondary-approvals');list.replaceChildren();
    const approvals=(this.getApprovals()||[]).filter(x=>this.threadId===x.threadId&&this.workspace===x.workspace);
    list.hidden=approvals.length===0;
    for(const request of approvals){
      const item=document.createElement('article');item.className='split-approval';
      const title=document.createElement('strong');title.textContent='⚠ '+(this.getLanguage()==='en'?'Approval required':'Codexの承認待ち');
      const details=document.createElement('details');
      const summary=document.createElement('summary');summary.textContent=this.getLanguage()==='en'?'Review command / permissions':'コマンド・権限の詳細を確認';
      const pre=document.createElement('pre');
      pre.textContent=request.kind==='permissions'?JSON.stringify(request.permissions||{},null,2):request.command||request.grantRoot||'No details provided';
      details.append(summary,pre);
      const actions=document.createElement('div');actions.className='codex-approval-actions';
      for(const [label,decision] of [['今回のみ許可','accept'],['拒否','decline']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.addEventListener('click',async()=>{
          if(!details.open){details.open=true;return;}
          for(const b of actions.querySelectorAll('button'))b.disabled=true;
          try{
            await this.api('/api/approvals/'+encodeURIComponent(request.approvalId)+'/respond',
              this.post({decision}),{workspace:this.workspace,explicit:true});
            this.afterApproval(request.approvalId);
          }catch(error){this.notify('承認応答に失敗: '+error.message,true);
            for(const b of actions.querySelectorAll('button'))b.disabled=false;}
        });
        actions.append(button);
      }
      item.append(title,details,actions);list.append(item);
    }
  }
}
