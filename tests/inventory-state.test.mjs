import test from 'node:test';
import assert from 'node:assert/strict';
import {storageKey,initialState,loadState,saveState,validateTemplate,mergedTemplates,parseTemplateImport,exportTemplateJson} from '../public/inventory-state.js';

function memoryStorage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};}
const builtins=[{id:'repo-map',title:'標準',description:'説明',category:'調査',body:'調べる {goal}',source:'builtin'}];
test('hotbar and template data persist per workspace with normalized Windows paths',()=>{
  const storage=memoryStorage();const state=initialState();
  state.hotbar[0]='repo-map';state.overrides['repo-map']={title:'編集済み',description:'説明',body:'目標 {goal}'};
  state.userTemplates.push(validateTemplate({id:'user-demo',title:'独自',category:'調査',body:'見る {file}'}));
  saveState(storage,'F:\\Repo\\',state);
  assert.equal(storageKey('F:\\Repo\\'),storageKey('f:/repo'));
  const restored=loadState(storage,'f:/repo',builtins);
  assert.equal(restored.hotbar[0],'repo-map');
  assert.equal(mergedTemplates(builtins,restored)[0].title,'編集済み');
  assert.deepEqual(mergedTemplates(builtins,restored)[1].variables,['file']);
  assert.equal(loadState(storage,'f:/other',builtins).userTemplates.length,0);
});
test('template import validates format, size and ID collisions',()=>{
  const state=initialState();state.userTemplates.push(validateTemplate({id:'user-one',title:'一',category:'調査',body:'本文'}));
  assert.equal(parseTemplateImport(exportTemplateJson(state),builtins).length,1);
  assert.throws(()=>parseTemplateImport('{bad',builtins),/JSON/);
  assert.throws(()=>parseTemplateImport(JSON.stringify({version:1,templates:[{id:'repo-map',title:'衝突',category:'調査',body:'本文'}]}),builtins),/ID/);
  assert.throws(()=>validateTemplate({id:'user-x',title:'',category:'調査',body:'本文'}),/タイトル/);
});
