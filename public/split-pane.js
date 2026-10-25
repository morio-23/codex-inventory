// Independent secondary view for concurrent Codex work. No sensitive data is persisted in Git.
import {turnFailureNotice} from './turn-error-ui.js';
export class SplitPane {
  constructor({api,post,notify,getLanguage,getLocale,getCatalog,getPrimaryThreadId,getRunning,getTurnId,setTurnId,
    getMessages,setMessages,appendMessage,renderMarkdown,getApprovals,afterApproval,refreshApprovals,onSharedStatus,
    labelThread,onVisibilityChange}) {
    Object.assign(this,{api,post,notify,getLanguage,getLocale,getCatalog,getPrimaryThreadId,
      getRunning,getTurnId,setTurnId,getMessages,setMessages,appendMessage,renderMarkdown,getApprovals,afterApproval,refreshApprovals,onSharedStatus,
      labelThread,onVisibilityChange});
    this.root=document.getElementById('secondary-pane');
    this.wrap=document.getElementById('quest-panes');
    this.primary=document.getElementById('primary-pane');
    this.separator=document.getElementById('split-separator');
    this.tabs=document.getElementById('split-mobile-tabs');
    this.primaryTab=document.getElementById('split-primary-tab');
    this.secondaryTab=document.getElementById('split-secondary-tab');
    this.layout=document.querySelector('.app-layout');
    this.toggle=document.getElementById('split-toggle');
    this.threadSelect=document.getElementById('secondary-thread');
    this.prompt=document.getElementById('secondary-prompt');
    this.model=document.getElementById('secondary-model');
    this.effort=document.getElementById('secondary-effort');
    this.editing=document.getElementById('secondary-editing');
    this.action=document.getElementById('secondary-action');
    this.actionOptions=Array.from(document.querySelectorAll('#secondary-action-options [data-action]'));
    this.actionHelp=document.getElementById('secondary-action-help');
    this.actionTitle=document.getElementById('secondary-action-title');
    this.output=document.getElementById('secondary-log');
    this.threadId=null;
    this.workspace='';
    this.threads=[];
    this.chatState=new Map();
    this.renderedThreadId=null;
    this.mobilePane='primary';
    this.width=50;
    this.restoredThreadId=null;
    this.enabled=false;
    this.loading=false;
    this.toggle.addEventListener('click',()=>this.setSplit(!this.enabled));
    this.threadSelect.addEventListener('change',()=>void this.selectThread(this.threadSelect.value));
    this.model.addEventListener('change',()=>{this.fillModels(true);this.saveChatState();});
    for(const control of [this.prompt,this.effort,this.editing,this.action])
      control.addEventListener(control===this.prompt?'input':'change',()=>this.saveChatState());
    // The select remains the existing wire/state source of truth. Tiles mirror
    // it so keyboard use, restoration and legacy selectOption calls agree.
    this.action.addEventListener('change',()=>this.syncActionOptions());
    this.actionOptions.forEach((button,index)=>{
      button.addEventListener('click',()=>this.setAction(button.dataset.action));
      button.addEventListener('keydown',event=>{
        const direction=['ArrowRight','ArrowDown'].includes(event.key)?1:
          ['ArrowLeft','ArrowUp'].includes(event.key)?-1:null;
        const next=event.key==='Home'?0:event.key==='End'?this.actionOptions.length-1:
          direction===null?null:(index+direction+this.actionOptions.length)%this.actionOptions.length;
        if(next===null)return;
        event.preventDefault();
        const target=this.actionOptions[next];
        this.setAction(target.dataset.action);
        target.focus();
      });
    });
    document.addEventListener('inventory-language-change',()=>this.syncActionOptions());
    this.output.addEventListener('scroll',()=>{
      if(this.threadId)this.stateFor(this.threadId).scrollTop=this.output.scrollTop;
    });
    this.primaryTab.addEventListener('click',()=>this.showMobilePane('primary'));
    this.secondaryTab.addEventListener('click',()=>this.showMobilePane('secondary'));
    this.tabs.addEventListener('keydown',event=>{
      const focused=event.target===this.primaryTab?'primary':'secondary';
      const destination=event.key==='Home'?'primary':event.key==='End'?'secondary':
        ['ArrowLeft','ArrowRight'].includes(event.key)?(focused==='primary'?'secondary':'primary'):null;
      if(!destination)return;
      event.preventDefault();this.showMobilePane(destination);
      (destination==='primary'?this.primaryTab:this.secondaryTab).focus();
    });
    this.separator.addEventListener('pointerdown',event=>{
      if(!this.enabled||this.mobile.matches)return;
      event.preventDefault();this.separator.setPointerCapture(event.pointerId);
      this.setWidthFromPointer(event.clientX);
    });
    this.separator.addEventListener('pointermove',event=>{
      if(this.separator.hasPointerCapture(event.pointerId))this.setWidthFromPointer(event.clientX);
    });
    this.separator.addEventListener('keydown',event=>{
      const step=event.shiftKey?10:2;
      const next=event.key==='ArrowLeft'?this.width-step:event.key==='ArrowRight'?this.width+step:
        event.key==='Home'?28:event.key==='End'?72:null;
      if(next===null)return;
      event.preventDefault();this.setWidth(next);
    });
    this.mobile=window.matchMedia('(max-width: 767px)');
    this.mobile.addEventListener('change',()=>{this.updateResponsiveView();this.onVisibilityChange?.();});
    document.getElementById('secondary-send').addEventListener('click',()=>void this.send());
    document.getElementById('secondary-stop').addEventListener('click',()=>void this.stop());
    document.getElementById('secondary-reload').addEventListener('click',()=>void this.loadThread());
    document.getElementById('secondary-new').addEventListener('click',()=>void this.createThread());
    this.root.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&this.root.contains(document.activeElement)){
        event.preventDefault();event.stopPropagation();void this.send();
      }
    });
    try{
      this.enabled=localStorage.getItem('codex-inventory:split-enabled')==='on';
      this.restoredThreadId=localStorage.getItem('codex-inventory:split-thread')||null;
      const savedWidth=Number(localStorage.getItem('codex-inventory:split-width'));
      if(Number.isFinite(savedWidth)&&savedWidth>=28&&savedWidth<=72)this.width=savedWidth;
    }catch{}
    this.setWidth(this.width,false);
    this.applyLayout();
    this.fillModels(false);
    this.syncActionOptions();
  }
  setAction(action){
    if(!this.actionOptions.some(button=>button.dataset.action===action))return;
    this.action.value=action;
    this.action.dispatchEvent(new Event('change',{bubbles:true}));
  }
  syncActionOptions(){
    const english=this.getLanguage()==='en';
    const catalog={
      quest:['自由依頼','Freeform','内容を自由に依頼','Write any task'],
      inspect:['調査','Inspect','調査・分析を依頼','Investigate or analyze'],
      build:['実装','Build','編集許可が必要','Requires file editing permission'],
      fix:['修正','Fix','編集許可が必要','Requires file editing permission'],
      test:['テスト','Test','テスト・検証を依頼','Run tests or checks'],
      review:['レビュー','Review','変更点をレビュー','Review changes'],
      map:['構成把握','Map','コード構成を調べる','Explore code structure']
    };
    const selected=catalog[this.action.value]?''+this.action.value:'quest';
    this.actionTitle.textContent=english?'Action':'アクション';
    this.actionHelp.textContent=catalog[selected][english?3:2];
    for(const button of this.actionOptions){
      const entry=catalog[button.dataset.action];
      if(!entry)continue;
      const checked=button.dataset.action===selected;
      button.setAttribute('aria-checked',String(checked));
      button.tabIndex=checked?0:-1;
      button.querySelector('[data-i18n-ignore]').textContent=entry[english?1:0];
      button.title=entry[english?3:2];
    }
  }
  stateFor(id){
    if(!this.chatState.has(id))this.chatState.set(id,{draft:'',model:'',effort:'',editing:false,action:'quest',scrollTop:0});
    return this.chatState.get(id);
  }
  saveChatState(){
    if(!this.threadId)return;
    Object.assign(this.stateFor(this.threadId),{
      draft:this.prompt.value,model:this.model.value,effort:this.effort.value,
      editing:this.editing.checked,action:this.action.value,scrollTop:this.output.scrollTop
    });
  }
  restoreChatState(id){
    const state=id?this.stateFor(id):{draft:'',model:'',effort:'',editing:false,action:'quest'};
    this.prompt.value=state.draft;
    this.model.value=state.model;
    this.fillModels(true);
    this.effort.value=state.effort;
    this.editing.checked=state.editing;
    this.action.value=state.action;
    this.syncActionOptions();
  }
  setWidth(value,persist=true){
    this.width=Math.max(28,Math.min(72,Math.round(value)));
    this.wrap.style.setProperty('--split-primary-width',this.width+'%');
    this.separator.setAttribute('aria-valuenow',String(this.width));
    if(persist)try{localStorage.setItem('codex-inventory:split-width',String(this.width));}catch{}
  }
  setWidthFromPointer(x){
    const bounds=this.wrap.getBoundingClientRect();
    if(bounds.width)this.setWidth((x-bounds.left)/bounds.width*100);
  }
  showMobilePane(pane){
    this.mobilePane=pane;
    this.updateResponsiveView();
    this.onVisibilityChange?.();
  }
  visibleThreadIds(){
    const primary=this.getPrimaryThreadId();
    if(!this.enabled)return primary?[primary]:[];
    const ids=this.mobile.matches?
      [this.mobilePane==='primary'?primary:this.threadId]:[primary,this.threadId];
    return [...new Set(ids.filter(Boolean))];
  }
  updateResponsiveView(){
    const active=this.enabled&&this.mobile.matches?this.mobilePane:'both';
    this.wrap.dataset.activePane=active;
    this.primaryTab.setAttribute('aria-selected',String(active==='primary'));
    this.secondaryTab.setAttribute('aria-selected',String(active==='secondary'));
    this.primaryTab.tabIndex=active==='primary'?0:-1;
    this.secondaryTab.tabIndex=active==='secondary'?0:-1;
    this.tabs.hidden=!this.enabled;
    this.separator.hidden=!this.enabled;
  }
  applyLayout(){
    this.root.hidden=!this.enabled;
    this.wrap.classList.toggle('is-split',this.enabled);
    this.layout.classList.toggle('split-view',this.enabled);
    this.toggle.setAttribute('aria-pressed',String(this.enabled));
    this.toggle.textContent=this.enabled?'▣ 1画面':'◫ 2画面';
    this.updateResponsiveView();
    if(this.enabled)void this.refreshThreads();
  }
  setSplit(on){
    this.enabled=!!on;
    try{localStorage.setItem('codex-inventory:split-enabled',this.enabled?'on':'off');}catch{}
    this.applyLayout();
    this.onSharedStatus();
    this.onVisibilityChange?.();
    if(this.enabled)void this.refreshApprovals();
  }
  shortLabel(thread,index){
    return this.labelThread?.(thread)||(this.getLanguage()==='en'?'Chat ':'チャット ')+(index+1);
  }
  async refreshThreads(){
    if(!this.enabled||this.loading)return;
    this.loading=true;
    try{
      const data=await this.api('/api/threads?all=1');
      this.threads=Array.isArray(data.threads)?data.threads.filter(x=>x&&typeof x.id==='string'&&typeof x.cwd==='string'):[];
      const prior=this.threadId||this.restoredThreadId;
      this.threadSelect.replaceChildren();
      const empty=document.createElement('option');empty.value='';empty.textContent=this.getLanguage()==='en'?'Select another chat':'別のチャットを選択';this.threadSelect.append(empty);
      this.threads.forEach((thread,i)=>{
        const opt=document.createElement('option');opt.value=thread.id;opt.dataset.i18nIgnore='';opt.textContent=this.shortLabel(thread,i);
        this.threadSelect.append(opt);
      });
      const found=this.threads.find(x=>x.id===prior);
      this.threadSelect.value=found?.id||'';
      if(found&&this.threadId!==found.id)await this.selectThread(found.id);
      else if(found)this.workspace=found.cwd;
      else{
        this.threadId=null;this.workspace='';this.prompt.value='';this.output.replaceChildren();
        try{localStorage.removeItem('codex-inventory:split-thread');}catch{}
        this.updateButtons();
      }
      this.restoredThreadId=null;
    }catch{this.notify('分割画面のチャット一覧を取得できませんでした',true);}
    finally{this.loading=false;}
  }
  async selectThread(id){
    this.saveChatState();
    const thread=this.threads.find(x=>x.id===id);
    this.threadId=thread?.id||null;
    this.workspace=thread?.cwd||'';
    this.threadSelect.value=this.threadId||'';
    this.restoreChatState(this.threadId);
    try{
      if(this.threadId)localStorage.setItem('codex-inventory:split-thread',this.threadId);
      else localStorage.removeItem('codex-inventory:split-thread');
    }catch{}
    this.updateButtons();this.renderLog();this.renderApprovals();
    if(this.mobile.matches&&this.threadId)this.showMobilePane('secondary');
    else this.onVisibilityChange?.();
    if(this.enabled)void this.refreshApprovals();
    if(thread)await this.loadThread();
  }
  async loadThread(){
    const id=this.threadId;if(!id)return;
    const before=new Map((this.getMessages(id)||[]).map(message=>
      [message,{text:message.text,pending:message.pending}]));
    try{
      const data=await this.api('/api/threads/'+encodeURIComponent(id));
      if(id!==this.threadId)return;
      const history=(data.messages||[]).map(x=>({role:x.role,text:x.text,itemId:x.itemId||null}));
      const current=(this.getMessages(id)||[]).filter(message=>{
        const previous=before.get(message);
        return message.pending||(message.itemId&&(!previous||previous.text!==message.text||previous.pending!==message.pending));
      });
      const byItem=new Map(history.map((message,index)=>[message.itemId,index]).filter(([itemId])=>itemId));
      for(const message of current){
        if(message.itemId&&byItem.has(message.itemId))history[byItem.get(message.itemId)]=message;
        else history.push(message);
      }
      this.setMessages(id,history);
      this.renderLog();
    }catch{this.notify('分割チャットの履歴を取得できませんでした',true);}
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
    const sameThread=this.renderedThreadId===this.threadId;
    const scrollBottom=sameThread&&root.scrollHeight-root.scrollTop-root.clientHeight<35;
    const oldTop=sameThread?root.scrollTop:(this.threadId?this.stateFor(this.threadId).scrollTop:0);
    root.replaceChildren();
    this.renderedThreadId=this.threadId;
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
      const started=await this.api('/api/threads/'+encodeURIComponent(id)+'/turn',this.post({
        prompt,action,editing,model:this.model.value||null,effort:this.effort.value||null
      }),scoped);
      this.setTurnId(id,started.turnId);
      this.stateFor(id).draft='';
      if(this.threadId===id&&this.prompt.value.trim()===prompt){this.prompt.value='';this.saveChatState();}
      this.notify('分割チャットで実行を開始しました');
    }catch(error){
      running.delete(id);
      this.setMessages(id,(this.getMessages(id)||[]).filter(m=>m!==optimistic));
      this.renderLog();
      this.notify(turnFailureNotice(error,this.getLanguage()).text,true);
    }finally{this.updateButtons();this.onSharedStatus();}
  }
  async stop(){
    const id=this.threadId,cwd=this.workspace;
    if(!id||!cwd||!this.getRunning().has(id)||id===this.getPrimaryThreadId())return;
    const turnId=this.getTurnId(id);
    if(!turnId){this.notify('停止対象のターンを確認できません。状態を更新して再試行してください',true);return;}
    try{
      await this.api('/api/threads/'+encodeURIComponent(id)+'/interrupt',this.post({turnId}),{workspace:cwd,explicit:true});
      this.notify('対象チャットに中断を要求しました');
    }catch{this.notify('分割チャットを中断できませんでした',true);}
  }
  async createThread(){
    const cwd=this.workspace;
    if(!cwd)return;
    try{
      const response=await this.api('/api/threads',this.post({
        editing:this.editing.checked,model:this.model.value||null,effort:this.effort.value||null
      }),{workspace:cwd,explicit:true});
      await this.refreshThreads();
      if(response.thread&&!this.threads.some(x=>x.id===response.thread.id)){
        this.threads.unshift(response.thread);
        const option=document.createElement('option');option.value=response.thread.id;
        option.dataset.i18nIgnore='';option.textContent=this.shortLabel(response.thread,0);
        this.threadSelect.append(option);
      }
      await this.selectThread(response.thread.id);
      this.threadSelect.value=this.threadId;
    }catch{this.notify('新しい分割チャットを作成できませんでした',true);}
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
              this.post({decision,threadId:request.threadId,turnId:request.turnId}),
              {workspace:this.workspace,explicit:true});
            this.afterApproval(request.approvalId);
          }catch{this.notify('分割チャットの承認に応答できませんでした',true);
            for(const b of actions.querySelectorAll('button'))b.disabled=false;}
        });
        actions.append(button);
      }
      item.append(title,details,actions);list.append(item);
    }
  }
}
