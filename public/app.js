import { renderMarkdown } from './markdown.js';
import { SplitPane } from './split-pane.js';
import { ActivityTimeline, activityFromCodex } from './activity-feed-state.js';
import { DisplayLabels } from './display-labels.js';
import { conflictCandidates } from './conflict-warning-state.js';
import {categories,initialState,loadState,saveState,mergedTemplates,variablesOf,validateTemplate,parseTemplateImport,exportTemplateJson} from './inventory-state.js';
import {setupLanguage,getLanguage,getLocale,t,translateDom} from './i18n.js';
import englishTemplates from './templates.en.js';
const sprites = {
  quest:`<path fill="#5a3e20" d="M2 7h20v11H2z"/><path fill="#f3bc46" d="M3 8h18v9H3z"/><path fill="#ffe37b" d="M5 9h14v6H5z"/><path fill="#ce8731" d="M11 8h2v2h-2zm0 4h2v2h-2zm0 4h2v1h-2z"/><path fill="#fff3b7" d="M6 10h4v2H6z"/>`,
  inspect:`<path fill="#3a4650" d="M6 2h9v2H6zM4 4h2v11H4zM15 4h2v11h-2zM6 15h9v2H6zM15 14h4v3h-2v2h-3v3h-3v-4h3v-2h1z"/><path fill="#a6d5f5" d="M6 4h9v11H6z"/><path fill="#d6f1ff" d="M7 5h3v3H7z"/><path fill="#557ea1" d="M13 6h2v7h-2z"/>`,
  build:`<path fill="#334552" d="M3 6h5V3h9v3h3v3h-7v3h-2V9H8v3H6V9H3z"/><path fill="#75d9eb" d="M4 6h5V4h7v2h3v2h-7v3h-3V8H4z"/><path fill="#263f59" d="M11 10h3v4h-3zM13 13h3v3h-3zM15 16h3v3h-3zM17 19h3v3h-3z"/><path fill="#805d3c" d="M11 11h2v3h-2zM13 14h2v3h-2zM15 17h2v3h-2zM17 20h2v2h-2z"/>`,
  fix:`<path fill="#404b50" d="M14 2h4v4h3v5l-4 3-2-2-7 9-5-4 8-8-2-2 2-4h3v5h4V4h-4z"/><path fill="#b8ccd1" d="M12 2h3v6h4V3h2v8l-4 2-2-2-8 9-3-3 9-9z"/><path fill="#f4f1e5" d="M5 17h2v2H5z"/>`,
  test:`<path fill="#3c484f" d="M9 2h8v2h-2v6l5 7v4H5v-4l6-7V4H9z"/><path fill="#d5e6e1" d="M11 4h4v7l4 6v2H7v-2l4-6z"/><path fill="#8c6be6" d="M9 13h8l2 4v2H7v-2z"/><path fill="#b7a5ff" d="M11 13h3v3h-3zM8 17h2v2H8z"/>`,
  review:`<path fill="#434852" d="M12 2 21 6v6c0 6-5 9-9 11-4-2-9-5-9-11V6z"/><path fill="#b0a49b" d="M12 4 19 7v6c0 4-3 6-7 8-4-2-7-4-7-8V7z"/><path fill="#d4e4e1" d="M12 5 18 8v5c0 3-3 5-6 7z"/><path fill="#79bc9c" d="M9 12h2v3H9zM11 14h3v2h-3zM14 10h3v3h-3z"/>`,
  map:`<path fill="#70583d" d="M3 4h7l4 2 7-2v16h-7l-4-2-7 2z"/><path fill="#d8cca0" d="M4 5h6v13H4z"/><path fill="#e9ddba" d="M11 7h3v11h-3z"/><path fill="#cdc093" d="M15 7h5v12h-5z"/><path fill="#70a28c" d="M5 9h3v4H5zM17 11h2v4h-2z"/><path fill="#b55f4a" d="M12 10h2v2h-2zM10 12h2v2h-2z"/>`,
  diff:`<path fill="#5b513c" d="M5 2h15v20H5z"/><path fill="#f1e4ae" d="M6 3h13v18H6z"/><path fill="#677f59" d="M8 6h9v2H8zM8 10h6v2H8zM8 14h9v2H8z"/><path fill="#c6745f" d="M15 10h3v2h-3zM8 18h4v2H8z"/>`,
  'reset-credit':`<path fill="#8d6529" d="M3 4h18v16H3z"/><path fill="#f2b63d" d="M4 5h16v14H4z"/><path fill="#fff0ae" d="M6 7h12v10H6z"/><path fill="#356f74" d="M11 8h2v2h2v2h-2v3h-2v-3H9v-2h2z"/><path fill="#be812e" d="M4 10h2v4H4zM18 10h2v4h-2z"/>`,
  reset:`<path fill="#5a3920" d="M2 6h20v12H2z"/><path fill="#ffca41" d="M3 7h18v10H3z"/><path fill="#ffe27a" d="M5 9h14v6H5z"/><path fill="#e39b34" d="M10 7h2v3h-2zm0 5h2v3h-2z"/><path fill="#242635" d="M16 1h7v2h1v6h-2v2h-6v-2h-2V4h2z"/><path fill="#f6f5ed" d="M16 3h6v6h-6z"/><path fill="#333541" d="M18 4h1v3h-1zm1 2h2v1h-2z"/>`
};
function sprite(id){return `<svg viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${sprites[id]}</svg>`;}
const items = [
  {id:'quest',name:'Codexの依頼書',short:'依頼',rarity:'ノーマルアイテム',description:'好きな指示をCodexに送れます。続けて依頼すると同じセッションで会話できます。',tip:'自由に冒険を始めましょう。',prompt:'このプロジェクトについて教えて'},
  {id:'inspect',name:'コード探索のレンズ',short:'調査',rarity:'レアアイテム',description:'リポジトリを読み解き、関連ファイルや改善箇所を見つけます。',tip:'調査したい場所を入力してください。',prompt:'このリポジトリの主要な問題点を調査して'},
  {id:'build',name:'実装のツルハシ',short:'実装',rarity:'レアアイテム',description:'依頼内容に沿って新機能を実装します。ファイル編集許可が必要です。',tip:'編集許可をONにしてから任務開始。',prompt:'追加したい機能を詳しく入力してください'},
  {id:'fix',name:'修理職人のレンチ',short:'修正',rarity:'レアアイテム',description:'不具合の原因を調べ、修正と検証を行います。ファイル編集許可が必要です。',tip:'再現手順やエラーを入力してください。',prompt:'修正したい不具合と再現方法を入力してください'},
  {id:'test',name:'テストのポーション',short:'検証',rarity:'ノーマルアイテム',description:'既存のテストを探して実行し、問題があればレポートします。',tip:'読み取り専用では、一部のテストが実行できない場合があります。',prompt:'可能なテストを実行し、失敗したテストを報告して'},
  {id:'review',name:'レビューの盾',short:'レビュー',rarity:'エピックアイテム',description:'ローカルの変更点をチェックし、不具合・セキュリティ・品質の懸念を探します。',tip:'レビュー中は編集しないでください。',prompt:'現在のローカル変更差分をレビューして'},
  {id:'map',name:'コードベースの地図',short:'地図',rarity:'ノーマルアイテム',description:'プロジェクトの主要構造・技術スタック・起動手順を地図のように整理します。',tip:'新しいリポジトリの探索におすすめ。',prompt:'このプロジェクトの全体構成と主要な実行方法を整理して'},
  {id:'diff',name:'差分確認の巻物',short:'差分',rarity:'ノーマルアイテム',description:'Codexを起動せず、Gitの変更状況と変更量を確認します。',tip:'Gitリポジトリが必要です。'},
  {id:'reset',name:'新しいチャットの札',short:'新規',rarity:'ノーマルアイテム',description:'Codexの新しいチャットを作ります。利用枠や保存済みリセットチケットには影響しません。',tip:'新規チャット作成専用です。'},
  {id:'reset-credit',name:'Codexのリセットチケット',short:'回復',rarity:'貴重アイテム',description:'保有している利用枠リセットチケットを確認し、選択・最終承認すると1枚使えます。',tip:'使う操作は取り消せません。チケットの確認だけでは消費されません。'}
];
const $ = id => document.getElementById(id);
const threadList = $('thread-list');
const tooltip = $('tooltip');
const logs = new Map();
const displayLabels=new DisplayLabels();
const activityTimeline=new ActivityTimeline();
let activityExpanded=false;
let activityHover=false;
let activityRefreshTimer=null;
let splitPane=null;
let workspaceConflicts=[];
let runtimeRevision=0;
// Keep intentionally expanded commands open when streaming redraws the log.
const expandedCommands = new Set();
const completedTurnKeys=new Set();
const pendingCodexApprovals=new Map();
let approvalRevision=0;
const completionPreferenceKey='codex-inventory:completion-notifications';
let completionThreadId=null;
const draftPrompts = new Map();
const runningThreads = new Set();
const runningTurnIds = new Map();
const activeThreadStorageKey = () => 'codex-inventory-active-thread:'+workspacePath;
let threads = [];
let activeThreadId = null;
let selected = items[0];
let eventStream;
let listRefresh;
let usageRefresh;
let statusRefresh;
let connected=false;
let workspacePath='';
let modelCatalog={models:[],defaultModel:null};
let modelsAvailable=false;
let detectedProjects=[];
let autoDiscoverProjects=false;
let projectSwitching=false;
let projectInitialized=false;
const preferredProjectKey='codex-inventory:preferred-project';
let activeThreadCwd=null;
let localItems=[];
let builtinTemplates=[];
let originalBuiltinTemplates=[];
function localizedBuiltins(){
  if(getLanguage()!=='en')return originalBuiltinTemplates.map(item=>({...item}));
  return originalBuiltinTemplates.map(item=>item.source==='builtin'&&englishTemplates[item.id]
    ? {...item,...Object.fromEntries(['title','description','body'].map(key=>[key,englishTemplates[item.id][key]]))}
    : {...item});
}
let catalogCategory='Codex';
let catalogPage=0;
let inventoryState=initialState();
let hotbarIndex=0;
let visibleCatalog=[];
let currentResult=null;
const attachedResults=new Map();
const runningLocalItems=new Set();
const codexItems=items.map(item=>({...item,category:'Codex',
  executionKind:item.id==='reset-credit'?'ticket':['diff','reset'].includes(item.id)?'interface':'codex',
  costLabel:item.id==='reset-credit'?'表示では消費なし。最終承認時のみ保存済みチケットを1枚使用します。':['diff','reset'].includes(item.id)?'この操作ではCodexターンを開始しません':'送信するとCodex利用枠を消費する可能性があります'}));
function allTemplates(){return mergedTemplates(builtinTemplates,inventoryState);}
function catalog(){return [...localItems,...codexItems,...allTemplates().map(item=>({...item,templateCategory:item.category,category:'テンプレート',name:item.title,short:'書',icon:'📚',tip:item.description,costLabel:'選択・編集ではCodex利用枠の消費なし。送信時は消費する可能性があります'}))];}
function findItem(id){return catalog().find(item=>item.id===id);}
const itemText=(item,value)=>item.source==='user'?value:t(value);
function persistInventory(){try{saveState(localStorage,workspacePath,inventoryState);}catch(error){notify('ブラウザ保存に失敗しました',true);}}
function sameWorkspaceUi(a,b) {
  if(!a||!b)return false;
  const isWin=/^[A-Za-z]:[\\/]/;
  if(isWin.test(a)||isWin.test(b))return isWin.test(a)&&isWin.test(b)&&a.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()===b.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
  return a.replace(/\/+$/,'')===b.replace(/\/+$/,'');
}
function isForeignThread() {
  if(!activeThreadId||!workspacePath)return false;
  const cwd=threads.find(t=>t.id===activeThreadId)?.cwd||activeThreadCwd;
  return !sameWorkspaceUi(cwd,workspacePath);
}

let needsThreadRefresh=false;
let needsUsageRefresh=false;
let resetTicketState=null;
let stagedResetCredit=null;
let consumingResetCredit=false;
const ticketCountLabel=()=>Number.isSafeInteger(resetTicketState?.availableCount)?(getLanguage()==='en'?resetTicketState.availableCount+' tickets':resetTicketState.availableCount+'枚'):t('未取得');
const dateText=value=>typeof value==='number'?new Date(value*1000).toLocaleString(getLocale()):t('不明');
const resetCreditRows=()=>Array.isArray(resetTicketState?.credits)?resetTicketState.credits.filter(c=>
  c.status==='available'&&c.resetType==='codexRateLimits'&&(c.expiresAt===null||c.expiresAt*1000>Date.now())
).sort((a,b)=>(a.expiresAt??Number.MAX_SAFE_INTEGER)-(b.expiresAt??Number.MAX_SAFE_INTEGER)):[];
function ticketInfoText(){
  if(resetTicketState?.availableCount===null||!resetTicketState)return t('残枚数を取得できません。');
  if(resetTicketState.availableCount===0)return t('利用できるチケットはありません。');
  const rows=resetCreditRows();
  if(getLanguage()==='en')return 'Available: '+ticketCountLabel()+'. '+(rows.length?(rows[0].expiresAt?'Earliest expiration: '+dateText(rows[0].expiresAt):'Some tickets have no expiration.'):'Individual expiration dates unavailable.');
  return '利用可能 '+ticketCountLabel()+'。'+(rows.length?(rows[0].expiresAt?'最も早い有効期限: '+dateText(rows[0].expiresAt):'期限なしのチケットがあります。'):'個別の有効期限は未取得。');
}
function ticketItemDescription(){
  if(getLanguage()==='en')return 'A saved quota reset ticket. '+ticketInfoText()+' Select and confirm before redemption.';
  return '利用枠を回復する保存済みチケットです。'+ticketInfoText()+' 実際に使う場合は選択と最終確認が必要です。';
}
function paintResetCreditBadges(){
  for(const button of document.querySelectorAll('[data-item="reset-credit"]')){
    let badge=button.querySelector('.reset-ticket-count');
    if(!badge){badge=document.createElement('span');badge.className='reset-ticket-count';button.append(badge);}
    badge.textContent=ticketCountLabel();
    button.title=(getLanguage()==='en'?'Reset tickets: ':'リセットチケット: ')+ticketInfoText();
  }
}
function paintResetTicketState(data){
  resetTicketState=data?.resetCreditTickets||null;
  $('ticket-count').textContent=(getLanguage()==='en'?'Remaining: ':'残り ')+ticketCountLabel();
  $('ticket-expiry').textContent=ticketInfoText();
  $('ticket-open').disabled=!Number.isSafeInteger(resetTicketState?.availableCount)||resetTicketState.availableCount===0;
  paintResetCreditBadges();
  if(selected.id==='reset-credit'){
    $('item-description').textContent=ticketItemDescription();
    $('item-tip').textContent=getLanguage()==='en'?'Owned: '+ticketCountLabel()+' · Check each ticket expiration':'所持: '+ticketCountLabel()+' · 有効期限はチケットごとに確認';
  }
}

const stamp = () => new Date().toLocaleTimeString(getLocale(),{hour12:false});
const safe = value => String(value ?? '');

async function api(path, options={}, context=null) {
  const requestedWorkspace=context?.workspace??workspacePath;
  const response=await fetch(path,{...options,headers:{
    // Fetch request headers are restricted to ByteString (Latin-1). Encode
    // Unicode paths as ASCII and decode only on the server before matching.
    ...options.headers,...(requestedWorkspace?{'X-Codex-Workspace':encodeURIComponent(requestedWorkspace)}:{}),
    ...(context?.explicit?{'X-Codex-Workspace-Mode':'explicit'}:{})
  }});
  let result;
  try {result=await response.json();}catch{throw Error('サーバー応答が読み取れません');}
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
}
const post = body => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

const effortLabels={
  none:'なし',minimal:'最小',low:'Low',medium:'Medium',high:'High',
  xhigh:'Extra High',max:'Max',ultra:'Ultra'
};
const modelChoiceKey=()=> 'codex-inventory:model-effort:'+workspacePath;
function savedModelChoice(){
  if(!workspacePath)return {model:'',effort:''};
  try{
    const value=JSON.parse(localStorage.getItem(modelChoiceKey())||'{}');
    return {model:typeof value.model==='string'?value.model:'',
      effort:typeof value.effort==='string'?value.effort:''};
  }catch{return {model:'',effort:''};}
}
function persistModelChoice(){
  if(!workspacePath)return;
  try{localStorage.setItem(modelChoiceKey(),JSON.stringify({
    model:$('model-select').value,effort:$('reasoning-select').value
  }));}catch(error){notify('モデル設定の保存に失敗しました',true);}
}
function turnModelChoice(){
  return {model:$('model-select').value||null,effort:$('reasoning-select').value||null};
}
function fillModelChoices({restore=false}={}){
  const modelSelect=$('model-select'),effortSelect=$('reasoning-select');
  const previous=restore?savedModelChoice():{
    model:modelSelect.value,effort:effortSelect.value
  };
  const fallbackModel=document.createElement('option');
  fallbackModel.value='';
  const defaultName=modelCatalog.models.find(x=>x.id===modelCatalog.defaultModel)?.label;
  fallbackModel.textContent=t('Codex設定を継承')+(defaultName?' ('+defaultName+')':'');
  modelSelect.replaceChildren(fallbackModel);
  for(const entry of modelCatalog.models){
    const option=document.createElement('option');option.value=entry.id;
    option.textContent=entry.label;modelSelect.append(option);
  }
  modelSelect.value=modelCatalog.models.some(x=>x.id===previous.model)?previous.model:'';
  const active=modelCatalog.models.find(x=>x.id===(modelSelect.value||modelCatalog.defaultModel));
  const fallbackEffort=document.createElement('option');fallbackEffort.value='';
  fallbackEffort.textContent=modelSelect.value?t('モデル既定')+' ('+t(active?.defaultEffort||active?.efforts[0]?.id||'自動')+')':t('Codex設定を継承');
  effortSelect.replaceChildren(fallbackEffort);
  for(const option of active?.efforts||[]){
    const item=document.createElement('option');item.value=option.id;
    item.textContent=effortLabels[option.id]||option.id;
    item.title=option.description||'';effortSelect.append(item);
  }
  effortSelect.value=active?.efforts.some(x=>x.id===previous.effort)?previous.effort:'';
  modelSelect.disabled=!modelsAvailable||modelCatalog.models.length===0;
  effortSelect.disabled=!modelsAvailable||!active?.efforts.length;
  const changedEffort=previous.effort&&effortSelect.value!==previous.effort;
  const hint=!modelsAvailable?'モデル一覧を取得できません。Codexの既定設定で実行します。':
    !modelCatalog.models.length?'選択できるモデルがありません。Codexの既定設定を使用します。':
    !active?.efforts.length?'このモデルの対応推論レベルは取得できません。':
    changedEffort?'非対応の推論レベルを解除しました。モデルの対応レベルから選択してください。':
    modelSelect.value||effortSelect.value?
      '次の送信から適用します。モデル単独指定はそのモデルの標準推論、推論単独指定は既定モデルを使用します。':
      '変更しなければ既存チャットのCodex設定を継承します。';
  $('model-hint').textContent=hint;
}
async function refreshModelOptions(){
  $('model-refresh').disabled=true;
  let errorMessage=null;
  try{
    const response=await api('/api/models');
    if(!Array.isArray(response.models))throw Error('モデル一覧の形式が不正です');
    modelCatalog={models:response.models,defaultModel:response.defaultModel||null};
    modelsAvailable=true;
  }catch(error){
    modelCatalog={models:[],defaultModel:null};
    modelsAvailable=false;
    errorMessage=true;
  }finally{
    $('model-refresh').disabled=false;
    fillModelChoices({restore:true});
    splitPane?.fillModels(true);
    if(errorMessage)$('model-hint').textContent=getLanguage()==='en'?'Model fetch failed. Codex defaults will be used.':'モデル取得に失敗しました。Codexの設定を継承します。';
  }
}
function initModelControls(){
  $('model-select').addEventListener('change',()=>{
    fillModelChoices();
    persistModelChoice();
  });
  $('reasoning-select').addEventListener('change',()=>{
    persistModelChoice();
    fillModelChoices();
  });
  $('model-refresh').addEventListener('click',refreshModelOptions);
}

function notify(message,bad=false){
  $('notice').textContent=t(message);
  $('notice').classList.toggle('bad',bad);
}
function showTooltip(item,e){
  tooltip.replaceChildren();
  const title=document.createElement('b'); title.textContent=itemText(item,item.name);
  const rarity=document.createElement('span');rarity.className='rarity '+(item.id==='review'?'epic':item.id==='reset-credit'?'special':['inspect','build','fix'].includes(item.id)?'rare':'common');rarity.textContent=itemText(item,item.category||item.rarity);
  const detail=document.createElement('p');detail.textContent=item.id==='reset-credit'?ticketItemDescription():itemText(item,item.description);
  const hint=document.createElement('small');hint.textContent=t(item.costLabel||'')+' '+itemText(item,item.tip||'')+(item.id==='reset-credit'?(getLanguage()==='en'?' · Remaining: ':' · 残り ')+ticketCountLabel():'');
  if(item.source==='user')for(const element of [title,detail,hint])element.dataset.i18nIgnore='';
  tooltip.append(title,rarity,detail,hint);tooltip.hidden=false;
  const bounds=tooltip.getBoundingClientRect();
  tooltip.style.left=Math.max(8,Math.min(e.clientX+12,innerWidth-bounds.width-12))+'px';
  tooltip.style.top=Math.max(8,Math.min(e.clientY+12,innerHeight-bounds.height-12))+'px';
}
let activeUtilityPanel=null;
function showUtilityPanel(panel,{scroll=false,focus=false}={}){
  const drawer=$('utility-drawer');
  const visible=panel==='tools'||panel==='templates';
  drawer.hidden=!visible;
  $('utility-tools-pane').hidden=panel!=='tools';
  $('utility-templates-pane').hidden=panel!=='templates';
  for(const [id,active] of [['open-local-tools',panel==='tools'],['open-templates',panel==='templates']]){
    $(id).setAttribute('aria-expanded',String(active));
  }
  for(const [id,active] of [['utility-tools-tab',panel==='tools'],['utility-templates-tab',panel==='templates']]){
    const button=$(id);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  }
  activeUtilityPanel=visible?panel:null;
  if(visible&&scroll)drawer.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  if(visible&&focus)$(panel==='tools'?'utility-tools-tab':'utility-templates-tab').focus();
}
function toggleUtilityPanel(panel){
  if(activeUtilityPanel===panel){showUtilityPanel(null);$(panel==='tools'?'open-local-tools':'open-templates').focus();}
  else showUtilityPanel(panel,{scroll:true,focus:true});
}
function initUtilityPanel(){
  $('open-local-tools').addEventListener('click',()=>toggleUtilityPanel('tools'));
  $('open-templates').addEventListener('click',()=>toggleUtilityPanel('templates'));
  $('utility-tools-tab').addEventListener('click',()=>showUtilityPanel('tools',{focus:true}));
  $('utility-templates-tab').addEventListener('click',()=>showUtilityPanel('templates',{focus:true}));
  $('utility-close').addEventListener('click',()=>{
    const opener=activeUtilityPanel==='templates'?'open-templates':'open-local-tools';
    showUtilityPanel(null);$(opener).focus();
  });
  $('utility-drawer').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!event.target.matches('[role="tab"]'))return;
    event.preventDefault();
    const next=event.key==='Home'?'tools':event.key==='End'?'templates':activeUtilityPanel==='tools'?'templates':'tools';
    showUtilityPanel(next,{focus:true});
  });
}
function chooseItem(item){
  if(!item)return;
  selected=item;
  for(const id of ['selected-label','item-title','item-description','quest-lead','item-tip']){
    $(id).toggleAttribute('data-i18n-ignore',item.source==='user');
  }
  for(const b of document.querySelectorAll('[data-item]')){
    const on=b.dataset.item===item.id;
    b.classList.toggle('selected',on);b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));
  }
  $('selected-label').textContent=itemText(item,item.name);
  $('item-title').textContent=itemText(item,item.name);
  $('item-category').textContent='● '+itemText(item,item.category||item.rarity);
  $('item-description').textContent=item.id==='reset-credit'?ticketItemDescription():itemText(item,item.description);
  $('item-tip').textContent=item.id==='reset-credit'?(getLanguage()==='en'?'Owned: '+ticketCountLabel()+' · Redemption cannot be undone':'所持: '+ticketCountLabel()+' · 使う操作は取り消せません'):itemText(item,item.tip||'選択後、操作内容を確認してください。');
  const costKind=item.executionKind==='local'?'ローカル処理':item.executionKind==='template'?'テンプレート':item.executionKind==='interface'?'画面操作':item.executionKind==='ticket'?'利用枠リセット':'Codex処理';
  $('item-cost').textContent=t(costKind)+' · '+t(item.costLabel||'送信時にCodex利用枠を消費する可能性があります');
  $('quest-lead').textContent=itemText(item,item.description);
  const current=$('prompt');
  if(item.prompt&&(!current.value.trim()||current.dataset.suggested==='yes')){
    current.value=t(item.prompt);current.dataset.suggested='yes';
  }
  $('run').textContent=item.id==='reset-credit'?'🎟 リセットチケットを確認・使用':item.id==='reset'?'◈ 新しいチャットを作成':item.id==='diff'?'▤ 差分を確認':item.executionKind==='local'?'ローカルで実行':item.executionKind==='template'?'入力欄に挿入':'▶ クエストを開始 (Ctrl+Enter)';
  if(item.executionKind==='template'){
    $('template-select').value=item.id;paintTemplateEditor();
    showUtilityPanel('templates',{scroll:true});
  }
}
function buildInventory(){
  for(const category of categories){
    const button=document.createElement('button');button.type='button';button.textContent=category;button.dataset.category=category;
    button.addEventListener('click',()=>{catalogCategory=category;catalogPage=0;renderCatalog();});
    $('catalog-categories').append(button);
  }
  $('catalog-prev').addEventListener('click',()=>{catalogPage--;renderCatalog();});
  $('catalog-next').addEventListener('click',()=>{catalogPage++;renderCatalog();});
  $('hotbar-add').addEventListener('click',()=>{inventoryState.hotbar[hotbarIndex]=selected.id;persistInventory();renderHotbar();});
  $('hotbar-remove').addEventListener('click',()=>{inventoryState.hotbar[hotbarIndex]=null;persistInventory();renderHotbar();});
  for(const [id,direction] of [['hotbar-left',-1],['hotbar-right',1]])$(id).addEventListener('click',()=>{
    const next=hotbarIndex+direction;if(next<0||next>8)return;
    [inventoryState.hotbar[hotbarIndex],inventoryState.hotbar[next]]=[inventoryState.hotbar[next],inventoryState.hotbar[hotbarIndex]];
    hotbarIndex=next;persistInventory();renderHotbar();
  });
  renderFeaturedTicket();renderCatalog();renderHotbar();chooseItem(selected);
}
function renderFeaturedTicket(){
  const item=findItem('reset-credit');
  const parent=$('featured-item');
  parent.replaceChildren();
  if(!item)return;
  const button=document.createElement('button');
  button.type='button';button.className='slot featured-ticket';button.setAttribute('aria-label',item.name);
  button.innerHTML=iconFor(item)+'<span class="slot-label"></span>';
  button.querySelector('.slot-label').textContent=item.name;
  setupItemButton(button,item);
  button.addEventListener('click',()=>chooseItem(item));
  parent.append(button);
  paintResetCreditBadges();
}
function iconFor(item){return sprites[item.id]?sprite(item.id):`<span class="item-emoji" aria-hidden="true">${item.icon||'📚'}</span>`;}
function setupItemButton(button,item){
  button.dataset.item=item.id;button.setAttribute('aria-pressed',String(selected.id===item.id));
  if(item.source==='user')button.dataset.i18nIgnore='';
  button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')showTooltip(item,e);});
  button.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&!tooltip.hidden)showTooltip(item,e);});
  button.addEventListener('pointerleave',()=>tooltip.hidden=true);
  button.addEventListener('blur',()=>tooltip.hidden=true);
}
function renderCatalog(){
  const all=catalog();
  // The reset-credit ticket is always visible in its own inventory item slot.
  // Avoid duplicating it in Codex catalog pages or changing 1-9 hotkeys.
  const filtered=(catalogCategory==='ローカル'?all.filter(item=>item.executionKind==='local'):all.filter(item=>item.category===catalogCategory)).filter(item=>item.id!=='reset-credit');
  const pages=Math.max(1,Math.ceil(filtered.length/9));catalogPage=Math.max(0,Math.min(catalogPage,pages-1));
  visibleCatalog=filtered.slice(catalogPage*9,catalogPage*9+9);
  $('catalog-page').textContent=`${catalogPage+1} / ${pages}`;
  $('catalog-prev').disabled=catalogPage===0;$('catalog-next').disabled=catalogPage===pages-1;
  for(const button of $('catalog-categories').querySelectorAll('button')){button.setAttribute('aria-pressed',String(button.dataset.category===catalogCategory));}
  $('slots').replaceChildren();
  visibleCatalog.forEach((item,index)=>{
    const button=document.createElement('button');button.type='button';button.className='slot';button.setAttribute('aria-label',item.name);
    button.innerHTML=iconFor(item)+`<span class="slot-label"></span><span class="slot-key">${index+1}</span>`;
    // Show the complete display name; the slot's multiline layout handles long labels.
    button.querySelector('.slot-label').textContent=item.name;
    if(item.source==='user')button.querySelector('.slot-label').dataset.i18nIgnore='';
    setupItemButton(button,item);button.addEventListener('click',()=>chooseItem(item));$('slots').append(button);
  });
  paintResetCreditBadges();
  for(let index=visibleCatalog.length;index<9;index++){const empty=document.createElement('span');empty.className='slot empty-slot';empty.setAttribute('aria-hidden','true');$('slots').append(empty);}
}
function renderHotbar(){
  $('hotbar').replaceChildren();
  inventoryState.hotbar.forEach((id,index)=>{
    const item=findItem(id);const button=document.createElement('button');button.type='button';button.className=index===hotbarIndex?'hotbar-active':'';
    const label=item?.source==='user'
      ?getLanguage()==='en'?`Slot ${index+1}: ${item.name}. Click to select`:`${index+1}番 ${item.name}。クリックして選択`
      :`${index+1}番 ${item?.name||'空き'}。クリックして選択`;
    button.setAttribute('aria-label',label);
    if(item){button.innerHTML=iconFor(item)+`<span class="hotbar-key">${index+1}</span>`;setupItemButton(button,item);}
    else button.innerHTML=`<span class="hotbar-empty">＋</span><span class="hotbar-key">${index+1}</span>`;
    button.addEventListener('click',()=>{hotbarIndex=index;renderHotbar();if(item)chooseItem(item);});$('hotbar').append(button);
  });
}
function setStatus(status,kind='idle'){$('quest-state').textContent=status;$('quest-state').dataset.state=kind;}
function updateButtons(){
  const running=runningThreads.has(activeThreadId);
  const foreign=isForeignThread();
  $('run').disabled=running||(selected.executionKind!=='ticket'&&(foreign||!workspacePath||projectSwitching))||runningLocalItems.has(selected.id);
  $('new-thread').disabled=!workspacePath||projectSwitching;
  $('stop').disabled=!running;
  setStatus(!workspacePath?'プロジェクト未選択':foreign?'別ワールド・閲覧専用':!activeThreadId?'チャット未選択':running?'実行中':'待機中',foreign?'idle':running?'running':'idle');
}
function saveDraft(){if(activeThreadId)draftPrompts.set(activeThreadId,$('prompt').value);}
async function selectThread(id){
  if(activeThreadId===id)return;
  saveDraft();activeThreadId=id;
  activeThreadCwd=threads.find(t=>t.id===id)?.cwd||null;
  // A foreign thread can be inspected in "all projects" mode, but must not
  // overwrite the last usable chat selection for the active project.
  if(id&&workspacePath&&sameWorkspaceUi(activeThreadCwd,workspacePath))
    try{localStorage.setItem(activeThreadStorageKey(),id);}catch(error){notify('選択チャットを保存できません',true);}
  if(isForeignThread())notify('別プロジェクトのチャットは閲覧専用です。プロジェクト選択から所属先に切り替えてください。',true);
  $('active-thread').textContent=id?displayLabels.threadLabel(id,getLanguage()):t('新規チャット');
  $('prompt').value=draftPrompts.get(id)||'';
  $('prompt').dataset.suggested='no';
  updateSendPreview();
  drawThreads();drawLog();updateButtons();splitPane?.updateButtons();renderActivityFeed();renderCodexApprovals();
  if(!id)return;
  refreshUsage();
  const before=new Map((logs.get(id)||[]).map(message=>
    [message,{text:message.text,pending:message.pending}]));
  try{
    const record=await api('/api/threads/'+encodeURIComponent(id));
    if(activeThreadId!==id)return;
    activeThreadCwd=record.thread?.cwd||activeThreadCwd;
    updateButtons();
    // Stored Codex turns are the source of truth on restart. Preserve any in-flight response.
    const history=(record.messages||[]).map(x=>({role:x.role,text:x.text,itemId:x.itemId||null}));
    const current=(logs.get(id)||[]).filter(message=>{
      const previous=before.get(message);
      return message.pending||(message.itemId&&(!previous||previous.text!==message.text||previous.pending!==message.pending));
    });
    const byItem=new Map(history.map((message,index)=>[message.itemId,index]).filter(([itemId])=>itemId));
    for(const message of current){
      if(message.itemId&&byItem.has(message.itemId))history[byItem.get(message.itemId)]=message;
      else history.push(message);
    }
    logs.set(id,history);
    drawLog();
  }catch(e){notify('履歴を取得できません',true);}
}
function drawThreads(){
  threadList.replaceChildren();
  if(!threads.length){const empty=document.createElement('p');empty.className='list-empty';empty.textContent=workspacePath?'このプロジェクトのチャットはありません':'App Server履歴からプロジェクトを選択してください';threadList.append(empty);}
  for(const thread of threads){
    const b=document.createElement('button');b.type='button';b.className='thread-item'+(thread.id===activeThreadId?' chosen':'');
    b.dataset.threadId=thread.id;
    const name=document.createElement('span');name.className='thread-name';name.textContent=displayLabels.threadLabel(thread.id,getLanguage());
    const meta=document.createElement('small');meta.textContent=(workspacePath&&!sameWorkspaceUi(thread.cwd,workspacePath)?t('別ワールド・閲覧専用')+' · ':'')+(runningThreads.has(thread.id)?(getLanguage()==='en'?'● Running':'● 実行中')+' · ':'')+(thread.updatedAt?new Date(thread.updatedAt*1000).toLocaleString(getLocale()):t('履歴'));
    b.append(name,meta);b.title=name.textContent;b.addEventListener('click',()=>selectThread(thread.id));threadList.append(b);
  }
}
async function refreshThreads(){
  if(projectSwitching)return;
  const requestedWorkspace=workspacePath;
  try{
    const result=await api('/api/threads'+($('show-all').checked?'?all=1':''));
    if(requestedWorkspace!==workspacePath)return;
    threads=result.threads||[];
    needsThreadRefresh=false;
    drawThreads();updateButtons();
    void splitPane?.refreshThreads();
    if(!activeThreadId && threads.length){
      let savedId=null;
      if(workspacePath)try{savedId=localStorage.getItem(activeThreadStorageKey());}catch{}
      // The global thread view may contain foreign workspaces. Never
      // auto-select a foreign thread when returning to this project.
      const ownThread=threads.find(thread=>thread.id===savedId&&sameWorkspaceUi(thread.cwd,workspacePath))||
        threads.find(thread=>sameWorkspaceUi(thread.cwd,workspacePath));
      if(ownThread)await selectThread(ownThread.id);
    }
  }catch(e){needsThreadRefresh=true;notify('チャット一覧を取得できません',true);}
}
async function createThread(choice=turnModelChoice()){
  if(!workspacePath||projectSwitching){notify('先にプロジェクトを選択してください',true);return null;}
  const requestedWorkspace=workspacePath;
  try{
    const result=await api('/api/threads',post({editing:$('editing').checked,...choice}));
    const thread=result.thread;
    if(requestedWorkspace!==workspacePath){notify('プロジェクト切替中に作成しました。所属プロジェクトから開いてください',true);return null;}
    threads.unshift(thread);logs.set(thread.id,[]);
    activeThreadId=null;await selectThread(thread.id);
    notify('新しいCodexスレッドを作成しました');
    await refreshThreads();
    return thread.id;
  }catch(e){notify('新しいチャットを作成できません',true);return null;}
}
function appendMessage(id,role,text,{itemId=null,pending=false}={}){
  const messages=logs.get(id)||[];
  let entry=itemId?messages.find(m=>m.itemId===itemId):null;
  if(entry){entry.text=text;entry.pending=pending;}
  else{entry={role,text,itemId,pending};messages.push(entry);}
  logs.set(id,messages);
  if(id===activeThreadId)drawLog();
  if(id===splitPane?.threadId)splitPane.renderLog();
  return entry;
}
function drawLog(){
  const root=$('log');root.replaceChildren();
  const messages=logs.get(activeThreadId)||[];
  if(!messages.length){const d=document.createElement('div');d.className='empty-log';d.innerHTML='<span>◇</span><strong>まだ会話がありません</strong><small>依頼を入力してクエストを開始しましょう。</small>';root.append(d);return;}
  const fragment=document.createDocumentFragment();
  for(const [index,msg] of messages.entries()){
    const entry=document.createElement('div');entry.className='log-entry '+(msg.role==='assistant'?'answer':msg.role==='user'?'user-message':'command');
    const label=document.createElement('span');label.className='stamp';label.textContent=msg.role==='assistant'?'Codex':msg.role==='user'?'あなた':msg.role==='command'?'コマンド':'変更ファイル';
    entry.append(label);
    if(msg.role==='command'){
      // The complete command remains in the transcript and Copy All. Only its
      // default presentation is collapsed, so long commands do not bury answers.
      const key=JSON.stringify([activeThreadId,msg.itemId||index]);
      const details=document.createElement('details');details.className='command-details';
      details.open=expandedCommands.has(key);
      const summary=document.createElement('summary');summary.className='command-summary';
      const preview=document.createElement('span');preview.className='command-preview';
      preview.textContent=String(msg.text||'').split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'コマンド詳細';
      const hint=document.createElement('span');hint.className='command-hint';hint.textContent=details.open?'閉じる':'全文表示';
      summary.append(preview,hint);
      const full=document.createElement('pre');full.className='command-full';full.textContent=msg.text||'';
      details.append(summary,full);
      details.addEventListener('toggle',()=>{
        hint.textContent=details.open?'閉じる':'全文表示';
        if(details.open)expandedCommands.add(key);
        else expandedCommands.delete(key);
      });
      entry.append(details);
    }else{
      const content=document.createElement('div');content.className='log-content';
      if(msg.role==='assistant')content.append(renderMarkdown(msg.text));else content.textContent=msg.text;
      entry.append(content);
    }
    fragment.append(entry);
  }
  root.append(fragment);root.scrollTop=root.scrollHeight;
}
function attachmentText(){
  return [...attachedResults.values()].map(item=>`【${item.name}】\n${item.text}`).join('\n\n');
}
function updateSendPreview(){
  const attached=[...attachedResults.values()],chars=attachmentText().length;
  const files=attached.reduce((sum,item)=>sum+(item.fileCount||0),0);
  $('send-preview').textContent=getLanguage()==='en'?(attached.length?'Attached '+attached.length+' results · '+files+' visible files · '+chars.toLocaleString(getLocale())+' characters. Sending may consume Codex quota.':'No attachments. Sending to Codex may consume quota.'):(attached.length?`添付 ${attached.length}件 · 表示内のファイル ${files}件 · ${chars.toLocaleString()}文字。送信するとCodex利用枠を消費する可能性があります。`:'添付なし。Codexへの送信時に利用枠を消費する可能性があります。');
}
async function run(){
  if(selected.executionKind==='local'){await executeLocalItem(selected);return;}
  if(selected.executionKind==='template'){applyTemplate();return;}
  if(selected.executionKind==='ticket'){await openResetCreditDialog();return;}
  if(selected.id==='reset'){await createThread();return;}
  if(isForeignThread()){notify('別ワークスペースのチャットは閲覧専用です。現在のワークスペースで新規チャットを作成してください。',true);return;}
  if(selected.id==='diff'){
    await executeLocalItem(localItems.find(item=>item.id==='git-status'));return;
  }
  const prompt=$('prompt').value.trim();if(!prompt){$('prompt').focus();notify('依頼内容を入力してください',true);return;}
  const context=attachmentText();
  const fullPrompt=context?`${prompt}\n\n【ユーザーが選択したローカル結果】\n${context}`:prompt;
  if(fullPrompt.length>10000){notify('添付を含む依頼は10,000文字以内にしてください',true);return;}
  if(['build','fix'].includes(selected.id)&&!$('editing').checked){notify('実装・修正にはファイル編集許可が必要です',true);return;}
  const selectedModelAtSubmit=turnModelChoice();
  if(!activeThreadId){if(!await createThread(selectedModelAtSubmit))return;}
  const id=activeThreadId;
  const sendingWorkspace=workspacePath;
  if(runningThreads.has(id)){notify('このチャットは現在実行中です',true);return;}
  const action=selected.id,editing=$('editing').checked;
  runningThreads.add(id);updateButtons();drawThreads();
  const optimistic=appendMessage(id,'user',prompt);
  try{
    const started=await api('/api/threads/'+encodeURIComponent(id)+'/turn',post({prompt:fullPrompt,action,editing,...selectedModelAtSubmit}));
    if(runningThreads.has(id)&&typeof started.turnId==='string')runningTurnIds.set(id,started.turnId);
    if(sendingWorkspace!==workspacePath){notify('送信後にプロジェクトが切り替わりました。実行内容は元のプロジェクトで確認してください');return;}
    if(activeThreadId===id&&$('prompt').value.trim()===prompt)$('prompt').value='';
    const saved=activeThreadId===id?$('prompt').value:draftPrompts.get(id)||'';
    draftPrompts.set(id,saved.trim()===prompt?'':saved);
    attachedResults.clear();$('local-attach').checked=false;updateSendPreview();notify('Codexが実行を開始しました');
  }catch(e){
    runningThreads.delete(id);updateButtons();drawThreads();
    logs.set(id,(logs.get(id)||[]).filter(entry=>entry!==optimistic));if(activeThreadId===id)drawLog();
    notify('実行を開始できません。対象チャットを確認してください',true);
  }
}
function completionNotificationsEnabled(){
  return $('completion-notifications').checked;
}
function showCompletionToast(threadId,status){
  completionThreadId=threadId;
  const failed=status==='failed',interrupted=status==='interrupted';
  const title=failed?'Codexの処理が失敗しました':interrupted?'Codexの処理を中断しました':'Codexの処理が完了しました';
  $('completion-toast-text').textContent=getLanguage()==='en'?(status==='failed'?'Codex failed. View results.':status==='interrupted'?'Codex was interrupted. View results.':'Codex completed. View results.'):title+'。結果を確認できます。';
  $('completion-toast').dataset.status=failed?'failed':interrupted?'interrupted':'completed';
  $('completion-toast').hidden=false;
  return {title,body:'Codex Inventoryで結果を確認してください。'};
}
function notifyTurnCompleted(threadId,turn){
  if(!completionNotificationsEnabled()||typeof turn?.id!=='string'||!turn.id)return;
  const key=JSON.stringify([threadId,turn.id]);
  if(completedTurnKeys.has(key))return;
  completedTurnKeys.add(key);
  if(completedTurnKeys.size>150)completedTurnKeys.delete(completedTurnKeys.values().next().value);
  const status=['completed','failed','interrupted'].includes(turn.status)?turn.status:'completed';
  // A background turn is already represented in the activity queue; do not overwrite the singleton toast.
  const content=threadId===activeThreadId&&!splitPane?.enabled?showCompletionToast(threadId,status):{
    title:status==='failed'?'Codex failed':status==='interrupted'?'Codex interrupted':'Codex completed',body:'View results in Codex Inventory.'
  };
  if(typeof window.codexInventory?.notifyTurnComplete==='function'){
    // Desktop uses native Windows notifications, even while minimized.
    // Do not include project paths, user prompts, or command output.
    window.codexInventory.notifyTurnComplete(status).catch(()=>{});
  }else if(typeof window.Notification==='function'&&Notification.permission==='granted'){
    try{new Notification(content.title,{body:content.body});}catch{}
  }
}
function initCompletionNotifications(){
  let enabled=true;
  try{enabled=localStorage.getItem(completionPreferenceKey)!=='off';}catch{}
  $('completion-notifications').checked=enabled;
  $('completion-notifications').addEventListener('change',event=>{
    try{localStorage.setItem(completionPreferenceKey,event.target.checked?'on':'off');}catch{}
    if(!event.target.checked)$('completion-toast').hidden=true;
  });
  $('completion-toast-dismiss').addEventListener('click',()=>$('completion-toast').hidden=true);
  $('completion-toast-open').addEventListener('click',async()=>{
    $('completion-toast').hidden=true;
    if(completionThreadId&&threads.some(t=>t.id===completionThreadId)){
      await selectThread(completionThreadId);
    }else{
      notify('完了したチャットを一覧から選択してください。');
    }
  });
}

function renderCodexApprovals(){
  const panel=$('codex-approval-panel'),list=$('codex-approval-list');
  list.replaceChildren();
  const all=[...pendingCodexApprovals.values()].filter(a=>
    a.threadId===activeThreadId&&sameWorkspaceUi(a.workspace,workspacePath));
  panel.hidden=all.length===0;
  $('codex-approval-count').textContent=getLanguage()==='en'?all.length+' pending':all.length+'件 保留中';
  for(const approval of all){
    const card=document.createElement('article');card.className='codex-approval-card';
    const heading=document.createElement('strong');
    heading.textContent=getLanguage()==='en'?(approval.kind==='file'?'File change approval':approval.kind==='permissions'?'Additional permission approval':'Command execution approval'):(approval.kind==='file'?'ファイル変更の許可':approval.kind==='permissions'?'追加権限の許可':'コマンド実行の許可');
    const details=document.createElement('pre');
    details.textContent=approval.kind==='permissions'
      ? JSON.stringify(approval.permissions||{},null,2)
      : approval.command||approval.grantRoot||t('対象ファイル・コマンドの詳細は未提供');
    const hint=document.createElement('small');
    hint.textContent=[displayLabels.projectLabel(approval.workspace,getLanguage()),
      displayLabels.threadLabel(approval.threadId,getLanguage())].join(' · ');
    const actions=document.createElement('div');actions.className='codex-approval-actions';
    for(const [label,decision] of [['今回のみ許可','accept'],['セッション中許可','acceptForSession'],['拒否','decline']]){
      const button=document.createElement('button');button.type='button';
      button.textContent=label;
      button.className=decision==='accept'?'approval-accept':decision==='decline'?'approval-decline':'';
      button.addEventListener('click',async()=>{
        for(const b of actions.querySelectorAll('button'))b.disabled=true;
        try{
          await api('/api/approvals/'+encodeURIComponent(approval.approvalId)+'/respond',
            post({decision,threadId:approval.threadId,turnId:approval.turnId}));
          pendingCodexApprovals.delete(approval.approvalId);renderCodexApprovals();
          notify(decision==='decline'?'Codexの要求を拒否しました':'Codexの要求を許可しました');
        }catch(error){
          notify('許可応答に失敗しました。要求を更新して確認してください',true);
          for(const b of actions.querySelectorAll('button'))b.disabled=false;
          await refreshCodexApprovals();
        }
      });
      actions.append(button);
    }
    card.append(heading,details,hint,actions);list.append(card);
  }
  splitPane?.renderApprovals();
}
async function refreshCodexApprovals(){
  const current=workspacePath;
  const secondary=splitPane?.enabled?splitPane.workspace:null;
  const revision=approvalRevision;
  if(!current&&!secondary)return;
  try{
    const tasks=[];
    if(current)tasks.push(api('/api/approvals',{}, {workspace:current,explicit:true}));
    if(secondary&&!sameWorkspaceUi(current,secondary))
      tasks.push(api('/api/approvals',{}, {workspace:secondary,explicit:true}));
    const results=await Promise.all(tasks);
    if(current!==workspacePath || secondary!==(splitPane?.enabled?splitPane.workspace:null))return;
    if(revision!==approvalRevision){queueMicrotask(()=>void refreshCodexApprovals());return;}
    pendingCodexApprovals.clear();
    for(const result of results)for(const approval of result.approvals||[])
      pendingCodexApprovals.set(approval.approvalId,approval);
    const active=[];
    for(const approval of pendingCodexApprovals.values()){
      const activity=activityFromCodex({type:'approval-request',approval});
      if(activity)active.push(activity);
    }
    activityTimeline.reconcileApprovals(active.map(item=>item.key));
    for(const item of active)activityTimeline.record(item);
    renderActivityFeed();
    renderCodexApprovals();
  }catch(error){console.warn('approval refresh failed');}
}
const activityLabels={
  ja:{started:'処理を開始',command:'コマンド実行中',files:'ファイル変更',approval:'承認待ち',completed:'処理完了',failed:'実行失敗',interrupted:'中断',disconnected:'接続が切断されました'},
  en:{started:'Started',command:'Command running',files:'Files changed',approval:'Approval required',completed:'Completed',failed:'Failed',interrupted:'Interrupted',disconnected:'Disconnected'}
};
function activityThreadName(id) {
  return id?displayLabels.threadLabel(id,getLanguage()):'App Server';
}
function renderWorkspaceConflicts(){
  let panel=$('workspace-conflicts');
  if(!panel){
    panel=document.createElement('section');panel.id='workspace-conflicts';
    panel.className='workspace-conflicts';panel.setAttribute('role','status');
    panel.setAttribute('aria-live','polite');document.body.append(panel);
  }
  panel.replaceChildren();
  const groups=conflictCandidates({workspaceConflicts});
  panel.hidden=groups.length===0;
  if(!groups.length)return;
  const title=document.createElement('strong');
  title.textContent=getLanguage()==='en'?'⚠ Possible edit overlap':'⚠ 編集の競合候補';
  panel.append(title);
  for(const ids of groups){
    const line=document.createElement('p');
    line.textContent=ids.map(id=>displayLabels.threadLabel(id,getLanguage())).join(' · ');
    panel.append(line);
  }
  const note=document.createElement('small');
  note.textContent=getLanguage()==='en'
    ?'These chats are editing in the same workspace. A file conflict is possible, not confirmed. Running turns continue.'
    :'同じワークスペースで編集中です。ファイルの競合は未確定です。実行は継続します。';
  panel.append(note);
}
function renderActivityFeed(){
  const root=$('activity-feed-list');if(!root)return;
  const shown=splitPane?.visibleThreadIds()||[activeThreadId].filter(Boolean);
  const visible=activityTimeline.visible({activeThreadIds:shown,expanded:activityExpanded});
  root.replaceChildren();
  const feed=$('activity-feed');
  feed.hidden=visible.length===0;
  const shownSet=new Set(shown);
  $('activity-feed-launcher').hidden=visible.length>0||!activityTimeline.entries.some(entry=>!shownSet.has(entry.threadId));
  $('activity-feed-toggle').textContent=activityExpanded?'▾':'▴';
  $('activity-feed-toggle').setAttribute('aria-expanded',String(activityExpanded));
  for(const event of visible){
    const item=document.createElement('div');item.className='activity-feed-item';
    const row=document.createElement('button');row.type='button';row.className='activity-feed-entry activity-'+event.kind;
    const name=document.createElement('strong');name.textContent='['+activityThreadName(event.threadId)+']';
    const message=document.createElement('span');message.textContent=(activityLabels[getLanguage()]||activityLabels.ja)[event.kind]||event.kind;
    row.append(name,message);
    if(event.threadId){
      row.addEventListener('click',async()=>{
        if(event.kind==='failed'){activityTimeline.dismiss(event.key);renderActivityFeed();}
        const id=event.threadId;
        if(threads.some(thread=>thread.id===id)){await selectThread(id);return;}
        try{
          if(splitPane?.enabled){
            await splitPane.refreshThreads();
            if(splitPane.threads.some(thread=>thread.id===id)){
              await splitPane.selectThread(id);renderActivityFeed();return;
            }
          }
          const {threads:all=[]}=await api('/api/threads?all=1');
          const target=all.find(thread=>thread.id===id);
          if(!target){notify('対象チャットが見つかりません',true);return;}
          if(!sameWorkspaceUi(target.cwd,workspacePath))await switchProject(target.cwd);
          if(sameWorkspaceUi(target.cwd,workspacePath)){
            await refreshThreads();
            if(threads.some(thread=>thread.id===id))await selectThread(id);
          }
        }catch(error){notify('対象チャットを開けません',true);}
      });
    }else row.disabled=true;
    item.append(row);
    if(event.kind==='failed'&&!event.dismissed){
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='activity-dismiss';
      dismiss.textContent='×';dismiss.setAttribute('aria-label',getLanguage()==='en'?'Dismiss failure notification':'失敗通知を閉じる');
      dismiss.addEventListener('click',()=>{activityTimeline.dismiss(event.key);renderActivityFeed();});
      item.append(dismiss);
    }
    root.append(item);
  }
}
function initActivityFeed(){
  const root=$('activity-feed');if(!root)return;
  $('activity-feed-launcher').addEventListener('click',()=>{activityExpanded=true;renderActivityFeed();});
  root.addEventListener('mouseenter',()=>{activityHover=true;renderActivityFeed();});
  root.addEventListener('mouseleave',()=>{activityHover=false;renderActivityFeed();});
  $('activity-feed-toggle').addEventListener('click',()=>{activityExpanded=!activityExpanded;renderActivityFeed();});
  activityRefreshTimer=setInterval(()=>{if(!activityHover&&!activityExpanded)renderActivityFeed();},1000);
}
function recordActivity(event){
  const change=activityFromCodex(event);
  if(event.type==='approval-reset') {activityTimeline.clearApprovals();renderActivityFeed();return false;}
  if(change&&activityTimeline.record(change)){renderActivityFeed();return true;}
  return false;
}


function onCodex(e){
  const newActivity=recordActivity(e);
  if(e.type==='activity-state'){
    runtimeRevision++;
    applyRuntimeActivity(e);
    return;
  }
  if(e.type==='approval-request'){
    approvalRevision++;
    pendingCodexApprovals.set(e.approval.approvalId,e.approval);
    renderCodexApprovals();
    if(!newActivity||!sameWorkspaceUi(e.approval.workspace,workspacePath)||
      (splitPane?.visibleThreadIds()||[activeThreadId]).includes(e.approval.threadId))return;
    if(typeof window.codexInventory?.notifyApprovalNeeded==='function'){
      window.codexInventory.notifyApprovalNeeded().catch(()=>{});
    }else if(typeof window.Notification==='function'&&Notification.permission==='granted'){
      try{new Notification('Codexの許可が必要です',{body:'Codex Inventoryで操作を確認してください。'});}catch{}
    }
    return;
  }
  if(e.type==='approval-resolved'){
    approvalRevision++;
    pendingCodexApprovals.delete(e.approvalId);renderCodexApprovals();return;
  }
  if(e.type==='approval-reset'){approvalRevision++;pendingCodexApprovals.clear();renderCodexApprovals();return;}
  if(e.type==='turn-start'){
    if(typeof e.turnId==='string')runningTurnIds.set(e.threadId,e.turnId);
    runningThreads.add(e.threadId);drawThreads();updateButtons();splitPane?.updateButtons();return;
  }
  if(e.type==='connection'){runningThreads.clear();runningTurnIds.clear();workspaceConflicts=[];renderWorkspaceConflicts();connected=false;updateButtons();splitPane?.updateButtons();$('connection').textContent='APP SERVER OFFLINE';document.querySelector('.lamp').classList.remove('ok');notify('App Serverとの接続が切断されました',true);return;}
  if(e.type==='warning'){notify('App Serverから警告を受信しました。対象チャットを確認してください',true);return;}
  if(e.type!=='codex')return;
  const {method,threadId:id,params:p}=e;
  if(method==='account/rateLimits/updated'){refreshUsage();return;}
  if(!id)return;
  if(method==='turn/started'){if(typeof p.turn?.id==='string')runningTurnIds.set(id,p.turn.id);runningThreads.add(id);updateButtons();drawThreads();splitPane?.updateButtons();}
  if(method==='item/agentMessage/delta'){
    const itemId=p.itemId||p.item?.id||'stream-'+(p.turnId||id);
    const messages=logs.get(id)||[];
    const prev=messages.find(x=>x.itemId===itemId);
    appendMessage(id,'assistant',(prev?.text||'')+(p.delta||''),{itemId,pending:true});
  }
  if(method==='item/completed'){
    const item=p.item||{};
    if(item.type==='agentMessage')appendMessage(id,'assistant',item.text||'',{itemId:item.id,pending:false});
    if(item.type==='commandExecution')appendMessage(id,'command',item.command||'',{itemId:item.id});
    if(item.type==='fileChange')appendMessage(id,'files',(item.changes||[]).map(c=>c.path||c.kind).join('\n'),{itemId:item.id});
  }
  if(method==='turn/completed'){
    if(runningTurnIds.get(id)===p.turn?.id)runningTurnIds.delete(id);
    runningThreads.delete(id);updateButtons();drawThreads();splitPane?.updateButtons();
    if(p.turn?.status==='failed')notify('Codexの実行に失敗しました。対象チャットの実行ログを確認してください',true);
    notifyTurnCompleted(id,p.turn);
    refreshThreads();refreshUsage();
  }
  if(method==='thread/tokenUsage/updated')refreshUsage();
}
async function refreshRuntimeActivity(){
  const revision=runtimeRevision;
  try{
    const result=await api('/api/activity-state');
    if(revision===runtimeRevision)applyRuntimeActivity(result);
  }catch(error){console.warn('runtime activity refresh failed');}
}
function applyRuntimeActivity(result){
  if(!Array.isArray(result.runningThreadIds))return;
  const previous=new Map(runningTurnIds);
  runningThreads.clear();runningTurnIds.clear();
  for(const id of result.runningThreadIds)if(typeof id==='string')runningThreads.add(id);
  for(const row of result.runningTurns||[])
    if(runningThreads.has(row.threadId)&&typeof row.turnId==='string')runningTurnIds.set(row.threadId,row.turnId);
  workspaceConflicts=Array.isArray(result.workspaceConflicts)?result.workspaceConflicts:[];
  renderWorkspaceConflicts();
  for(const row of result.recentCompletions||[]){
    if(!row||previous.get(row.threadId)!==row.turnId||runningThreads.has(row.threadId))continue;
    if(!['completed','failed','interrupted'].includes(row.status))continue;
    const turn={id:row.turnId,status:row.status};
    recordActivity({type:'codex',method:'turn/completed',threadId:row.threadId,params:{turn}});
    notifyTurnCompleted(row.threadId,turn);
  }
  drawThreads();updateButtons();splitPane?.updateButtons();
}

function connectEvents(){
  if(eventStream)eventStream.close();
  eventStream=new EventSource('/api/events');
  eventStream.onmessage=ev=>{try{onCodex(JSON.parse(ev.data));}catch(e){console.warn('update event could not be processed');}};
  eventStream.onerror=()=>notify('更新イベントを再接続しています…',true);
  eventStream.onopen=()=>{
    activityTimeline.clearConnection();renderActivityFeed();
    void refreshRuntimeActivity();refreshCodexApprovals();
    if(activeThreadId){const id=activeThreadId;activeThreadId=null;selectThread(id);}
    if(splitPane?.enabled){void splitPane.loadThread();void splitPane.refreshThreads();}
    refreshThreads();
  };
}
function formatReset(unix){return typeof unix==='number'?new Date(unix*1000).toLocaleString(getLocale()):t('未取得');}
function quotaWindowLabel(quota,fallback){
  const minutes=quota?.windowDurationMins;
  if(minutes===300)return t('5時間');
  if(minutes===10080)return t('週間');
  if(typeof minutes==='number'&&Number.isFinite(minutes)&&minutes>0){
    if(minutes%10080===0)return (minutes/10080)+(getLanguage()==='en'?' weeks':'週間');
    if(minutes%1440===0)return (minutes/1440)+(getLanguage()==='en'?' days':'日');
    if(minutes%60===0)return (minutes/60)+(getLanguage()==='en'?' hours':'時間');
    return minutes+(getLanguage()==='en'?' minutes':'分');
  }
  return t(fallback);
}
function paintQuota(container,label,quota){
  container.replaceChildren();
  const title=document.createElement('div');title.className='quota-head';
  const name=document.createElement('span');name.textContent=label;
  const pct=document.createElement('strong');pct.textContent=quota&&typeof quota.usedPercent==='number'?getLanguage()==='en'?`${Math.round(Math.max(0,100-quota.usedPercent))}% remaining`:`${Math.round(Math.max(0,100-quota.usedPercent))}% 残り`:t('取得不可');
  title.append(name,pct);container.append(title);
  if(quota){
    const track=document.createElement('div');track.className='quota-track';
    const bar=document.createElement('div');bar.style.width=Math.max(0,Math.min(100,100-(quota.usedPercent||0)))+'%';track.append(bar);container.append(track);
    const detail=document.createElement('small');detail.textContent=getLanguage()==='en'?`Used ${quota.usedPercent}% · Resets ${formatReset(quota.resetsAt)}`:`利用済み ${quota.usedPercent}% · リセット ${formatReset(quota.resetsAt)}`;container.append(detail);
  }
}
async function refreshUsage(){
  try{
    const data=await api('/api/usage');
    needsUsageRefresh=!!data.error;
    const p=data.primary,s=data.secondary;
    paintQuota($('quota-primary'),quotaWindowLabel(p,'短期利用枠'),p);
    paintQuota($('quota-secondary'),quotaWindowLabel(s,'長期利用枠'),s);
    $('quota-note').textContent=t(data.error?'利用量を取得できません':'利用枠はCodexのアカウント情報から取得');
    paintResetTicketState(data);
    const record=data.sessionTokens?.find(t=>t.threadId===activeThreadId);
    const tokens=record?.usage?.total?.totalTokens ?? record?.usage?.totalTokens ?? null;
    $('usage').textContent=tokens===null?'TOKEN数 未取得':tokens.toLocaleString()+' TOKENS';
  }catch(e){needsUsageRefresh=true;paintQuota($('quota-primary'),'短期利用枠',null);paintQuota($('quota-secondary'),'長期利用枠',null);$('usage').textContent=t('TOKEN数 未取得');$('quota-note').textContent=t('利用量を取得できません');paintResetTicketState(null);}
}
/** The selected project controls chat, item storage and all local tool routes. */
function setCurrentWorkspace(value){
  const next=value||'';
  if(workspacePath===next)return;
  saveDraft();
  workspacePath=next;
  pendingCodexApprovals.clear();renderCodexApprovals();
  activeThreadId=null;activeThreadCwd=null;threads=[];
  $('active-thread').textContent='新規チャット';
  $('prompt').value='';$('prompt').dataset.suggested='no';
  attachedResults.clear();
  $('local-attach').checked=false;
  currentResult=null;
  $('local-results').hidden=true;
  $('workspace').textContent=next?displayLabels.projectLabel(next,getLanguage()):'App Serverにプロジェクト履歴がありません';
  inventoryState=next?loadState(localStorage,next,builtinTemplates):initialState();
  selected=findItem(selected.id)||codexItems[0];
  renderCatalog();renderHotbar();paintTemplateList();chooseItem(selected);
  fillModelChoices({restore:true});
  drawThreads();drawLog();updateSendPreview();updateButtons();
  void refreshCodexApprovals();
}
function paintProjectPicker(){
  const select=$('project-select');
  const oldSelection=select.value;
  select.replaceChildren();
  if(!detectedProjects.length){
    const option=document.createElement('option');option.value='';
    option.textContent='プロジェクトが見つかりません';
    select.append(option);select.disabled=true;
  }else{
    for(const project of detectedProjects){
      const option=document.createElement('option');option.value=project.cwd;
      option.textContent=displayLabels.projectLabel(project.cwd,getLanguage())+' · '+project.threadCount+(getLanguage()==='en'?' chats':'件')+(project.exists?'':getLanguage()==='en'?' (folder missing)':'（フォルダーなし）');
      option.title=displayLabels.projectLabel(project.cwd,getLanguage());option.disabled=!project.exists;
      select.append(option);
    }
    if(workspacePath&&detectedProjects.some(project=>sameWorkspaceUi(project.cwd,workspacePath)))
      select.value=detectedProjects.find(project=>sameWorkspaceUi(project.cwd,workspacePath)).cwd;
    else if(oldSelection&&detectedProjects.some(project=>project.cwd===oldSelection))
      select.value=oldSelection;
    else select.selectedIndex=-1;
    select.disabled=projectSwitching||!autoDiscoverProjects;
  }
  if(!autoDiscoverProjects){
    $('project-hint').textContent='固定ワークスペース起動。自動選択には -Workspace なしで起動してください。';
    select.disabled=true;
  }else if(!detectedProjects.length){
    $('project-hint').textContent=window.codexInventory?.addProject?
      '履歴がありません。「＋」でフォルダーを登録してください。':
      '履歴がありません。Web版は -Workspace を指定して起動してください。';
  }else{
    $('project-hint').textContent=workspacePath?displayLabels.projectLabel(workspacePath,getLanguage()):'プロジェクトを選択してください。';
  }
}
async function refreshProjects({force=false,restorePreferred=false}={}){
  const result=await api('/api/projects'+(force?'?refresh=1':''));
  detectedProjects=Array.isArray(result.projects)?result.projects:[];
  autoDiscoverProjects=!!result.autoDiscover;
  let target=result.workspace||'';
  if(restorePreferred&&autoDiscoverProjects){
    let saved=null;try{saved=localStorage.getItem(preferredProjectKey);}catch{}
    const match=detectedProjects.find(project=>project.exists&&sameWorkspaceUi(project.cwd,saved));
    if(match&&!sameWorkspaceUi(match.cwd,target)){
      const selected=await api('/api/projects/select',post({cwd:match.cwd}));
      target=selected.workspace;
    }
  }
  setCurrentWorkspace(target);
  paintProjectPicker();
  projectInitialized=true;
}
async function switchProject(cwd){
  if(projectSwitching||!autoDiscoverProjects||!cwd||sameWorkspaceUi(cwd,workspacePath))return;
  const old=workspacePath;
  projectSwitching=true;paintProjectPicker();updateButtons();
  try{
    const result=await api('/api/projects/select',post({cwd}));
    setCurrentWorkspace(result.workspace);
    try{localStorage.setItem(preferredProjectKey,result.workspace);}catch{}
    await refreshProjects();
    projectSwitching=false;
    paintProjectPicker();updateButtons();
    await refreshThreads();await refreshUsage();
    notify('プロジェクトを切り替えました: '+displayLabels.projectLabel(result.workspace,getLanguage()));
  }catch(e){
    projectSwitching=false;
    setCurrentWorkspace(old);
    paintProjectPicker();updateButtons();
    notify('プロジェクト切替に失敗しました',true);
  }
}
function initProjectPicker(){
  if(typeof window.codexInventory?.addProject==='function'){
    $('project-add').hidden=false;
    $('project-add').addEventListener('click',async()=>{
      if(projectSwitching)return;
      $('project-add').disabled=true;
      try{
        const selected=await window.codexInventory.addProject();
        if(!selected?.workspace)return;
        await refreshProjects({force:true});
        try{localStorage.setItem(preferredProjectKey,selected.workspace);}catch{}
        await refreshThreads();await refreshUsage();
        notify('プロジェクトを追加しました: '+displayLabels.projectLabel(selected.workspace,getLanguage()));
      }catch(error){notify('フォルダーを追加できません',true);}
      finally{$('project-add').disabled=false;}
    });
  }
  $('project-select').addEventListener('change',event=>switchProject(event.target.value));
  $('project-refresh').addEventListener('click',async()=>{
    if(projectSwitching)return;
    $('project-refresh').disabled=true;
    try{await refreshProjects({force:true});await refreshThreads();notify('Codex App Serverからプロジェクトを再検出しました');}
    catch(e){notify('プロジェクト更新に失敗しました',true);}
    finally{$('project-refresh').disabled=false;}
  });
}
async function refreshStatus(){
  try{
    const status=await api('/api/status');
    if(!projectSwitching&&workspacePath!==(status.workspace||'')){
      setCurrentWorkspace(status.workspace);
      if(projectInitialized)paintProjectPicker();
    }
    updateButtons();drawThreads();
    $('connection').textContent=status.connected?'APP SERVER READY':'APP SERVER OFFLINE';
    document.querySelector('.lamp').classList.toggle('ok',status.connected);
    const recovered=status.connected&&!connected;
    connected=status.connected;
    if(!status.connected){notify('App Serverに接続できません。Codex CLIの状態を確認してください',true);return;}
    if(recovered){
      let discoveryFailure=status.discoveryError||null;
      try{await refreshProjects({force:true,restorePreferred:!projectInitialized});}
      catch(error){discoveryFailure=true;}
      connectEvents();await refreshThreads();await refreshUsage();await refreshModelOptions();
      notify(discoveryFailure?'App Serverに接続しましたがプロジェクト取得に失敗しました':
        workspacePath?'Codex App Serverに接続しました':'App Serverに接続しました。プロジェクト履歴を確認してください。',!!discoveryFailure);
    }
    else {
      if(needsThreadRefresh)await refreshThreads();
      if(needsUsageRefresh)await refreshUsage();
    }
  }catch(e){connected=false;$('connection').textContent='APP SERVER OFFLINE';document.querySelector('.lamp').classList.remove('ok');notify('App Serverに接続できません',true);}
}
/** Local tools never call turn/start or alter Codex conversation logs. */
async function executeLocalItem(item){
  if(!item||!workspacePath){notify('ローカル道具を使うにはプロジェクトを選択してください',true);return;}
  const executingWorkspace=workspacePath;
  if(runningLocalItems.has(item.id)){notify('このローカル道具は実行中です',true);return;}
  runningLocalItems.add(item.id);updateButtons();
  const button=$(`local-${item.id}`);if(button)button.disabled=true;
  try{
    const input={};
    if(item.input==='query'){
      input.query=$('local-query').value.trim();
      if(input.query.length<2){$('local-query').focus();notify('検索語を2文字以上入力してください',true);return;}
    }
    if(item.approvalCommand){
      const preview=await api('/api/local-tools/'+encodeURIComponent(item.id)+'/preview');
      const steps=(preview.steps||[]).map(step=>step.name+': '+step.script).join('\n');
      const notice=[
        (getLanguage()==='en'?'Command: ':'実行コマンド: ')+preview.command,
        (getLanguage()==='en'?'Workspace: ':'ワークスペース: ')+preview.workspace,
        '',
        t('実際に実行されるnpmスクリプト（前後の処理を含む）')+':',
        steps||preview.script,
        '',
        getLanguage()==='en'?'npm scripts may edit files, use the network or incur external charges. No Codex quota is used.':(preview.warning||'Codex利用枠は消費しませんが、ファイル変更・外部通信の可能性があります。'),
        t('承認は1回限り／約60秒で失効します。package.jsonが変更された場合は再承認が必要です。'),
        '',
        t('表示した内容を確認し、この実行を承認しますか？')
      ].join('\n');
      if(!confirm(notice))return;
      input.approvalToken=preview.approvalToken;
    }
    const resultData=await api('/api/local-tools/'+encodeURIComponent(item.id),post(input));
    if(executingWorkspace!==workspacePath){notify('道具の実行中にプロジェクトが切り替わりました。結果は破棄しました',true);return;}
    const value=(resultData.sections||[]).map(part=>'【'+t(part.heading)+'】\n'+part.output).join('\n\n');
    currentResult={id:item.id,name:item.name,text:value,fileCount:resultData.fileCount||0};
    if(attachedResults.has(item.id)){attachedResults.set(item.id,currentResult);updateSendPreview();}
    $('local-result-title').textContent=t(item.name)+' · '+(getLanguage()==='en'?'No Codex usage':'Codex未使用');
    $('local-result-text').textContent=value;
    $('local-attach').checked=attachedResults.has(item.id);
    $('local-results').hidden=false;
    showUtilityPanel('tools');
    $('local-results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    notify(getLanguage()==='en'?t(item.name)+': checked locally (no Codex turn)':item.name+'：ローカルで確認しました（Codexのターンなし）');
  }catch(error){notify('ローカル道具を実行できません',true);}
  finally{runningLocalItems.delete(item.id);updateButtons();if(button)button.disabled=false;}
}
function paintLocalItems(){
  const holder=$('local-items');
  if(!holder)return;
  holder.replaceChildren();
  for(const item of localItems){
    const button=document.createElement('button');
    button.type='button';button.className='local-item-button';button.id='local-'+item.id;button.disabled=runningLocalItems.has(item.id);
    const title=document.createElement('strong');title.textContent=item.icon+' '+t(item.name);
    const note=document.createElement('small');note.textContent=t(item.description);
    button.append(title,note);
    button.title=t(item.costLabel)+' / '+t(item.description);
    button.addEventListener('click',()=>executeLocalItem(item));
    holder.append(button);
  }
}
async function setupLocalItems(){
  const holder=$('local-items');
  if(!holder)return;
  try{
    const data=await api('/api/items');
    localItems=(data.items||[]).filter(item=>item.executionKind==='local');
    paintLocalItems();
    renderCatalog();renderHotbar();
    $('local-attach').addEventListener('change',()=>{
      if(!currentResult)return;
      if($('local-attach').checked)attachedResults.set(currentResult.id,currentResult);
      else attachedResults.delete(currentResult.id);
      updateSendPreview();
    });
    $('local-copy').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText($('local-result-text').textContent);notify('ローカル結果をコピーしました');}
      catch{notify('結果のコピーができませんでした',true);}
    });
  }catch(error){holder.textContent='ローカル道具を読み込めません';}
}
function paintTemplateList(preferred){
  const select=$('template-select');const previous=preferred||select.value;
  select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='テンプレートを選択…';select.append(blank);
  const groups=new Map();
  const ordered=allTemplates().sort((a,b)=>Number(inventoryState.favorites.includes(b.id))-Number(inventoryState.favorites.includes(a.id)));
  for(const template of ordered){
    const label=template.source==='user'?t('ユーザー'):t(template.category);
    let group=groups.get(label);if(!group){group=document.createElement('optgroup');group.label=label;groups.set(label,group);select.append(group);}
    const option=document.createElement('option');option.value=template.id;option.textContent=(inventoryState.favorites.includes(template.id)?'★ ':'')+template.title;if(template.source==='user')option.dataset.i18nIgnore='';group.append(option);
  }
  select.value=allTemplates().some(item=>item.id===previous)?previous:'';
  paintTemplateEditor();renderCatalog();renderHotbar();
}
function paintTemplateEditor(){
  const template=allTemplates().find(item=>item.id===$('template-select').value);
  $('template-description').toggleAttribute('data-i18n-ignore',template?.source==='user');
  $('template-description').textContent=template?.description||'テンプレートを選んでください';
  $('template-title').value=template?.title||'';$('template-description-edit').value=template?.description||'';$('template-body').value=template?.body||'';
  $('template-recommended-mode').value=template?.recommendedMode||'read';
  $('template-delete').disabled=!template||template.source!=='user';
  $('template-favorite').textContent=template&&inventoryState.favorites.includes(template.id)?'★ お気に入り':'☆ お気に入り';
  paintTemplateVariables();
}
function paintTemplateVariables(){
  const holder=$('template-variables');
  const old=new Map([...holder.querySelectorAll('input')].map(input=>[input.name,input.value]));holder.replaceChildren();
  for(const variable of variablesOf($('template-body').value)){
    const label=document.createElement('label');label.textContent='{'+variable+'}';
    const input=document.createElement('input');input.name=variable;input.value=old.get(variable)||'';input.maxLength=1000;
    input.addEventListener('input',paintTemplatePreview);label.append(input);holder.append(label);
  }
  paintTemplatePreview();
}
function renderedTemplate(){
  const values=new Map([...$('template-variables').querySelectorAll('input')].map(input=>[input.name,input.value]));
  const missing=[];const output=$('template-body').value.replace(/\{([a-z_]+)\}/g,(all,key)=>{
    const value=values.get(key)?.trim();if(!value){missing.push(key);return all;}return value;
  });
  return {output,missing:[...new Set(missing)]};
}
function paintTemplatePreview(){
  const {output,missing}=renderedTemplate();
  $('template-preview').textContent=output+(missing.length?(getLanguage()==='en'?'\n\nMissing variables: ':'\n\n未入力: ')+missing.map(key=>'{'+key+'}').join(', '):'');
}
function applyTemplate(){
  const template=allTemplates().find(item=>item.id===$('template-select').value);
  if(!template){notify('テンプレートを選択してください',true);return;}
  const {output,missing}=renderedTemplate();const editor=$('prompt');
  const append=$('template-insert-mode').value==='append';
  if(!append&&editor.value.trim()&&editor.dataset.suggested!=='yes'&&!confirm(t('入力中の文章をテンプレートに置き換えますか？')))return;
  editor.value=append&&editor.value.trim()?editor.value.trimEnd()+'\n\n'+output:output;
  editor.dataset.suggested='no';saveDraft();editor.focus();updateSendPreview();
  notify(missing.length?'未入力の変数があります':'テンプレートを入力欄に挿入しました。送信はまだ行っていません。',!!missing.length);
}
function newTemplate(from){
  if(inventoryState.userTemplates.length>=100){notify('ユーザーテンプレートは100件までです',true);return;}
  const id='user-'+crypto.randomUUID();
  const template=validateTemplate({id,title:from?.title?from.title+(getLanguage()==='en'?' copy':' のコピー'):t('新しいテンプレート'),description:from?.description||'',category:from?.category||'ユーザー',body:from?.body||t('目標: {goal}\n手順と結果を報告してください。')});
  inventoryState.userTemplates.push(template);persistInventory();paintTemplateList(id);notify('ユーザーテンプレートを作成しました');
}
async function setupPromptTemplates(){
  try{
    const data=await api('/api/templates');originalBuiltinTemplates=Array.isArray(data.templates)?data.templates:[];builtinTemplates=localizedBuiltins();
    paintTemplateList();
    $('template-select').addEventListener('change',paintTemplateEditor);
    $('template-body').addEventListener('input',paintTemplateVariables);
    $('template-apply').addEventListener('click',applyTemplate);
    $('template-new').addEventListener('click',()=>newTemplate());
    $('template-duplicate').addEventListener('click',()=>{const item=allTemplates().find(x=>x.id===$('template-select').value);if(item)newTemplate(item);});
    $('template-save').addEventListener('click',()=>{
      const id=$('template-select').value;const item=allTemplates().find(x=>x.id===id);if(!item){notify('テンプレートを選択してください',true);return;}
      try{
        const title=$('template-title').value.trim(),body=$('template-body').value,description=$('template-description-edit').value.trim(),recommendedMode=$('template-recommended-mode').value;
        if(item.source==='user'){
          const updated=validateTemplate({...item,title,body,description,recommendedMode});
          inventoryState.userTemplates[inventoryState.userTemplates.findIndex(x=>x.id===id)]=updated;
        }else{
          if(!title||!body||title.length>100||body.length>10000)throw Error('タイトルまたは本文の形式が不正です');
          inventoryState.overrides[id]={title,description,body,recommendedMode};
        }
        persistInventory();paintTemplateList(id);notify('テンプレートを保存しました');
      }catch(error){notify('テンプレートを保存できません',true);}
    });
    $('template-delete').addEventListener('click',()=>{
      const id=$('template-select').value;const item=allTemplates().find(x=>x.id===id);if(!item||item.source!=='user')return;
      if(!confirm(getLanguage()==='en'?'Delete '+item.title+'?':`${item.title} を削除しますか？`))return;
      inventoryState.userTemplates=inventoryState.userTemplates.filter(x=>x.id!==id);
      inventoryState.favorites=inventoryState.favorites.filter(x=>x!==id);
      inventoryState.hotbar=inventoryState.hotbar.map(x=>x===id?null:x);
      persistInventory();paintTemplateList();notify('ユーザーテンプレートを削除しました');
    });
    $('template-favorite').addEventListener('click',()=>{
      const id=$('template-select').value;if(!id)return;
      inventoryState.favorites=inventoryState.favorites.includes(id)?inventoryState.favorites.filter(x=>x!==id):[...inventoryState.favorites,id];
      persistInventory();paintTemplateList(id);
    });
    $('template-export').addEventListener('click',()=>{
      const blob=new Blob([exportTemplateJson(inventoryState)],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='codex-inventory-templates.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    $('template-import').addEventListener('change',async event=>{
      const file=event.target.files?.[0];if(!file)return;
      try{
        if(file.size>1_000_000)throw Error('ファイルが大きすぎます');
        const imported=parseTemplateImport(await file.text(),builtinTemplates);
        const current=new Map(inventoryState.userTemplates.map(x=>[x.id,x]));
        if(imported.some(x=>current.has(x.id))&&!confirm(t('同じIDのユーザーテンプレートを上書きしますか？')))return;
        for(const item of imported)current.set(item.id,item);
        if(current.size>100)throw Error('ユーザーテンプレートは100件までです');
        inventoryState.userTemplates=[...current.values()];persistInventory();paintTemplateList();notify(`${imported.length}件のテンプレートを読み込みました`);
      }catch(error){notify('テンプレートを読み込めません',true);}finally{event.target.value='';}
    });
  }catch(error){$('template-description').textContent='テンプレートを取得できません';}
}
const quotaDescription=window=>window&&typeof window.usedPercent==='number'?
  Math.max(0,100-window.usedPercent)+(getLanguage()==='en'?'% remaining / resets ':'% 残り / 通常リセット ')+dateText(window.resetsAt):
  t('現在の利用枠を取得できません');
function resetDialogMessage(value,bad=false){
  const node=$('reset-credit-dialog-message');
  node.textContent=t(value);node.classList.toggle('bad',bad);
}
async function openResetCreditDialog(){
  if(consumingResetCredit)return;
  const dialog=$('reset-credit-dialog');
  stagedResetCredit=null;
  $('reset-credit-choose').hidden=true;
  $('reset-credit-review-panel').hidden=true;
  $('reset-credit-result').hidden=true;
  $('reset-credit-result').textContent='';
  $('reset-credit-close').textContent='閉じる（使用しない）';
  $('reset-credit-consent').checked=false;
  $('reset-credit-confirm').disabled=true;
  resetDialogMessage('利用可能なチケットを取得しています…');
  if(!dialog.open)dialog.showModal();
  try{
    const data=await api('/api/usage');
    paintResetTicketState(data);
    const count=resetTicketState?.availableCount;
    if(!Number.isSafeInteger(count)){
      resetDialogMessage('リセットチケットの残枚数を取得できません。0枚とは限りません。しばらくしてから再度確認してください。',true);
      return;
    }
    if(count===0){resetDialogMessage('現在利用できるチケットは0枚です。',false);return;}
    const rows=resetCreditRows();
    const select=$('reset-credit-choice');
    select.replaceChildren();
    if(rows.length){
      for(const row of rows){
        const option=document.createElement('option');option.value=row.id;
        option.textContent=(row.title||t('リセットチケット'))+' / '+(row.expiresAt?(getLanguage()==='en'?'Expires ':'期限 ')+dateText(row.expiresAt):t('期限なし'));
        select.append(option);
      }
    }else if(!Array.isArray(resetTicketState?.credits)||resetTicketState.credits.length===0){
      const option=document.createElement('option');option.value='';
      option.textContent=t('個別情報未取得 / Codex側に1枚選択させる');
      select.append(option);
    }else{
      resetDialogMessage('使用可能と確認できるチケットがありません。状態を更新して確認してください。',true);
      return;
    }
    $('reset-credit-choice-info').textContent=getLanguage()==='en'?
      'Remaining: '+ticketCountLabel()+'. '+(rows.length?'Choose a ticket.':'Ticket IDs and expirations are unavailable, so Codex will choose one.')+' Inspecting this dialog does not redeem tickets.':
      '残り '+ticketCountLabel()+'。'+(rows.length?'チケットを選べます。':'個別の期限やIDが未取得のため、自動選択になります。')+' この画面で確認するだけでは消費されません。';
    $('reset-credit-choose').hidden=false;
    resetDialogMessage('使用するチケットを選び、内容を確認してください。');
    select.focus();
  }catch(e){
    resetDialogMessage(getLanguage()==='en'?'Could not get ticket information. No ticket was redeemed.':'情報を取得できません。チケットは消費していません。',true);
  }
}
async function reviewResetCredit(){
  const button=$('reset-credit-review');
  if(button.disabled||consumingResetCredit)return;
  button.disabled=true;
  resetDialogMessage('使用する内容をCodexに確認しています…');
  try{
    const creditId=$('reset-credit-choice').value||null;
    const plan=await api('/api/reset-credits/prepare',post({creditId}));
    stagedResetCredit=plan;
    const credit=plan.selectedCredit;
    const details=[
      (getLanguage()==='en'?'Ticket: ':'チケット: ')+(credit?.title||t('保存済みリセット（Codexが使用するチケットを選択）')),
      (getLanguage()==='en'?'Expires: ':'有効期限: ')+(credit?(credit.expiresAt?dateText(credit.expiresAt):t('期限なし')):t('未取得')),
      (getLanguage()==='en'?'Tickets before redemption: '+plan.availableCount:'消費前の所持枚数: '+plan.availableCount+'枚'),
      quotaWindowLabel(plan.primary,'短期利用枠')+': '+quotaDescription(plan.primary),
      quotaWindowLabel(plan.secondary,'長期利用枠')+': '+quotaDescription(plan.secondary),
      t('消費後は新しい利用枠情報を取得して確認します。')
    ];
    $('reset-credit-review-details').textContent=details.join('\n');
    $('reset-credit-consent').checked=false;
    $('reset-credit-confirm').disabled=true;
    $('reset-credit-choose').hidden=true;
    $('reset-credit-review-panel').hidden=false;
    resetDialogMessage('最終確認：本当にこのチケットを使用しますか？');
    $('reset-credit-consent').focus();
  }catch(e){resetDialogMessage('チケットを準備できません',true);}
  finally{button.disabled=false;}
}
async function confirmResetCredit(){
  if(consumingResetCredit||!stagedResetCredit||!$('reset-credit-consent').checked)return;
  consumingResetCredit=true;
  const token=stagedResetCredit.confirmationToken;
  stagedResetCredit=null; // never reuse a token
  $('reset-credit-confirm').disabled=true;
  $('reset-credit-back').disabled=true;
  $('reset-credit-close').disabled=true;
  resetDialogMessage('リセットチケットを処理中です。結果が出るまでお待ちください…');
  try{
    const result=await api('/api/reset-credits/confirm',post({confirmationToken:token}));
    const labels={
      reset:'リセットが完了し、チケットを1枚使用しました。',
      alreadyRedeemed:'この使用操作は既に処理されています。利用状況を確認してください。',
      nothingToReset:'現在リセットできる利用枠がなく、チケットは使用されませんでした。',
      noCredit:'チケットが利用できませんでした。残枚数を更新してください。'
    };
    const text=t(labels[result.outcome]||'処理結果を確認できません。');
    $('reset-credit-result').hidden=false;
    $('reset-credit-result').textContent=text+(result.refreshError?' '+t('利用状況を更新できませんでした。'):'');
    resetDialogMessage(text);
    $('reset-credit-review-panel').hidden=true;
    $('reset-credit-choose').hidden=true;
    $('reset-credit-close').textContent=t('閉じる');
    notify(text,result.outcome!=='reset'&&result.outcome!=='alreadyRedeemed');
    await refreshUsage();
  }catch(e){
    $('reset-credit-result').hidden=false;
    $('reset-credit-result').textContent=t('消費されたか不明な場合があります。重複使用を避けるため、再実行せず利用状況を更新して確認してください。');
    resetDialogMessage('使用結果を確認できません',true);
    $('reset-credit-review-panel').hidden=true;
    $('reset-credit-choose').hidden=true;
    $('reset-credit-close').textContent=t('閉じる');
    await refreshUsage();
  }finally{
    consumingResetCredit=false;
    $('reset-credit-back').disabled=false;
    $('reset-credit-close').disabled=false;
  }
}
function initResetCreditDialog(){
  $('ticket-open').addEventListener('click',()=>{
    chooseItem(findItem('reset-credit'));openResetCreditDialog();
  });
  $('reset-credit-close').addEventListener('click',()=>{
    if(!consumingResetCredit)$('reset-credit-dialog').close();
  });
  $('reset-credit-dialog').addEventListener('cancel',event=>{
    if(consumingResetCredit)event.preventDefault();
  });
  $('reset-credit-dialog').addEventListener('close',()=>{
    stagedResetCredit=null;
    $('reset-credit-consent').checked=false;
    $('reset-credit-confirm').disabled=true;
  });
  $('reset-credit-review').addEventListener('click',reviewResetCredit);
  $('reset-credit-back').addEventListener('click',()=>{
    stagedResetCredit=null;
    $('reset-credit-review-panel').hidden=true;
    $('reset-credit-choose').hidden=false;
    resetDialogMessage('チケットを選び直してください。');
    $('reset-credit-choice').focus();
  });
  $('reset-credit-consent').addEventListener('change',event=>{
    $('reset-credit-confirm').disabled=!event.target.checked||!stagedResetCredit||consumingResetCredit;
  });
  $('reset-credit-confirm').addEventListener('click',confirmResetCredit);
}

async function boot(){
  setupLanguage({onChange:()=>{
    // Re-render only application chrome, preserving user-written drafts and
    // immutable thread/workspace keys. Locale is global, never per project.
    const prompt=$('prompt');
    if(prompt.dataset.suggested==='yes'&&selected.prompt){
      prompt.value=t(selected.prompt);
    }
    const oldTemplate=allTemplates().find(x=>x.id===$('template-select').value);
    const currentBody=$('template-body').value;
    const currentTitle=$('template-title').value;
    const currentDescription=$('template-description-edit').value;
    const dirty=oldTemplate&&(
      currentBody!==oldTemplate.body||
      currentTitle!==oldTemplate.title||
      currentDescription!==oldTemplate.description
    );
    const templateId=$('template-select').value;
    builtinTemplates=localizedBuiltins();
    if(originalBuiltinTemplates.length){
      paintTemplateList(templateId);
      if(dirty){
        $('template-body').value=currentBody;
        $('template-title').value=currentTitle;
        $('template-description-edit').value=currentDescription;
        paintTemplateVariables();
      }
    }
    const selectedId=selected.id;
    selected=findItem(selectedId)||selected;
    document.title=t('Codex Inventory — 冒険の作業台');
    renderFeaturedTicket();renderCatalog();renderHotbar();chooseItem(selected);paintLocalItems();
    if(currentResult)$('local-result-title').textContent=t(currentResult.name)+' · '+(getLanguage()==='en'?'No Codex usage':'Codex未使用');
    if(dirty){
      $('template-body').value=currentBody;
      $('template-title').value=currentTitle;
      $('template-description-edit').value=currentDescription;
      paintTemplateVariables();
    }
    paintProjectPicker();fillModelChoices();splitPane?.fillModels(true);updateButtons();drawThreads();updateSendPreview();translateDom();
    $('workspace').textContent=workspacePath?displayLabels.projectLabel(workspacePath,getLanguage()):'App Serverにプロジェクト履歴がありません';
    $('active-thread').textContent=activeThreadId?displayLabels.threadLabel(activeThreadId,getLanguage()):t('新規チャット');
    renderActivityFeed();renderWorkspaceConflicts();void splitPane?.refreshThreads();
    window.codexInventory?.setLanguage?.(getLanguage())?.catch(()=>{});
    void refreshUsage().catch(()=>{});
  }});
  document.title=t('Codex Inventory — 冒険の作業台');
  window.codexInventory?.setLanguage?.(getLanguage())?.catch(()=>{});
  initUtilityPanel();
  initResetCreditDialog();
  initCompletionNotifications();
  initProjectPicker();
  initModelControls();
  splitPane=new SplitPane({
    api,post,notify,getLanguage,getLocale,
    getCatalog:()=>modelCatalog,
    getPrimaryThreadId:()=>activeThreadId,
    labelThread:thread=>displayLabels.threadLabel(thread.id,getLanguage()),
    onVisibilityChange:()=>{renderActivityFeed();renderWorkspaceConflicts();},
    getRunning:()=>runningThreads,
    getTurnId:id=>runningTurnIds.get(id)||null,
    setTurnId:(id,turnId)=>{if(runningThreads.has(id)&&typeof turnId==='string')runningTurnIds.set(id,turnId);},
    getMessages:id=>logs.get(id)||[],
    setMessages:(id,data)=>{logs.set(id,data);if(id===activeThreadId)drawLog();},
    appendMessage,renderMarkdown,
    getApprovals:()=>[...pendingCodexApprovals.values()],
    afterApproval:id=>{pendingCodexApprovals.delete(id);renderCodexApprovals();},
    refreshApprovals:()=>refreshCodexApprovals(),
    onSharedStatus:()=>{drawThreads();updateButtons();}
  });
  buildInventory();
  await setupLocalItems();
  await setupPromptTemplates();
  $('new-thread').addEventListener('click',()=>createThread());
  $('reload-threads').addEventListener('click',async()=>{
    await refreshProjects({force:true}).catch(e=>notify('プロジェクト更新に失敗しました',true));
    await refreshThreads();
  });
  $('show-all').addEventListener('change',refreshThreads);
  $('run').addEventListener('click',run);
  $('stop').addEventListener('click',async()=>{if(!activeThreadId)return;
    const id=activeThreadId,turnId=runningTurnIds.get(id);
    if(!turnId){notify('停止対象のターンを確認できません。状態を更新して再試行してください',true);void refreshRuntimeActivity();return;}
    try{await api('/api/threads/'+encodeURIComponent(id)+'/interrupt',post({turnId}),{workspace:workspacePath,explicit:true});notify('中断を要求しました');}
    catch(e){notify('中断に失敗しました。対象ターンを確認してください',true);}
  });
  $('clear-log').textContent='履歴を再読込';
  $('clear-log').addEventListener('click',async()=>{if(!activeThreadId)return;const id=activeThreadId;activeThreadId=null;await selectThread(id);});
  $('copy-log').addEventListener('click',async()=>{
    const output=(logs.get(activeThreadId)||[]).map(m=>`${m.role}\n${m.text}`).join('\n\n');
    try{await navigator.clipboard.writeText(output);notify('会話をコピーしました');}catch{notify('クリップボードへのコピーに失敗しました',true);}
  });
  $('editing').addEventListener('change',e=>{
    $('mode-badge').classList.toggle('write',e.target.checked);
    $('mode-badge').textContent=e.target.checked?'編集許可モード':'観察モード';
  });
  $('prompt').addEventListener('input',()=>{$('prompt').dataset.suggested='no';saveDraft();updateSendPreview();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      tooltip.hidden=true;
      if(activeUtilityPanel){const target=activeUtilityPanel==='templates'?'open-templates':'open-local-tools';showUtilityPanel(null);$(target).focus();}
    }
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();return;}
    if(/^[1-9]$/.test(e.key)){
      if(e.altKey){e.preventDefault();hotbarIndex=Number(e.key)-1;renderHotbar();chooseItem(findItem(inventoryState.hotbar[hotbarIndex]));return;}
      if(!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.activeElement?.isContentEditable){
        const item=visibleCatalog[Number(e.key)-1];if(item){e.preventDefault();chooseItem(item);}
      }
    }
  });
  await refreshStatus();
  await refreshCodexApprovals();
  updateSendPreview();
  updateButtons();
  initActivityFeed();
  listRefresh=setInterval(refreshThreads,15000);
  usageRefresh=setInterval(refreshUsage,60000);
  statusRefresh=setInterval(refreshStatus,3000);
}
boot();
