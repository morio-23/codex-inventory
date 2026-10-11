'use strict';
const {app,BrowserWindow,Notification,dialog,shell,session,ipcMain}=require('electron');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {isolatedSmokeProfile}=require('./smoke-profile.cjs');
const {readFile,writeFile,mkdir}=require('node:fs/promises');
const {pathToFileURL}=require('node:url');

const INSTALL_HELP='https://github.com/openai/codex#quickstart';
const APP_ID='net.codexinventory.desktop';
const smokeProfile=isolatedSmokeProfile({tempRoot:tmpdir()});
if(smokeProfile)app.setPath('userData',smokeProfile);
let mainWindow=null;
let backend=null;
let closing=false;
let nativeLocale='ja';
function desktopText(ja,en){return nativeLocale==='en'?en:ja;}

if(!app.requestSingleInstanceLock()){
  app.quit();
}else{
  app.on('second-instance',()=>{
    if(!mainWindow)return;
    if(mainWindow.isMinimized())mainWindow.restore();
    mainWindow.show();mainWindow.focus();
  });
}

async function settings(){
  try{return JSON.parse(await readFile(join(app.getPath('userData'),'settings.json'),'utf8'));}
  catch{return {};}
}
async function saveSettings(changes){
  const folder=app.getPath('userData');
  await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'settings.json'),JSON.stringify({...await settings(),...changes},null,2),'utf8');
}
async function pickCodex(){
  const response=await dialog.showOpenDialog({
    title:desktopText('Codex CLI実行ファイルを選択','Choose the Codex CLI executable'),
    properties:['openFile'],
    filters:[{name:'Codex CLI',extensions:['exe','cmd','bat']}]
  });
  return response.canceled?null:response.filePaths[0]||null;
}
async function packageModules(){
  process.env.CODEX_NO_LISTEN='1';
  const resourceRoot=app.isPackaged?join(process.resourcesPath,'inventory'):join(__dirname,'..');
  const [{detectCodex},server]=await Promise.all([
    import(pathToFileURL(join(__dirname,'codex-detect.mjs')).href),
    import(pathToFileURL(join(resourceRoot,'server.mjs')).href)
  ]);
  return {detectCodex,startInventoryServer:server.startInventoryServer};
}
async function locateBackend(modules){
  let preferred=(await settings()).codexPath||null;
  let previousError='';
  let excluded=[];
  while(!closing){
    const discovered=await modules.detectCodex({preferred,excluded});
    if(discovered.path){
      try{
        const stored=await settings();
        const selectedPort=Number.isSafeInteger(stored.httpPort)&&stored.httpPort>0&&stored.httpPort<65536?
          stored.httpPort:8765;
        const options={
          command:discovered.command,commandEnv:discovered.env,
          cwd:process.env.USERPROFILE||process.env.HOME||app.getPath('home'),
          selectedWorkspace:null,knownProjects:Array.isArray(stored.knownProjects)?stored.knownProjects:[]
        };
        let started;
        try{started=await modules.startInventoryServer({...options,listenPort:selectedPort});}
        catch(error){
          // Do not mistake a local port collision for broken CLI/login.
          if(error.code!=='EADDRINUSE')throw error;
          started=await modules.startInventoryServer({...options,listenPort:0});
        }
        await saveSettings({codexPath:discovered.path,httpPort:started.port}).catch(()=>{});
        return started;
      }catch(error){
        previousError=error.message;
        excluded.push(discovered.path);
        // A valid --version is not enough. Test every available backend
        // before asking the user to intervene.
        continue;
      }
    }
    const message=discovered.path?
      desktopText('Codex CLIは検出しましたが、App Serverへの接続に失敗しました。','Codex CLI was found, but the App Server connection failed.')+
      '\n\n'+discovered.path+'\n'+previousError:
      desktopText('このPCで利用可能なCodex CLIが見つかりませんでした。','No compatible Codex CLI was found on this computer.')+
      desktopText('\nCodex Desktopだけを導入していてCLIが存在しない場合、CLIの追加インストールが必要なことがあります。','\nIf only Codex Desktop is installed, you may need to install Codex CLI separately.');
    const answer=await dialog.showMessageBox({
      type:'warning',
      title:desktopText('Codexへの接続','Codex connection'),
      message:desktopText('Codex Inventoryの起動準備','Getting Codex Inventory ready'),
      detail:message+desktopText('\n\n認証は同じWindowsユーザーのCodex CLIで行ってください。認証情報はこのEXEには含まれません。','\n\nAuthenticate Codex CLI as the same Windows user. This EXE contains no credentials.'),
      buttons:nativeLocale==='en'?['Retry','Select CLI','Installation help','Exit']:['再検出','CLIを手動選択','インストール手順','終了'],
      defaultId:0,cancelId:3,noLink:true
    });
    if(answer.response===3)return null;
    excluded=[];
    if(answer.response===1){
      const chosen=await pickCodex();
      if(chosen)preferred=chosen;
    }else if(answer.response===2){
      await shell.openExternal(INSTALL_HELP);
    }else{
      // Rerun discovery after a new CLI is installed or authenticated.
      preferred=(await settings()).codexPath||null;
    }
  }
  return null;
}

function openWindow(url){
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,respond)=>respond(false));
  mainWindow=new BrowserWindow({
    width:1390,height:880,minWidth:700,minHeight:520,
    backgroundColor:'#253028',title:'Codex Inventory',
    show:false,
    webPreferences:{
      preload:join(__dirname,'preload.cjs'),
      nodeIntegration:false,
      contextIsolation:true,
      // Keep App Server SSE callbacks responsive while the window is minimized.
      backgroundThrottling:false,
      sandbox:true,
      webSecurity:true,
      webviewTag:false,
      allowRunningInsecureContent:false,
    }
  });
  const allowedOrigin=new URL(url).origin;
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,target)=>{
    try{if(new URL(target).origin===allowedOrigin)return;}catch{}
    event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview',event=>event.preventDefault());
  mainWindow.once('ready-to-show',()=>mainWindow.show());
  mainWindow.on('closed',()=>{mainWindow=null;});
  mainWindow.loadURL(url).catch(error=>dialog.showErrorBox(desktopText('画面を開けません','Could not open the window'),error.message));
}

// Locale IPC accepts a fixed enum and only the application's own main frame.
ipcMain.handle('codex-inventory:language',async(event,language)=>{
  if(!mainWindow||!backend||event.sender!==mainWindow.webContents||
    event.senderFrame!==mainWindow.webContents.mainFrame||
    new URL(event.sender.getURL()).origin!==new URL(backend.url).origin)
    throw new Error('通知の送信元が正しくありません');
  if(language!=='ja'&&language!=='en')throw new Error('Unsupported language');
  nativeLocale=language;
  return {language};
});

// Only the currently loaded Inventory renderer may request a native toast.
// The renderer supplies a fixed outcome enum, never arbitrary text or paths.
ipcMain.handle('codex-inventory:turn-complete',async(event,status)=>{
  if(!mainWindow||!backend||event.sender!==mainWindow.webContents||
    event.senderFrame!==mainWindow.webContents.mainFrame||
    new URL(event.sender.getURL()).origin!==new URL(backend.url).origin)
    throw new Error('通知の送信元が正しくありません');
  if(!['completed','failed','interrupted'].includes(status))
    throw new Error('通知の状態が不正です');
  if(!Notification.isSupported())return {shown:false};
  const titles={
    completed:'Codexの処理が完了しました',
    failed:'Codexの実行に失敗しました',
    interrupted:'Codexの処理を中断しました'
  };
  if(nativeLocale==='en'){
    titles.completed='Codex completed';
    titles.failed='Codex execution failed';
    titles.interrupted='Codex was interrupted';
  }
  const toast=new Notification({
    title:titles[status],
    body:desktopText('Codex Inventoryで結果を確認してください。','Open Codex Inventory to review the result.'),
    silent:false
  });
  toast.on('click',()=>{
    if(!mainWindow||mainWindow.isDestroyed())return;
    if(mainWindow.isMinimized())mainWindow.restore();
    mainWindow.show();mainWindow.focus();
  });
  toast.show();
  return {shown:true};
});

// A permission request never includes its command, paths or privileges in the
// Windows toast. The user must open Inventory to inspect and approve it.
ipcMain.handle('codex-inventory:approval-needed',async event=>{
  if(!mainWindow||!backend||event.sender!==mainWindow.webContents||
    event.senderFrame!==mainWindow.webContents.mainFrame||
    new URL(event.sender.getURL()).origin!==new URL(backend.url).origin)
    throw new Error('通知の送信元が正しくありません');
  if(!Notification.isSupported())return {shown:false};
  const toast=new Notification({
    title:desktopText('Codexが許可を求めています','Codex needs approval'),
    body:desktopText('Codex Inventoryを開き、要求内容を確認してください。','Open Inventory to review the request.'),
    silent:false
  });
  toast.on('click',()=>{
    if(!mainWindow||mainWindow.isDestroyed())return;
    if(mainWindow.isMinimized())mainWindow.restore();
    mainWindow.show();mainWindow.focus();
  });
  toast.show();
  return {shown:true};
});

ipcMain.handle('codex-inventory:choose-project',async event=>{
  if(!mainWindow||event.sender!==mainWindow.webContents||!backend)
    throw new Error('フォルダーを選択する画面から実行してください');
  if(new URL(event.sender.getURL()).origin!==new URL(backend.url).origin)
    throw new Error('この画面からは実行できません');
  const selected=await dialog.showOpenDialog(mainWindow,{
    title:desktopText('Codex Inventoryに追加するプロジェクトのフォルダーを選択','Choose a project folder to add to Codex Inventory'),
    properties:['openDirectory','createDirectory']
  });
  if(selected.canceled||!selected.filePaths[0])return null;
  const registered=await backend.service.registerProject(selected.filePaths[0]);
  const known=[...backend.service.knownProjects];
  await saveSettings({knownProjects:known});
  return registered;
});

app.whenReady().then(async()=>{
  nativeLocale=app.getLocale().toLowerCase().startsWith('ja')?'ja':'en';
  if(!app.hasSingleInstanceLock())return;
  if(process.platform!=='win32'){
    dialog.showErrorBox(desktopText('対応OS','Unsupported OS'),desktopText('現在の配布版はWindows 11 x64向けです。','This release supports Windows 11 x64.'));
    app.quit();return;
  }
  app.setAppUserModelId(APP_ID);
  try{
    const modules=await packageModules();
    backend=await locateBackend(modules);
    if(!backend){app.quit();return;}
    // Distinguish missing login from a missing CLI; no auth file is read.
    let authStatus=null,authError=null;
    try{authStatus=await backend.client.request('account/read',{refreshToken:false},{timeoutMs:6500});}
    catch(error){authError=error.message;}
    if(!authStatus?.account){
      const response=await dialog.showMessageBox({
        type:'warning',title:desktopText('Codexログイン確認','Codex login status'),
        message:desktopText('Codex App Serverには接続しましたが、ログイン状態を確認できません','Connected to Codex App Server, but could not confirm your login'),
        detail:authError?
          desktopText('Codex CLIが古いか、アカウント情報が未取得です: ','Codex CLI may be outdated or account information is unavailable: ')+authError:
          desktopText('ご利用になるWindowsユーザーでCodexにログインしてください。認証情報をEXEに入力する必要はありません。','Log in to Codex as your Windows user. Do not enter credentials into this EXE.'),
        buttons:nativeLocale==='en'?['Open app','Codex installation/login help','Exit']:['画面を開く','Codex導入・ログイン手順','終了'],
        defaultId:0,cancelId:2,noLink:true
      });
      if(response.response===2){app.quit();return;}
      if(response.response===1)await shell.openExternal(INSTALL_HELP);
    }
    openWindow(backend.url);
  }catch(error){
    dialog.showErrorBox(desktopText('Codex Inventory起動失敗','Codex Inventory startup failed'),error.stack||error.message);
    app.quit();
  }
}).catch(error=>{dialog.showErrorBox(desktopText('起動失敗','Startup failed'),error.message);app.quit();});

app.on('before-quit',()=>{
  closing=true;
  if(backend){const toStop=backend;backend=null;void toStop.stop().catch(()=>{});}
});
app.on('window-all-closed',()=>app.quit());
