import {randomBytes} from 'node:crypto';
import {previewProjectCommand} from './project-tools.mjs';

const scriptedItems=new Set(['project-test','project-lint']);
const denied=(message,status=409)=>Object.assign(new Error(message),{status});

/**
 * Local-only, ephemeral approval capabilities. Never persisted or logged.
 *
 * A preview is not authentication: other local processes can use the localhost
 * API. This token prevents casual bypass/replay and binds the displayed
 * package.json snapshot to the command at execution time.
 */
export function createScriptApprovalStore({ttlMs=60_000,maxPending=32,now=()=>Date.now()}={}){
  const pending=new Map();
  function prune(){
    for(const [token,entry] of pending)if(entry.expiresAt<=now())pending.delete(token);

  }
  return {
    async issue(id,workspace){
      if(!scriptedItems.has(id))throw denied('承認対象外のアイテムです',404);
      const preview=await previewProjectCommand(id,workspace);
      prune();
      while(pending.size>=maxPending)pending.delete(pending.keys().next().value);
      const approvalToken=randomBytes(32).toString('hex');
      const expiresAt=now()+ttlMs;
      pending.set(approvalToken,{
        id,workspaceRequest:workspace,workspace:preview.workspace,manifestHash:preview.manifestHash,expiresAt
      });
      return {...preview,approvalToken,expiresAt};
    },
    consume(id,workspace,approvalToken){
      if(typeof approvalToken!=='string'||!/^[0-9a-f]{64}$/.test(approvalToken))
        throw denied('有効な実行承認がありません。プレビューを開き直してください');
      const record=pending.get(approvalToken);
      // Consume BEFORE any awaited filesystem operations; no parallel replay.
      pending.delete(approvalToken);
      if(!record||record.expiresAt<=now()||record.id!==id||record.workspaceRequest!==workspace)
        throw denied('承認の期限切れ、再利用、または対象不一致です。プレビューを開き直してください');
      return {id,workspace:record.workspace,manifestHash:record.manifestHash};
    },
    pendingCount(){prune();return pending.size;}
  };
}
