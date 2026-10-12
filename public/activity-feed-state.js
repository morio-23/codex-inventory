// UI-only activity timeline. Never record prompts, commands, output or paths.
const KINDS = new Set(['started','command','files','approval','completed','failed','interrupted','disconnected']);
const STATUS = new Set(['completed','failed','interrupted']);
export function activityFromCodex(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'approval-request' && typeof event.approval?.threadId === 'string')
    return {threadId:event.approval.threadId,kind:'approval',key:'approval:'+event.approval.approvalId,persistent:true};
  if (event.type === 'approval-resolved' && typeof event.threadId === 'string')
    return {threadId:event.threadId,kind:'approval-resolved',key:'approval:'+event.approvalId};
  if (event.type === 'turn-start' && typeof event.threadId === 'string')
    return {threadId:event.threadId,kind:'started',key:'start:'+event.turnId};
  if (event.type === 'connection')
    return {threadId:'',kind:'disconnected',key:'connection',persistent:true};
  if (event.type !== 'codex' || typeof event.threadId !== 'string') return null;
  const p=event.params||{}, id=event.threadId;
  if (event.method === 'turn/started')return {threadId:id,kind:'started',key:'start:'+p.turn?.id};
  if (event.method === 'turn/completed') {
    const kind=STATUS.has(p.turn?.status)?p.turn.status:'completed';
    return {threadId:id,kind,key:'finish:'+p.turn?.id};
  }
  if(event.method==='item/started'&&p.item?.type==='commandExecution')
    return {threadId:id,kind:'command',key:'command:'+p.item.id};
  if(event.method==='item/completed'&&p.item?.type==='fileChange')
    return {threadId:id,kind:'files',key:'files:'+p.item.id};
  return null;
}
export class ActivityTimeline {
  constructor({limit=100,ttlMs=8000}={}) {
    this.limit=limit;this.ttlMs=ttlMs;this.entries=[];this.keys=new Set();
  }
  record(value,now=Date.now()) {
    if(!value || (value.kind!=='approval-resolved'&&!KINDS.has(value.kind)))return false;
    if(value.kind==='approval-resolved') {
      this.entries=this.entries.filter(entry=>entry.key!==value.key);
      this.keys.delete(value.key);
      return true;
    }
    if(typeof value.threadId!=='string'||typeof value.key!=='string'||!value.key||this.keys.has(value.key))return false;
    // Coalesce bursts in the same thread and category into one current activity.
    if(['command','files'].includes(value.kind)){
      const recent=this.entries.findLast(entry=>entry.threadId===value.threadId&&entry.kind===value.kind&&now-entry.at<2000);
      if(recent){recent.at=now;return true;}
    }
    this.entries.push({threadId:value.threadId,kind:value.kind,key:value.key,at:now,persistent:!!value.persistent});
    this.keys.add(value.key);
    while(this.entries.length>this.limit){const old=this.entries.shift();this.keys.delete(old.key);}
    return true;
  }
  visible({activeThreadIds=[],now=Date.now(),expanded=false}={}) {
    const active=new Set(activeThreadIds);
    return this.entries.filter(entry=>!active.has(entry.threadId)&&(expanded||entry.persistent||now-entry.at<this.ttlMs)).slice(expanded?-100:-4);
  }
  clearTransient(){this.entries=this.entries.filter(x=>x.persistent);this.keys=new Set(this.entries.map(x=>x.key));}
  clearApprovals(){this.entries=this.entries.filter(x=>x.kind!=='approval');this.keys=new Set(this.entries.map(x=>x.key));}
  clearConnection(){this.entries=this.entries.filter(x=>x.kind!=='disconnected');this.keys=new Set(this.entries.map(x=>x.key));}
}
