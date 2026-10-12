import translations from './strings.en.js';
export const LANGUAGE_KEY='codex-inventory:language';
export function normalizeLanguage(value){return typeof value==='string'&&value.toLowerCase().startsWith('ja')?'ja':'en';}
export function preferredLanguage({stored=null,languages=[]}={}){
  return stored==='ja'||stored==='en'?stored:normalizeLanguage(languages[0]||'ja');
}
let current='ja';
export const getLanguage=()=>current;
export const getLocale=()=>current==='en'?'en-US':'ja-JP';
const rules=[
  [/^(\d+)枚$/,(m,n)=>n+' tickets'],
  [/^残り\s*(\d+)枚$/,(m,n)=>'Remaining: '+n+' tickets'],
  [/^残り\s*(\d+)$/,(m,n)=>'Remaining: '+n],
  [/^(\d+)番\s+(.+)。クリックして選択$/,(m,n,name)=>'Slot '+n+': '+translateJapanese(name)+'. Click to select'],
  [/^未入力:\s*(.*)$/,(m,variables)=>'Missing variables: '+variables],
  [/^モデル既定 \((.+)\)$/,(m,effort)=>'Model default ('+translateJapanese(effort)+')'],
  [/^(\d+)分枠$/,(m,n)=>n+'-minute window'],
  [/^(\d+)時間枠$/,(m,n)=>n+'-hour window'],
  [/^(\d+)日枠$/,(m,n)=>n+'-day window']
];
const translatedPrefixes=Object.entries(translations).filter(([source])=>source.endsWith(': ')||source.endsWith('：')||source.endsWith(' ')).filter(([source])=>source.length>=5).sort((a,b)=>b[0].length-a[0].length);
export function translateJapanese(source){
  if(typeof source!=='string'||!source)return source;
  const leading=source.match(/^\s*/)?.[0]||'';
  const trailing=source.match(/\s*$/)?.[0]||'';
  const trimmed=source.trim();
  if(Object.hasOwn(translations,trimmed))return leading+translations[trimmed]+trailing;
  for(const [from,to] of translatedPrefixes){
    if(trimmed.startsWith(from))return leading+to+translateJapanese(trimmed.slice(from.length))+trailing;
  }
  for(const [pattern,fn] of rules){
    const matched=trimmed.match(pattern);
    if(matched)return leading+fn(...matched)+trailing;
  }
  return source;
}
export function t(source){return current==='en'?translateJapanese(source):source;}

// Scope translations to application chrome. Never rewrite a transcript,
// command, user-authored template, input value, project name or search result.
const ignored='script,style,noscript,pre,code,[contenteditable],[data-i18n-ignore],#log .log-content,#log .command-preview,#log .command-full,#secondary-log .log-content,#secondary-prompt,#secondary-approvals pre,.thread-name,#template-variables,#local-result-text';
const nodeSources=new WeakMap();
const attrSources=new WeakMap();
const attrs=['title','aria-label','placeholder'];
function eligible(node){
  const el=node.nodeType===1?node:node.parentElement;
  return !!el&&!el.closest(ignored);
}
function paintNode(node){
  if(!eligible(node))return;
  if(node.nodeType===3){
    const previous=nodeSources.get(node);
    const value=node.nodeValue||'';
    const original=previous&&value===previous.last?previous.source:value;
    const next=current==='en'?translateJapanese(original):original;
    nodeSources.set(node,{source:original,last:next});
    if(value!==next)node.nodeValue=next;
  }else if(node.nodeType===1){
    const saved=attrSources.get(node)||{};
    for(const attr of attrs){
      if(!node.hasAttribute(attr))continue;
      const value=node.getAttribute(attr),previous=saved[attr];
      const original=previous&&value===previous.last?previous.source:value;
      const next=current==='en'?translateJapanese(original):original;
      saved[attr]={source:original,last:next};
      if(value!==next)node.setAttribute(attr,next);
    }
    attrSources.set(node,saved);
  }
}
export function translateDom(root=document.documentElement){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
  paintNode(root);
  for(let node=walker.nextNode();node;node=walker.nextNode())paintNode(node);
}
let subscriber=null;
export function setLanguage(lang,{persist=true}={}){
  current=normalizeLanguage(lang);
  document.documentElement.lang=current;
  const picker=document.getElementById('ui-language');
  if(picker)picker.value=current;
  if(persist){try{localStorage.setItem(LANGUAGE_KEY,current);}catch{}}
  translateDom();
  subscriber?.(current);
  document.dispatchEvent(new CustomEvent('inventory-language-change',{detail:{language:current}}));
  return current;
}
export function setupLanguage({onChange=null}={}){
  subscriber=onChange;
  let stored=null;
  try{stored=localStorage.getItem(LANGUAGE_KEY);}catch{}
  current=preferredLanguage({stored,languages:navigator.languages?.length?navigator.languages:[navigator.language]});
  document.documentElement.lang=current;
  const picker=document.getElementById('ui-language');
  if(picker){
    picker.value=current;
    picker.addEventListener('change',()=>setLanguage(picker.value));
  }
  translateDom();
  let queued=false;
  const observer=new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;translateDom();});
  });
  observer.observe(document.body,{
    subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attrs
  });
  return current;
}
