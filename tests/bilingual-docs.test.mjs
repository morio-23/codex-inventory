import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const pairs=[
  ['README.md','README.ja.md'],
  ['CONTRIBUTING.md','CONTRIBUTING.ja.md'],
  ['SECURITY.md','SECURITY.ja.md'],
  ['RELEASE_ACCEPTANCE.md','RELEASE_ACCEPTANCE.ja.md'],
  ['RELEASE_NOTES_TEMPLATE.md','RELEASE_NOTES_TEMPLATE.ja.md'],
];
const load=file=>readFile(join(root,file),'utf8');

test('all public documentation has reciprocal English and Japanese navigation',async()=>{
  for(const [english,japanese] of pairs){
    const [en,ja]=await Promise.all([load(english),load(japanese)]);
    assert.match(en,new RegExp('日本語.*'+japanese.replaceAll('.','\\.')+'\\)'));
    assert.match(ja,new RegExp('English.*'+english.replaceAll('.','\\.')+'\\)'));
    assert.ok(en.trim().length>200,english+' is incomplete');
    assert.ok(ja.trim().length>200,japanese+' is incomplete');
  }
});

test('both README editions document EXE distribution outside Git and required safety',async()=>{
  const [en,ja,ignore]=await Promise.all([load('README.md'),load('README.ja.md'),load('.gitignore')]);
  for(const [name,text] of [['English',en],['Japanese',ja]]){
    for(const literal of ['GitHub Releases','CodexInventory-Setup-0.6.0-x64.exe',
      'CodexInventory-Portable-0.6.0-x64.exe','SHA256SUMS.txt','120']){
      assert.ok(text.includes(literal),name+' README missing: '+literal);
    }
  }
  assert.match(ignore,/^dist\/\s*$/m,'EXE output must remain excluded from Git history');
});

test('acceptance guides agree on EXE types, test entrypoint and mock safety',async()=>{
  const [en,ja]=await Promise.all([load('RELEASE_ACCEPTANCE.md'),load('RELEASE_ACCEPTANCE.ja.md')]);
  for(const doc of [en,ja]){
    for(const literal of ['verify-release.ps1','CodexInventory-Setup-0.6.0-x64.exe',
      'CodexInventory-Portable-0.6.0-x64.exe','SHA256SUMS.txt','GitHub Releases']){
      assert.ok(doc.includes(literal),'release checklist missing: '+literal);
    }
  }
});

test('the canonical legal license remains the standard unmodified MIT text',async()=>{
  const license=await load('LICENSE');
  assert.ok(license.startsWith('MIT License'));
  assert.match(license,/THE SOFTWARE IS PROVIDED "AS IS"/);
});
