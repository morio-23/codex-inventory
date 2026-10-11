'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Only expose a fixed native folder picker, not filesystem or arbitrary IPC.
contextBridge.exposeInMainWorld('codexInventory',Object.freeze({
  addProject:()=>ipcRenderer.invoke('codex-inventory:choose-project'),
  notifyTurnComplete:status=>ipcRenderer.invoke('codex-inventory:turn-complete',status),
  notifyApprovalNeeded:()=>ipcRenderer.invoke('codex-inventory:approval-needed'),
  setLanguage:language=>ipcRenderer.invoke('codex-inventory:language',language)
}));
