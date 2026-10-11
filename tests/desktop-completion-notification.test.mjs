import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Electron exposes only a constrained completion notifier, not general IPC or browser permissions',async()=>{
  const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  assert.match(main,/ipcMain\.handle\('codex-inventory:turn-complete'/);
  assert.match(main,/event\.sender!==mainWindow\.webContents/);
  assert.match(main,/event\.senderFrame!==mainWindow\.webContents\.mainFrame/);
  assert.match(main,/new URL\(event\.sender\.getURL\(\)\)\.origin!==new URL\(backend\.url\)\.origin/);
  assert.match(main,/\['completed','failed','interrupted'\]\.includes\(status\)/);
  assert.match(main,/if\(!Notification\.isSupported\(\)\)/);
  assert.match(main,/toast\.on\('click'/);
  assert.match(main,/app\.setAppUserModelId\(APP_ID\)/);
  assert.match(main,/session\.defaultSession\.setPermissionRequestHandler/);
  assert.match(preload,/notifyTurnComplete:status=>ipcRenderer\.invoke\('codex-inventory:turn-complete',status\)/);
  assert.doesNotMatch(preload,/send\s*:|execute\s*:|eval\s*:/);
});

// Only inspect the requested handler, never adjacent IPC registrations.
// A new notification handler should not make another handler's privacy test
// fail merely because a nearby comment mentions a sensitive field name.
function nativeHandler(source,name){
  const main=source.replace(/\r\n/g,'\n');
  const start=main.indexOf("ipcMain.handle('codex-inventory:"+name+"'");
  assert.ok(start>=0,'missing native handler: '+name);
  const end=main.indexOf('\n});',start);
  assert.ok(end>start,'missing closing bracket for native handler: '+name);
  return main.slice(start,end+4);
}

test('The completion notification never interpolates a project path, prompt, command or error text',async()=>{
  const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const handler=nativeHandler(main,'turn-complete');
  assert.match(handler,/body:desktopText\('Codex Inventoryで結果を確認してください。','Open Codex Inventory to review the result.'/);
  assert.match(handler,/title:titles\[status\]/);
  assert.doesNotMatch(handler,/command|prompt|threadId|workspacePath|cwd/);
});

test('Approval notifications are fixed-text and exposed through constrained IPC',async()=>{
  const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  const handler=nativeHandler(main,'approval-needed');
  assert.match(handler,/event\.sender!==mainWindow\.webContents/);
  assert.match(handler,/event\.senderFrame!==mainWindow\.webContents\.mainFrame/);
  assert.match(handler,/new URL\(event\.sender\.getURL\(\)\)\.origin!==new URL\(backend\.url\)\.origin/);
  assert.match(handler,/title:desktopText\('Codexが許可を求めています','Codex needs approval'\)/);
  assert.match(handler,/body:desktopText\('Codex Inventoryを開き、要求内容を確認してください。','Open Inventory to review the request.'\)/);
  assert.doesNotMatch(handler,/command|prompt|threadId|workspacePath|cwd/);
  assert.match(preload,/notifyApprovalNeeded:\(\)=>ipcRenderer\.invoke\('codex-inventory:approval-needed'\)/);
});

test('Native language switch uses only validated enum through own origin and main frame',async()=>{
  const main=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
  const handler=nativeHandler(main,'language');
  assert.match(handler,/event\.sender!==mainWindow\.webContents/);
  assert.match(handler,/event\.senderFrame!==mainWindow\.webContents\.mainFrame/);
  assert.match(handler,/new URL\(event\.sender\.getURL\(\)\)\.origin!==new URL\(backend\.url\)\.origin/);
  assert.match(handler,/language!=='ja'&&language!=='en'/);
  assert.match(preload,/setLanguage:language=>ipcRenderer\.invoke\('codex-inventory:language',language\)/);
});
