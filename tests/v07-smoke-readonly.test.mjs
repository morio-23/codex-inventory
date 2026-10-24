import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {readOnlyHandshake,classifyStartupConfigWarning,isolatedEnvironment} from '../scripts/v07-smoke-readonly.mjs';

const fixture=fileURLToPath(new URL('./fixtures/mock-app-server.mjs',import.meta.url));
const script=fileURLToPath(new URL('../scripts/v07-smoke-readonly.mjs',import.meta.url));

test('real connection launcher refuses to run without the explicit stage-one flag',
  {skip:process.platform!=='win32'},()=>{
  const attempted=spawnSync(process.execPath,[script,'--root','synthetic-root',
    '--cli','synthetic-codex.exe'],{encoding:'utf8',timeout:5000});
  assert.notEqual(attempted.status,0);
  assert.match(attempted.stderr,/READONLY_STOP: APPROVAL_REQUIRED/);
  assert.doesNotMatch(attempted.stdout+attempted.stderr,/synthetic-root|synthetic-codex/);
  });

test('real connection launcher reports a missing CLI value before inspecting it',
  {skip:process.platform!=='win32'},()=>{
  const attempted=spawnSync(process.execPath,[script,'--root','synthetic-root',
    '--cli','--approved-readonly-app-server'],{encoding:'utf8',timeout:5000});
  assert.notEqual(attempted.status,0);
  assert.match(attempted.stderr,/READONLY_STOP: MISSING_ARGUMENT/);
  assert.doesNotMatch(attempted.stdout+attempted.stderr,/synthetic-root/);
  });

test('read-only smoke handshake uses only the empty synthetic thread list',async t=>{
  const client=new AppServerClient({command:process.execPath,args:[fixture],timeoutMs:5000});
  t.after(()=>client.close());
  const calls=[];
  const request=client.request.bind(client);
  client.request=(method,params,options)=>{calls.push(method);return request(method,params,options);};
  assert.equal(await readOnlyHandshake(client),'EMPTY');
  assert.deepEqual(calls,['initialize','thread/list']);
});

test('read-only smoke handshake stops without exposing an unexpected thread id',async()=>{
  const fake={start:async()=>{},request:async()=>({data:[{id:'synthetic-private-id'}]})};
  await assert.rejects(()=>readOnlyHandshake(fake),error=>
    error.code==='NONEMPTY_STATE'&&!error.message.includes('synthetic-private-id'));
});

test('read-only smoke handshake rejects an unexpected additional history page',async()=>{
  const fake={start:async()=>{},request:async()=>({data:[],nextCursor:'synthetic-cursor'})};
  await assert.rejects(()=>readOnlyHandshake(fake),{code:'NONEMPTY_STATE'});
});

test('read-only smoke handshake stops on an unexpected server notification',async()=>{
  const fake=new EventEmitter();
  fake.start=async()=>fake.emit('notification',{method:'synthetic/auth-required'});
  fake.request=async()=>({data:[]});
  await assert.rejects(()=>readOnlyHandshake(fake),{code:'UNEXPECTED_EVENT'});
});

test('read-only smoke handshake classifies known startup warnings without their contents',async()=>{
  const fake=new EventEmitter();
  fake.start=async()=>fake.emit('notification',{
    method:'configWarning',params:{details:'synthetic-secret-path'}
  });
  fake.request=async()=>({data:[]});
  await assert.rejects(()=>readOnlyHandshake(fake),error=>
    error.code==='CONFIG_WARNING'&&!error.message.includes('synthetic-secret-path'));
});

test('read-only smoke handshake classifies client warnings without their contents',async()=>{
  const fake=new EventEmitter();
  fake.start=async()=>fake.emit('warning','synthetic-secret-path');
  fake.request=async()=>({data:[]});
  await assert.rejects(()=>readOnlyHandshake(fake),error=>
    error.code==='CLIENT_WARNING'&&!error.message.includes('synthetic-secret-path'));
});

test('public v0.144.6 config warning categories use exact known summaries only',()=>{
  const samples=[
    ['Invalid configuration; using defaults.','CONFIG_INVALID_DEFAULTS'],
    ['Codex rebuilt its local database.','CONFIG_SQLITE_RECOVERY'],
    ['Error parsing rules; custom rules not applied.','CONFIG_EXEC_POLICY'],
    ['Project-local config, hooks, and exec policies are disabled in the following folders until the project is trusted, but skills still load.\n    1. SYNTHETIC_TEST_FOLDER','CONFIG_UNTRUSTED_PROJECT'],
    ['Unrecognized warning for SYNTHETIC_TEST_FOLDER','CONFIG_WARNING'],
    ['Invalid configuration; using defaults. additional text','CONFIG_WARNING'],
  ];
  for(const [summary,expected] of samples){
    assert.equal(classifyStartupConfigWarning({
      summary,details:'SYNTHETIC_PRIVATE_DETAILS',path:'SYNTHETIC_PRIVATE_PATH',
      range:{start:{line:1,column:1},end:{line:1,column:2}}
    }),expected);
  }
  assert.equal(classifyStartupConfigWarning(null),'CONFIG_WARNING');
  assert.equal(classifyStartupConfigWarning({details:'SYNTHETIC_PRIVATE_DETAILS'}),'CONFIG_WARNING');
});

test('classified warnings stop before listing threads and never echo private warning fields',async()=>{
  const fake=new EventEmitter();
  fake.start=async()=>fake.emit('notification',{
    method:'configWarning',
    params:{summary:'Invalid configuration; using defaults.',
      details:'SYNTHETIC_PRIVATE_DETAILS',path:'SYNTHETIC_PRIVATE_PATH'}
  });
  fake.request=async()=>{throw new Error('UNSAFE_THREAD_LIST_ATTEMPT');};
  await assert.rejects(()=>readOnlyHandshake(fake),error=>
    error.code==='CONFIG_INVALID_DEFAULTS'&&
    !error.message.includes('SYNTHETIC_PRIVATE_DETAILS')&&
    !error.message.includes('SYNTHETIC_PRIVATE_PATH'));
});

test('host read-only App Server child gets only synthetic profile directories',()=>{
  const root='synthetic-test-root';
  const env=isolatedEnvironment(root);
  for(const key of ['HOME','USERPROFILE']){
    assert.ok(env[key].includes('profile'));
    assert.ok(env[key].includes(root));
  }
  for(const key of ['APPDATA','LOCALAPPDATA','PROGRAMDATA','TEMP','TMP','CODEX_HOME','CODEX_SQLITE_HOME']){
    assert.ok(env[key].includes(root),key+' must stay synthetic');
  }
  for(const sensitive of ['OPENAI_API_KEY','CODEX_API_KEY','GITHUB_TOKEN','HTTPS_PROXY',
    'HTTP_PROXY','ALL_PROXY','USERDOMAIN','ONEDRIVE','APPDATA_ORIGINAL']){
    assert.equal(Object.hasOwn(env,sensitive),false,sensitive+' was inherited');
  }
  if(process.platform==='win32'){
    for(const key of ['APPDATA','LOCALAPPDATA','PROGRAMDATA','TEMP','TMP']){
      assert.notEqual(env[key],process.env[key],key+' must not point at host profile');
    }
    assert.notEqual(env.Path,process.env.Path);
  }
});
