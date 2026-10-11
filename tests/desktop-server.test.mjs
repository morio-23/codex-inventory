import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startInventoryServer} from '../server.mjs';

const mock=fileURLToPath(new URL('./fixtures/mock-app-server.mjs',import.meta.url));
test('Electron-facing server starts on a random loopback port with no initial project',async t=>{
  const server=await startInventoryServer({
    command:process.execPath,commandArgs:[mock],
    cwd:process.cwd(),selectedWorkspace:null,listenPort:0
  });
  t.after(async()=>server.stop());
  assert.ok(server.port>0);
  assert.ok(server.url.startsWith('http://127.0.0.1:'));
  const status=await (await fetch(server.url+'api/status')).json();
  assert.equal(status.connected,true);
  assert.equal(status.workspace,null);
  assert.equal(status.autoDiscover,true);
  const projectList=await (await fetch(server.url+'api/projects')).json();
  assert.deepEqual(projectList.projects,[]);
  const send=await fetch(server.url+'api/threads',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(server.url).origin},
    body:JSON.stringify({editing:false})
  });
  assert.equal(send.status,409);
});
test('packaged server always rejects forged web origins',async t=>{
  const server=await startInventoryServer({
    command:process.execPath,commandArgs:[mock],
    cwd:process.cwd(),listenPort:0
  });
  t.after(async()=>server.stop());
  const response=await fetch(server.url+'api/threads',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},
    body:JSON.stringify({editing:false})
  });
  assert.equal(response.status,403);
});
