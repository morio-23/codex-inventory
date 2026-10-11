import test from 'node:test';
import assert from 'node:assert/strict';
import {executeBoundedProcess} from '../script-process.mjs';

test('bounded child returns stdout from an isolated harmless Node command',async()=>{
  const result=await executeBoundedProcess(process.execPath,['-e','process.stdout.write("PROCESS_OK")'],{
    cwd:process.cwd(),timeout:7000,maxBuffer:8192
  });
  assert.equal(result.stdout,'PROCESS_OK');
});
test('oversized stdout interrupts the process instead of returning unlimited data',async()=>{
  await assert.rejects(()=>executeBoundedProcess(process.execPath,[
    '-e','process.stdout.write("x".repeat(20000))'
  ],{cwd:process.cwd(),timeout:7000,maxBuffer:1000}),/出力が上限/);
});
test('deadline interrupts a long-running child process',async()=>{
  await assert.rejects(()=>executeBoundedProcess(process.execPath,[
    '-e','setInterval(()=>{},1000)'
  ],{cwd:process.cwd(),timeout:350,maxBuffer:8192}),/タイムアウト/);
});
test('abort signal cancels a long-running child',async()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),200);
  try {
    await assert.rejects(()=>executeBoundedProcess(process.execPath,[
      '-e','setInterval(()=>{},1000)'
    ],{cwd:process.cwd(),timeout:6000,maxBuffer:8192,signal:controller.signal}),/キャンセル/);
  }finally{clearTimeout(timer);}
});
