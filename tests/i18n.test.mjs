import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {translateJapanese,preferredLanguage,normalizeLanguage,LANGUAGE_KEY} from '../public/i18n.js';
import englishTemplates from '../public/templates.en.js';
import {listPromptTemplates} from '../prompt-templates.mjs';

test('browser and persisted language settings select Japanese/English predictably',()=>{
  assert.equal(LANGUAGE_KEY,'codex-inventory:language');
  assert.equal(normalizeLanguage('ja-JP'),'ja');
  assert.equal(normalizeLanguage('en-US'),'en');
  assert.equal(preferredLanguage({languages:['ja-JP']}),'ja');
  assert.equal(preferredLanguage({languages:['en-US','ja-JP']}),'en');
  assert.equal(preferredLanguage({stored:'ja',languages:['en-US']}),'ja');
  assert.equal(preferredLanguage({stored:'en',languages:['ja-JP']}),'en');
  assert.equal(preferredLanguage({stored:'random',languages:['ja-JP']}),'ja');
});
test('static labels, approval choices and ticket quantities have safe English translations',()=>{
  assert.equal(translateJapanese('今回のみ許可'),'Allow once');
  assert.equal(translateJapanese('セッション中許可'),'Allow for session');
  assert.equal(translateJapanese('拒否'),'Decline');
  assert.equal(translateJapanese('Codexのリセットチケット'),'Codex reset ticket');
  assert.equal(translateJapanese('2枚'),'2 tickets');
  assert.equal(translateJapanese('10番 未取得。クリックして選択'),'Slot 10: Unavailable. Click to select');
  assert.equal(translateJapanese('任務の内容'),'Quest prompt');
  assert.equal(translateJapanese('CODEx_CUSTOM_ユーザー_FILE'),'CODEx_CUSTOM_ユーザー_FILE');
});
test('all English built-in templates retain exact IDs and variable placeholders',()=>{
  const base=listPromptTemplates();
  assert.equal(base.length,16);
  assert.deepEqual(Object.keys(englishTemplates).sort(),base.map(x=>x.id).sort());
  for(const item of base){
    const localized=englishTemplates[item.id];
    assert.ok(localized.title&&localized.description&&localized.body,item.id);
    const vars=text=>[...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map(x=>x[1]))].sort();
    assert.deepEqual(vars(localized.body),vars(item.body),item.id+' variable mismatch');
    assert.doesNotMatch(localized.body,/[\u3040-\u30ff\u3400-\u9fff]/,item.id+' body is not translated');
  }
});
test('UI translation files are explicitly served but other assets remain allowlisted',async()=>{
  const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  for(const path of ['/i18n.js','/strings.en.js','/templates.en.js']){
    assert.ok(source.includes("'"+path+"'"),path);
  }
});
test('language selector does not turn a persistent category or template ID into a localized key',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const state=await readFile(new URL('../public/inventory-state.js',import.meta.url),'utf8');
  assert.match(html,/id="ui-language"/);
  assert.match(app,/setupLanguage/);
  assert.match(app,/originalBuiltinTemplates/);
  assert.match(state,/categories=\['ローカル','Git','プロジェクト','Codex','テンプレート'\]/);
});
