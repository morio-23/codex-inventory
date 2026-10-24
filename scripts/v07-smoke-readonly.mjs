import {spawnSync} from 'node:child_process';
import {lstatSync} from 'node:fs';
import {join,resolve,basename,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';

const expectedVersion='0.144.6';
const self=fileURLToPath(import.meta.url);
const environmentScript=fileURLToPath(new URL('./v07-smoke-environment.ps1',import.meta.url));

function stop(code){throw Object.assign(new Error(code),{code});}

// These exact public strings come from openai/codex rust-v0.144.6 app-server
// startup warnings. Do not inspect, print, hash, or persist the actual detail,
// path, range, or unknown summary: they may include local/private information.
// Classification is *not* permission to bypass a warning or continue the test.
const untrustedProjectPrefix='Project-local config, hooks, and exec policies are disabled in the following folders until the project is trusted, but skills still load.\n';
export function classifyStartupConfigWarning(params){
  const summary=params?.summary;
  if(typeof summary!=='string')return 'CONFIG_WARNING';
  switch(summary){
    case 'Invalid configuration; using defaults.':return 'CONFIG_INVALID_DEFAULTS';
    case 'Codex rebuilt its local database.':return 'CONFIG_SQLITE_RECOVERY';
    case 'Error parsing rules; custom rules not applied.':return 'CONFIG_EXEC_POLICY';
    default:
      return summary.startsWith(untrustedProjectPrefix)
        ? 'CONFIG_UNTRUSTED_PROJECT' : 'CONFIG_WARNING';
  }
}

/** Only request metadata from a newly empty synthetic Codex home. */
export async function readOnlyHandshake(client){
  let unexpectedCode;
  const flagNotification=notification=>{
    // Record only a fixed category; params may contain paths or account details.
    switch(notification?.method){
      case 'configWarning': unexpectedCode ??= classifyStartupConfigWarning(notification?.params);break;
      case 'warning': unexpectedCode ??= 'SERVER_WARNING';break;
      case 'account/updated': unexpectedCode ??= 'ACCOUNT_EVENT';break;
      case 'remoteControl/status/changed': unexpectedCode ??= 'REMOTE_CONTROL_STATUS';break;
      default: unexpectedCode ??= 'UNEXPECTED_EVENT';
    }
  };
  const flagWarning=()=>{unexpectedCode ??= 'CLIENT_WARNING';};
  client.on?.('notification',flagNotification);
  client.on?.('warning',flagWarning);
  try{
    await client.start();
    if(unexpectedCode)stop(unexpectedCode);
    const response=await client.request('thread/list',{});
    if(unexpectedCode)stop(unexpectedCode);
    if(!Array.isArray(response?.data))stop('MALFORMED_RESPONSE');
    if(response.data.length||response.nextCursor)stop('NONEMPTY_STATE');
    return 'EMPTY';
  }finally{
    client.off?.('notification',flagNotification);
    client.off?.('warning',flagWarning);
  }
}

function argumentsFrom(argv){
  if(!argv.includes('--approved-readonly-app-server'))stop('APPROVAL_REQUIRED');
  const rootIndex=argv.indexOf('--root'),cliIndex=argv.indexOf('--cli');
  if(rootIndex<0||cliIndex<0||!argv[rootIndex+1]||!argv[cliIndex+1]||
    argv[rootIndex+1].startsWith('--')||argv[cliIndex+1].startsWith('--'))
    stop('MISSING_ARGUMENT');
  return {root:argv[rootIndex+1],cli:argv[cliIndex+1]};
}

function isolatedEnvironment(root){
  const env={};
  for(const name of ['SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP',
    'USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA']){
    if(process.env[name])env[name]=process.env[name];
  }
  env.Path=process.env.Path||process.env.PATH||'';
  env.CODEX_HOME=join(root,'codex-home');
  env.CODEX_SQLITE_HOME=join(root,'codex-sqlite');
  return env;
}

function verifyPreparation(root){
  const checked=spawnSync('powershell.exe',[
    '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',environmentScript,
    '-Action','Verify','-Root',root
  ],{encoding:'utf8',windowsHide:true,timeout:15000,stdio:['ignore','pipe','pipe']});
  if(checked.status!==0)stop('PREPARATION_NOT_READY');
}

function numericVersion(cli,env,cwd){
  const checked=spawnSync(cli,['--version'],{
    cwd,env,encoding:'utf8',windowsHide:true,timeout:6500,
    stdio:['ignore','pipe','pipe']
  });
  const match=/^codex-cli\s+(\d+\.\d+\.\d+)\s*$/m.exec(checked.stdout||'');
  if(checked.status!==0||!match)stop('VERSION_UNAVAILABLE');
  if(match[1]!==expectedVersion)stop('VERSION_CHANGED');
  return match[1];
}

async function main(){
  let client;
  try{
    if(process.platform!=='win32')stop('WINDOWS_REQUIRED');
    const {root,cli}=argumentsFrom(process.argv.slice(2));
    if(!win32.isAbsolute(cli)||cli.startsWith('\\\\')||basename(cli).toLowerCase()!=='codex.exe')
      stop('CLI_PATH_REJECTED');
    const cliInfo=lstatSync(cli);
    if(!cliInfo.isFile()||cliInfo.isSymbolicLink())stop('CLI_PATH_REJECTED');
    verifyPreparation(root);
    const cwd=join(root,'workspace-a');
    const env=isolatedEnvironment(root);
    const version=numericVersion(cli,env,cwd);
    client=new AppServerClient({command:cli,args:['app-server'],cwd,env,timeoutMs:12000});
    await readOnlyHandshake(client);
    console.log(`READONLY_OK: initialize and empty thread/list; CLI ${version}.`);
  }catch(error){
    const known=new Set(['WINDOWS_REQUIRED','APPROVAL_REQUIRED','MISSING_ARGUMENT',
      'CLI_PATH_REJECTED','PREPARATION_NOT_READY','VERSION_UNAVAILABLE',
      'VERSION_CHANGED','MALFORMED_RESPONSE','NONEMPTY_STATE','UNEXPECTED_EVENT',
      'CONFIG_WARNING','CONFIG_INVALID_DEFAULTS','CONFIG_SQLITE_RECOVERY',
      'CONFIG_EXEC_POLICY','CONFIG_UNTRUSTED_PROJECT','SERVER_WARNING',
      'ACCOUNT_EVENT','REMOTE_CONTROL_STATUS','CLIENT_WARNING']);
    const category=known.has(error.code)?error.code:
      /timeout|タイムアウト/i.test(error.message||'')?'TIMEOUT':'RPC_OR_LAUNCH_ERROR';
    console.error(`READONLY_STOP: ${category}. No raw response was recorded.`);
    process.exitCode=2;
  }finally{
    client?.close();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===self)await main();
