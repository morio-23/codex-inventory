import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('GitHub Actions do not run automatically for commits or PRs',async()=>{
  const yml=await read('.github/workflows/ci.yml');
  assert.match(yml,/^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(yml,/^\s*push:\s*$/m);
  assert.doesNotMatch(yml,/^\s*pull_request:\s*$/m);
});
test('public source and binary/release evidence are kept separate',async()=>{
  const ignore=await read('.gitignore');
  for(const rule of ['dist/','release-evidence/','.codex/','*.pfx','*.exe']){
    assert.ok(ignore.split(/\r?\n/).includes(rule),rule+' is not ignored');
  }
  const [en,ja]=await Promise.all([
    read('PUBLICATION_CHECKLIST.md'),read('PUBLICATION_CHECKLIST.ja.md')
  ]);
  assert.ok(en.includes('[日本語](PUBLICATION_CHECKLIST.ja.md)'));
  assert.ok(ja.includes('[English](PUBLICATION_CHECKLIST.md)'));
  for(const text of [en,ja]){
    for(const command of ['npm ci','npm run check','npm test','npm run test:e2e']){
      assert.ok(text.includes(command),'missing local test command: '+command);
    }
    assert.ok(text.includes('EXE'));
    assert.ok(text.includes('GitHub'));
  }
});
test('public source audit does not print credential values',async()=>{
  const script=await read('scripts/audit-public-source.ps1');
  assert.match(script,/git grep -l -I -E/);
  assert.match(script,/git log @refs/);
  assert.doesNotMatch(script,/git log @refs -p/);
  assert.match(script,/Git history/);
});
