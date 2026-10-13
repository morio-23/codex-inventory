import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {AppServerClient} from '../app-server-client.mjs';
import {readOnlyHandshake} from '../scripts/v07-smoke-readonly.mjs';

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
