export const categories=['ローカル','Git','プロジェクト','Codex','テンプレート'];
const keyPrefix='codex-inventory:v0.5:';
const defaultHotbar=['git-status','code-search','todo-scan','project-tree','project-preview','quest',null,null,null];
const idPattern=/^[a-z0-9-]{1,80}$/;
const variablePattern=/\{([a-z_]+)\}/g;
const maxTemplates=100;
export const variablesOf=body=>[...new Set([...body.matchAll(variablePattern)].map(match=>match[1]))];
export function storageKey(workspace){
  const value=/^[A-Za-z]:[\\/]/.test(workspace)?workspace.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase():workspace.replace(/\/+$/,'');
  return keyPrefix+encodeURIComponent(value);
}
export function initialState(){return {hotbar:[...defaultHotbar],userTemplates:[],overrides:{},favorites:[]};}
function string(value,min,max,label){if(typeof value!=='string'||value.length<min||value.length>max)throw Error(`${label}の形式が不正です`);return value;}
export function validateTemplate(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('テンプレートの形式が不正です');
  const id=string(value.id,1,80,'ID');if(!idPattern.test(id)||!id.startsWith('user-'))throw Error('ユーザーテンプレートIDが不正です');
  const body=string(value.body,1,10000,'本文');
  const category=string(value.category,1,40,'カテゴリ');
  if(value.version!==undefined&&value.version!==1)throw Error('テンプレートのバージョンが不正です');
  if(value.recommendedMode!==undefined&&!['read','write'].includes(value.recommendedMode))throw Error('推奨モードが不正です');
  const requiredTools=value.requiredTools??[],tags=value.tags??[];
  if(!Array.isArray(requiredTools)||requiredTools.length>20||requiredTools.some(x=>typeof x!=='string'||x.length>80))throw Error('必要な道具の形式が不正です');
  if(!Array.isArray(tags)||tags.length>20||tags.some(x=>typeof x!=='string'||x.length>40))throw Error('タグの形式が不正です');
  return {id,version:1,title:string(value.title,1,100,'タイトル'),description:string(value.description||'',0,300,'説明'),category,body,variables:variablesOf(body),recommendedMode:value.recommendedMode==='write'?'write':'read',requiredTools:[...requiredTools],tags:[...tags],executionKind:'template',costLabel:'選択・編集ではCodex利用枠の消費なし',source:'user'};
}
function normalize(input,builtinIds){
  const base=initialState();
  if(!input||typeof input!=='object'||Array.isArray(input))return base;
  if(Array.isArray(input.hotbar)&&input.hotbar.length===9)base.hotbar=input.hotbar.map(id=>id===null||typeof id==='string'&&idPattern.test(id)?id:null);
  if(Array.isArray(input.userTemplates)){
    const seen=new Set();
    for(const raw of input.userTemplates.slice(0,maxTemplates)){
      try{const item=validateTemplate(raw);if(!seen.has(item.id)&&!builtinIds.has(item.id)){base.userTemplates.push(item);seen.add(item.id);}}catch{}
    }
  }
  if(input.overrides&&typeof input.overrides==='object'&&!Array.isArray(input.overrides)){
    for(const [id,raw] of Object.entries(input.overrides)){
      if(!builtinIds.has(id)||!raw||typeof raw!=='object')continue;
      try{base.overrides[id]={title:string(raw.title,1,100,'タイトル'),description:string(raw.description||'',0,300,'説明'),body:string(raw.body,1,10000,'本文'),recommendedMode:raw.recommendedMode==='write'?'write':'read'};}catch{}
    }
  }
  if(Array.isArray(input.favorites))base.favorites=[...new Set(input.favorites.filter(id=>typeof id==='string'&&(builtinIds.has(id)||base.userTemplates.some(x=>x.id===id))))];
  return base;
}
export function loadState(storage,workspace,builtins=[]){
  try{return normalize(JSON.parse(storage.getItem(storageKey(workspace))),new Set(builtins.map(x=>x.id)));}
  catch{return initialState();}
}
export function saveState(storage,workspace,state){storage.setItem(storageKey(workspace),JSON.stringify(state));}
export function mergedTemplates(builtins,state){
  return [...builtins.map(item=>{
    const override=state.overrides[item.id];
    return override?{...item,...override,variables:variablesOf(override.body)}:{...item};
  }),...state.userTemplates];
}
export function parseTemplateImport(text,builtins){
  if(typeof text!=='string'||text.length>1_000_000)throw Error('ファイルが大きすぎます');
  let data;try{data=JSON.parse(text);}catch{throw Error('JSONを読み取れません');}
  if(!data||data.version!==1||!Array.isArray(data.templates)||data.templates.length>maxTemplates)throw Error('テンプレート形式または件数が不正です');
  const ids=new Set(builtins.map(x=>x.id));const templates=[];
  for(const raw of data.templates){const item=validateTemplate(raw);if(ids.has(item.id))throw Error('テンプレートIDが重複しています');ids.add(item.id);templates.push(item);}
  return templates;
}
export function exportTemplateJson(state){return JSON.stringify({version:1,templates:state.userTemplates},null,2);}
