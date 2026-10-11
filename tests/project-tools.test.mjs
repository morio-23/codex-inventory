import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProjectTool,previewProjectCommand} from '../project-tools.mjs';

async function workspace(t){
  const root=await mkdtemp(join(tmpdir(),'inventory-project-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'src'));
  await writeFile(join(root,'README.md'),'日本語の概要');
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'node --test',lint:'node --check src/main.js'},dependencies:{alpha:'^1.0.0'}}));
  await writeFile(join(root,'src','main.js'),'// TODO: 日本語の修正\nexport const text="needle";');
  await writeFile(join(root,'.env'),'PRIVATE_TOKEN=needle');
  return root;
}
test('safe project tools scan files with a bounded internal search fallback',async t=>{
  const root=await workspace(t);
  const executor=async()=>{throw Object.assign(new Error('missing rg'),{code:'ENOENT'});};
  const search=await runProjectTool('code-search',{workspace:root,input:{query:'needle'},executor});
  assert.match(search.sections[0].output,/src\/main.js:2/);
  assert.doesNotMatch(search.sections[0].output,/PRIVATE_TOKEN/);
  assert.equal(search.codexTurnStarted,false);
  const todos=await runProjectTool('todo-scan',{workspace:root});
  assert.match(todos.sections[0].output,/TODO: 日本語/);
  const tree=await runProjectTool('project-tree',{workspace:root});
  assert.match(tree.sections[0].output,/src\/main.js/);
  assert.doesNotMatch(tree.sections[0].output,/\.env/);
  const preview=await runProjectTool('project-preview',{workspace:root});
  assert.match(preview.sections[0].output,/日本語の概要/);
  const deps=await runProjectTool('dependencies',{workspace:root});
  assert.match(deps.sections[0].output,/alpha: \^1.0.0/);
  const diagnostic=await runProjectTool('project-diagnostics',{workspace:root});
  assert.match(diagnostic.sections[0].output,/JSON正常/);
});
test('symlinks and unapproved test commands are blocked',async t=>{
  const root=await workspace(t);
  const outside=await mkdtemp(join(tmpdir(),'inventory-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'secret.js'),'const PRIVATE_TOKEN="needle"');
  try{await symlink(join(outside,'secret.js'),join(root,'src','linked.js'));}catch(error){if(process.platform!=='win32')throw error;}
  const executor=async()=>{throw Object.assign(new Error('missing rg'),{code:'ENOENT'});};
  const result=await runProjectTool('code-search',{workspace:root,input:{query:'needle'},executor});
  assert.doesNotMatch(result.sections[0].output,/PRIVATE_TOKEN/);
  await assert.rejects(()=>runProjectTool('code-search',{workspace:root,input:{query:'x'}}),/2～80/);
  await assert.rejects(()=>runProjectTool('project-test',{workspace:root}),/承認/);
  const preview=await previewProjectCommand('project-test',root);
  assert.equal(preview.command,'npm run test');
  assert.equal(preview.script,'node --test');
  await assert.rejects(()=>runProjectTool('project-tree',{workspace:root,input:{path:'../outside'}}),/パラメータ/);
  let command;
  const approval={id:'project-test',workspace:preview.workspace,manifestHash:preview.manifestHash};
  await assert.rejects(()=>runProjectTool('project-test',{workspace:root,input:{approvalToken:'forged'}}),/承認/);
  await runProjectTool('project-test',{workspace:root,input:{approvalToken:'server-validated'},approval,executor:async(cmd,args,options)=>{
    command={cmd,args,options};return {stdout:'tests passed'};
  }});
  if(process.platform==='win32'){
    assert.equal(command.cmd,'cmd.exe');
    assert.deepEqual(command.args,['/d','/s','/c','npm run test']);
  }else{
    assert.equal(command.cmd,'npm');
    assert.deepEqual(command.args,['run','test']);
  }
  assert.equal(command.options.shell,false);
  assert.equal(command.options.cwd,await realpath(root));
});

test('npm preview includes lifecycle hooks and changes invalidate approval',async t=>{
  const root=await workspace(t);
  const manifest=join(root,'package.json');
  await writeFile(manifest,JSON.stringify({scripts:{
    pretest:'echo SETUP',test:'node --test',posttest:'echo CLEANUP'
  }}));
  const preview=await previewProjectCommand('project-test',root);
  assert.deepEqual(preview.steps.map(x=>x.name),['pretest','test','posttest']);
  assert.match(preview.warning,/外部通信/);
  const approval={id:'project-test',workspace:preview.workspace,manifestHash:preview.manifestHash};
  await writeFile(manifest,JSON.stringify({scripts:{pretest:'echo MALICIOUS',test:'node --test',posttest:'echo CLEANUP'}}));
  let invoked=false;
  await assert.rejects(()=>runProjectTool('project-test',{workspace:root,input:{approvalToken:'validated'},approval,executor:async()=>{invoked=true;return {stdout:'bad'};}}),/変更されました/);
  assert.equal(invoked,false);
});
