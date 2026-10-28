import {test,expect} from '@playwright/test';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startInventoryServer} from '../../server.mjs';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));return port;
}
async function launch(port,extra={}){
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),CODEX_WORKSPACE:root,CODEX_DEMO:'1',...extra},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const url=`http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error(`Inventory exited: ${child.exitCode}`);
    try{const response=await fetch(url+'/');if(response.ok)return {child,url};}catch{}
    await pause(50);
  }
  child.kill();throw Error('Inventory did not listen');
}
async function stop(child){
  if(child.exitCode!==null)return;
  if(child.connected)child.send('shutdown');
  await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);
  if(child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),pause(3000)]);}
}
async function sandbox(){
  const port=await freePort();const directory=await mkdtemp(join(tmpdir(),'codex-inventory-e2e-'));
  const store=join(directory,'threads.json');let current;
  return {port,store,directory,
    async start(extra={}){current=await launch(port,{MOCK_STORE_FILE:store,...extra});return current;},
    async restart(extra={}){if(current)await stop(current.child);current=await launch(port,{MOCK_STORE_FILE:store,...extra});return current;},
    async close(){if(current)await stop(current.child);if(directory.startsWith(tmpdir()))await rm(directory,{recursive:true,force:true});}
  };
}
let box;
test.afterEach(async()=>{if(box)await box.close();box=null;});
function browserErrors(page){
  const consoleErrors=[];const httpErrors=[];
  page.on('pageerror',e=>consoleErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.status()>=500)httpErrors.push(`${r.status()} ${r.url()}`);});
  return {consoleErrors,httpErrors};
}
async function createChat(page){
  const created=page.waitForResponse(r=>r.url().endsWith('/api/threads')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'＋ 新しいチャット'}).click();
  const response=await created;
  expect(response.status(),await response.text()).toBe(201);
  const id=(await response.json()).thread.id;
  await expect(page.locator('#active-thread')).toHaveText(/^(?:チャット|Chat )\d+$/);
  await expect(page.locator(`.thread-item[data-thread-id="${id}"]`)).toBeVisible();
  return id;
}
async function runPrompt(page,prompt){
  await page.locator('#prompt').fill(prompt);
  await page.locator('#run').click();
}
async function expectAnswer(page,text){
  await expect(page.locator('#log .answer').filter({hasText:text}).first()).toBeVisible({timeout:120000});
}
async function openTools(page){
  if(await page.locator('#utility-tools-pane').isHidden())await page.locator('#open-local-tools').click();
  await expect(page.locator('#utility-tools-pane')).toBeVisible();
}
async function openTemplates(page){
  if(await page.locator('#utility-templates-pane').isHidden())await page.locator('#open-templates').click();
  await expect(page.locator('#utility-templates-pane')).toBeVisible();
}
async function untranslatedChrome(page){
  return page.evaluate(()=>{
    const ignored='#ui-language,#reset-credit-choice,#reset-credit-review-details,.thread-item,.thread-name,#log .log-content,#log .command-preview,#log .command-full,#prompt,#template-variables,#local-result-text,[data-i18n-ignore]';
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const rows=[];
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      const parent=node.parentElement;
      if(!parent||parent.closest(ignored)||!parent.getClientRects().length)continue;
      const value=node.nodeValue.trim();
      if(/[\u3040-\u30ff\u3400-\u9fff]/u.test(value))rows.push(value);
    }
    for(const element of document.querySelectorAll('[title],[aria-label],[placeholder],select')){
      if((element.closest(ignored)&&element.id!=='prompt')||!element.getClientRects().length)continue;
      for(const attr of ['title','aria-label','placeholder']){
        const value=element.getAttribute(attr);
        if(value&&/[\u3040-\u30ff\u3400-\u9fff]/u.test(value))rows.push('@'+attr+': '+value);
      }
      if(element.matches('select')){
        for(const option of element.querySelectorAll('option,optgroup')){
          const value=option.label||option.textContent;
          if(!option.closest(ignored)&&/[\u3040-\u30ff\u3400-\u9fff]/u.test(value))rows.push('@option: '+value);
        }
      }
    }
    return rows;
  });
}

test('English auto-detection, reversible language switch, saved preference, ticket safety and templates',async({browser})=>{
  // This test deliberately visits every inventory card and tooltip, exercises
  // four viewport widths and verifies mock ticket/locale/template flows.
  // Give only this comprehensive test a longer budget, not the whole suite.
  test.setTimeout(120_000);
  box=await sandbox();
  const {url}=await box.start({MOCK_RESET_CREDITS:'1'});
  const context=await browser.newContext({locale:'en-US'});
  const english=await context.newPage();
  try{
    await english.goto(url);
    await expect(english.locator('#connection')).toHaveText('APP SERVER READY');
    await expect(english.locator('#ui-language')).toHaveValue('en');
    await expect(english.locator('html')).toHaveAttribute('lang','en');
    await expect(english.locator('#new-thread')).toHaveText('+ New chat');
    await expect(english.locator('#prompt')).toHaveAttribute('placeholder','Example: Review this app and suggest improvements');
    await expect(english.locator('#local-query')).toHaveAttribute('placeholder','At least two characters');
    await english.locator('#prompt').evaluate(element=>element.setAttribute('placeholder','未翻訳プレースホルダー'));
    expect(await untranslatedChrome(english)).toContain('@placeholder: 未翻訳プレースホルダー');
    await english.locator('#prompt').evaluate(element=>element.setAttribute('placeholder','Example: Review this app and suggest improvements'));
    const residuals={initial:await untranslatedChrome(english)};
    await test.step('English inventory and tooltip localization sweep',async()=>{
      const categories=await english.locator('#catalog-categories button')
        .evaluateAll(nodes=>nodes.map(node=>node.dataset.category));
      for(const category of categories){
        await test.step('Audit catalog '+category,async()=>{
          await english.locator(`#catalog-categories [data-category="${category}"]`).click();
          // Bound pagination to report a precise failure if the last page
          // cannot be reached; do not hide loops behind a bigger timeout.
          for(let pageIndex=0;pageIndex<20;pageIndex++){
            const ids=await english.locator('#slots [data-item]')
              .evaluateAll(nodes=>nodes.map(node=>node.dataset.item));
            for(const id of ids){
              const slot=english.locator(`#slots [data-item="${id}"]`);
              await slot.click();
              residuals['item-'+id]=await untranslatedChrome(english);
              await slot.hover();
              residuals['tooltip-'+id]=await untranslatedChrome(english);
              await english.mouse.move(0,0);
            }
            if(await english.locator('#catalog-next').isDisabled())return;
            await english.locator('#catalog-next').click();
          }
          throw new Error('E2E_CATALOG_PAGINATION_DID_NOT_TERMINATE');
        });
      }
    });
    const ticket=english.locator('#featured-item [data-item="reset-credit"]');
    await expect(ticket.locator('.slot-label')).toHaveText('Codex reset ticket');
    await expect(ticket.locator('.reset-ticket-count')).toHaveText('2 tickets');
    for(const width of [390,768,1366,1680]){
      await english.setViewportSize({width,height:850});
      expect(await english.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),
        'English UI horizontal overflow at '+width).toBeLessThanOrEqual(1);
    }
    await ticket.click();
    await expect(english.locator('#item-title')).toHaveText('Codex reset ticket');
    await english.locator('#run').click();
    await expect(english.locator('#reset-credit-dialog')).toBeVisible();
    await expect(english.locator('#reset-credit-review')).toHaveText('Review ticket redemption');
    await expect(english.locator('#reset-credit-consent')).not.toBeChecked();
    await expect(english.locator('#reset-credit-confirm')).toBeDisabled();
    await expect(english.locator('#reset-credit-choice option').first()).toContainText('Expires');
    residuals.ticket=await untranslatedChrome(english);
    await english.locator('#reset-credit-review').click();
    await expect(english.locator('#reset-credit-review-panel')).toBeVisible();
    await expect(english.locator('#reset-credit-review-details')).toContainText('5 hours:');
    await expect(english.locator('#reset-credit-review-details')).toContainText('Weekly:');
    residuals.ticketReview=await untranslatedChrome(english);
    await english.locator('#reset-credit-close').click();
    expect((await (await english.request.get(url+'/api/usage')).json()).resetCreditTickets.availableCount).toBe(2);
    await english.locator('#catalog-categories [data-category="Codex"]').click();
    await english.locator('#slots [data-item="quest"]').click();
    await english.locator('#new-thread').click();
    await expect(english.locator('#active-thread')).toHaveText(/^Chat \d+$/);
    residuals.chat=await untranslatedChrome(english);
    await runPrompt(english,'Preserve this user text: 日本語_OWNED_CONTENT');
    await expect(english.locator('#log .user-message')).toContainText('日本語_OWNED_CONTENT');

    // The language switch must not rewrite user-authored prompts.
    await english.locator('#prompt').fill('Do not translate my 日本語 text.');
    await english.locator('#ui-language').selectOption('ja');
    await expect(english.locator('#new-thread')).toHaveText('＋ 新しいチャット');
    await expect(english.locator('#featured-item .slot-label')).toHaveText('Codexのリセットチケット');
    await expect(english.locator('#prompt')).toHaveValue('Do not translate my 日本語 text.');
    await english.reload();
    await expect(english.locator('#ui-language')).toHaveValue('ja');
    await english.locator('#ui-language').selectOption('en');
    await expect(english.locator('#new-thread')).toHaveText('+ New chat');
    await english.locator('#open-templates').click();
    await english.locator('#template-select').selectOption('repo-map');
    await expect(english.locator('#template-body')).toHaveValue(/Map the main directories/);
    residuals.templates=await untranslatedChrome(english);
    await english.locator('#ui-language').selectOption('ja');
    await expect(english.locator('#template-body')).toHaveValue(/対象リポジトリの主要ディレクトリ/);
    await english.locator('#template-body').fill('USER OWNED DRAFT / 手入力');
    await english.locator('#ui-language').selectOption('en');
    await expect(english.locator('#template-body')).toHaveValue('USER OWNED DRAFT / 手入力');
    await english.locator('#open-local-tools').click();
    residuals.tools=await untranslatedChrome(english);
    await english.locator('#local-git-status').click();
    await expect(english.locator('#local-results')).toBeVisible();
    residuals.localResult=await untranslatedChrome(english);
    await english.route('**/api/models',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"mock model failure"}'}));
    await english.locator('#model-refresh').click();
    await expect(english.locator('#model-hint')).toContainText('Model fetch failed');
    residuals.modelError=await untranslatedChrome(english);
    await english.route('**/api/usage',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"mock usage failure"}'}));
    await english.locator('#ui-language').selectOption('ja');
    await english.locator('#ui-language').selectOption('en');
    await expect(english.locator('#quota-primary .quota-head span')).toHaveText('Short-term quota');
    await expect(english.locator('#quota-secondary .quota-head span')).toHaveText('Long-term quota');
    residuals.usageError=await untranslatedChrome(english);
    expect(residuals).toEqual(Object.fromEntries(Object.keys(residuals).map(key=>[key,[]])));
  }finally{
    await context.close();
  }
});

test('user template text remains verbatim in tooltip and hotbar across language changes',async({browser})=>{
  box=await sandbox();const {url}=await box.start();
  const context=await browser.newContext({locale:'en-US'});
  const page=await context.newPage();
  try{
    await page.goto(url);
    await openTemplates(page);
    await page.locator('#template-new').click();
    await page.locator('#template-title').fill('テスト実行');
    await page.locator('#template-description-edit').fill('テスト実行');
    await page.locator('#template-body').fill('Do this');
    await page.locator('#template-save').click();
    const id=await page.locator('#template-select').inputValue();
    await page.locator('#catalog-categories [data-category="テンプレート"]').click();
    const slot=page.locator(`#slots [data-item="${id}"]`);
    for(let pageIndex=0;pageIndex<10&&await slot.count()===0;pageIndex++)await page.locator('#catalog-next').click();
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('aria-label','テスト実行');
    await slot.click();
    await page.locator('#hotbar-add').click();
    const hotbar=page.locator(`#hotbar [data-item="${id}"]`);
    for(const language of ['en','ja','en']){
      await page.locator('#ui-language').selectOption(language);
      await slot.hover();
      await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
      await expect(page.locator('#tooltip b')).toHaveText('テスト実行');
      await expect(page.locator('#tooltip p')).toHaveText('テスト実行');
      await expect(page.locator('#tooltip small')).toContainText('テスト実行');
      await expect(slot).toHaveAttribute('aria-label','テスト実行');
      await expect(hotbar).toHaveAttribute('aria-label',language==='en'?'Slot 1: テスト実行. Click to select':'1番 テスト実行。クリックして選択');
      await page.mouse.move(0,0);
    }
  }finally{await context.close();}
});

test('English approval UI shows explicit safe choices and can decline without auto-approval',async({browser})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_KIND:'command'});
  const context=await browser.newContext({locale:'en-US'});
  const page=await context.newPage();
  try{
    await page.goto(url);
    await expect(page.locator('#new-thread')).toHaveText('+ New chat');
    await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
    const created=page.waitForResponse(r=>r.url().endsWith('/api/threads')&&r.request().method()==='POST');
    await page.locator('#new-thread').click();
    const thread=(await (await created).json()).thread.id;
    await expect(page.locator('#active-thread')).toHaveText(/^Chat \d+$/);
    await runPrompt(page,'Run a harmless test command; request permission first.');
    await expect(page.locator('#codex-approval-panel')).toBeVisible({timeout:15000});
    const panel=page.locator('#codex-approval-panel');
    await expect(panel.getByRole('button',{name:'Allow once'})).toBeVisible();
    await expect(panel.getByRole('button',{name:'Allow for session'})).toBeVisible();
    expect(await untranslatedChrome(page)).toEqual([]);
    await panel.getByRole('button',{name:'Decline'}).click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#stop')).toBeDisabled({timeout:30000});
    expect(await untranslatedChrome(page)).toEqual([]);
  }finally{await context.close();}
});

test('two chats run, switch, interrupt, resume, and survive process restart',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_TURN_DELAY_MS:'8000'});const errors=browserErrors(page);
  await page.goto(url);await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#quota-primary')).toContainText('72% 残り');
  await expect(page.locator('#quota-secondary')).toContainText('53% 残り');
  await expect(page.locator('#quota-primary .quota-head span')).toHaveText('5時間');
  await expect(page.locator('#quota-secondary .quota-head span')).toHaveText('週間');
  await expect(page.locator('#quota-primary')).not.toContainText('300分枠');
  await expect(page.locator('#quota-secondary')).not.toContainText('10080分枠');
  const first=await createChat(page);await runPrompt(page,'E2E alpha');
  await expect(page.locator('#stop')).toBeEnabled();
  const second=await createChat(page);await runPrompt(page,'E2E beta');
  await expect(page.locator('.thread-item')).toHaveCount(2);
  await expect(page.locator('.thread-item:has-text("実行中")')).toHaveCount(2);
  const duplicate=await page.request.post(`${url}/api/threads/${second}/turn`,{data:{prompt:'duplicate',action:'quest',editing:false}});
  expect(duplicate.status()).toBe(409);
  await page.locator('#stop').click();
  await expect(page.locator('#stop')).toBeDisabled({timeout:60000});
  await page.locator(`.thread-item[data-thread-id="${first}"]`).click();
  await expect(page.locator('#log')).toContainText('E2E alpha');
  await expect(page.locator('#usage')).toContainText('246 TOKENS');
  await page.locator(`.thread-item[data-thread-id="${second}"]`).click();
  await expect(page.locator('#usage')).toHaveText('TOKEN数 未取得');
  await runPrompt(page,'E2E beta resumed');
  await expect(page.locator('#log')).toContainText('E2E beta resumed');
  await page.reload();
  await expect(page.locator('#log')).toContainText('E2E beta resumed');
  await page.goto('about:blank');
  await box.restart();await page.goto(url);
  await expect(page.locator('.thread-item')).toHaveCount(2);
  await expect(page.locator('#log')).toContainText('E2E beta resumed');
  await page.locator(`.thread-item[data-thread-id="${first}"]`).click();
  await expect(page.locator('#log')).toContainText('E2E alpha');
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.httpErrors).toEqual([]);
});

test('reload restores the selected chat even when it is not first in the list',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.goto(url);await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await createChat(page);
  await createChat(page);
  const listed=await page.locator('.thread-item').evaluateAll(items=>items.map(item=>item.dataset.threadId));
  expect(listed).toHaveLength(2);
  const selected=listed[1];
  await page.locator(`.thread-item[data-thread-id="${selected}"]`).click();
  const selectedRow=page.locator(`.thread-item[data-thread-id="${selected}"]`);
  await expect(page.locator('#active-thread')).toHaveText(/^チャット\d+$/);
  await page.reload();
  await expect(selectedRow).toHaveClass(/chosen/);
  await expect(page.locator('#active-thread')).toHaveText(await selectedRow.locator('.thread-name').textContent());
  await page.goto('about:blank');
  await box.restart();
  await page.goto(url);
  await expect(selectedRow).toHaveClass(/chosen/);
  await expect(page.locator('#active-thread')).toHaveText(await selectedRow.locator('.thread-name').textContent());
});

test('connection failure and disconnect recover in the browser',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({CODEX_DEMO:'0',CODEX_BIN:'missing-codex-inventory-e2e'});
  await page.goto(url);await expect(page.locator('#connection')).toHaveText('APP SERVER OFFLINE');
  await box.restart({MOCK_DISCONNECT_METHOD:'thread/list',MOCK_DISCONNECT_MARKER:join(box.directory,'disconnected')});
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY',{timeout:15000});
  await expect(page.locator('#new-thread')).toBeEnabled();
  await createChat(page);
  await expect(page.locator('#thread-list')).toContainText('チャット1');
});

test('timeout and quota fetch failure are visible without invented values',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_HANG_METHODS:'thread/list',MOCK_FAIL_METHODS:'account/rateLimits/read',CODEX_RPC_TIMEOUT_MS:'350'});
  await page.goto(url);
  await expect(page.locator('#notice')).toContainText('取得できません');
  await expect(page.locator('#quota-primary')).toContainText('取得不可');
  await expect(page.locator('#quota-secondary')).toContainText('取得不可');
  await expect(page.locator('#quota-note')).toContainText('利用量を取得できません');
  await box.restart();
  await expect(page.locator('#quota-primary')).toContainText('72% 残り',{timeout:15000});
  await createChat(page);
});

test('failed Codex submission retains the unsent draft and does not create a false log entry',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_FAIL_METHODS:'turn/start'});
  await page.goto(url);await createChat(page);
  await page.locator('#prompt').fill('retry this draft');
  await page.locator('#run').click();
  await expect(page.locator('#notice')).toContainText('実行を開始できません');
  // Mock RPC -32600 is a turn/start rejection. Verify the phase-rich
  // diagnostic instead of the legacy category-only bracket.
  await expect(page.locator('#notice'))
    .toContainText('[TURN_REJECTED / TURN_START_RPC / RPC -32600]');
  await expect(page.locator('#prompt')).toHaveValue('retry this draft');
  await expect(page.locator('#log')).not.toContainText('retry this draft');
  await expect(page.locator('#stop')).toBeDisabled();
});

test('fresh paginated chat can send first mock turn despite full history -32601 (@mock)',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_PAGINATED_EMPTY_READ:'1'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const id=await createChat(page);
  await expect(page.locator('#active-thread')).toHaveText(/^チャット\d+$/);
  await expect(page.locator('#editing')).not.toBeChecked();
  await runPrompt(page,'SYNTHETIC_PAGINATED_FIRST_TURN');
  await expectAnswer(page,'SYNTHETIC_PAGINATED_FIRST_TURN');
  await expect(page.locator('#notice')).not.toContainText('THREAD_READ');
  const stored=JSON.parse(await readFile(box.store,'utf8'));
  const record=stored.threads.find(thread=>thread.id===id);
  expect(record.turns).toHaveLength(1);
  expect(record.turns[0].status).toBe('completed');
});

test('turn rejection shows actionable category without raw workspace secrets (@mock)',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await createChat(page);
  const unsafePath='C:\\\\Users\\\\synthetic-private\\\\ProjectSecret';
  await page.route('**/api/threads/*/turn',route=>route.fulfill({
    status:409,contentType:'application/json',
    body:JSON.stringify({error:'別プロジェクトのチャットです '+unsafePath+' token-secret',
      turnStage:'WORKSPACE_SCOPE',rpcCode:-32602})
  }));
  await page.locator('#prompt').fill('synthetic unchanged draft');
  await page.locator('#run').click();
  await expect(page.locator('#notice')).toContainText('[WORKSPACE_MISMATCH / WORKSPACE_SCOPE / RPC -32602]');
  await expect(page.locator('#notice')).toContainText('所属プロジェクト');
  await expect(page.locator('#notice')).not.toContainText('synthetic-private');
  await expect(page.locator('#notice')).not.toContainText('token-secret');
  await expect(page.locator('#prompt')).toHaveValue('synthetic unchanged draft');
  await expect(page.locator('#log')).not.toContainText('synthetic unchanged draft');
  await expect(page.locator('#stop')).toBeDisabled();
});


test('real-shape unknown RPC refusal identifies phase and retains input without raw error (@mock)',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await createChat(page);
  await page.route('**/api/threads/*/turn',route=>route.fulfill({
    status:503,contentType:'application/json',
    body:JSON.stringify({
      error:'Synthetic unknown Codex refusal at C:\\\\Users\\\\PrivateSynthetic\\\\secrets',
      turnStage:'TURN_START_RPC',rpcCode:-32602
    })
  }));
  await page.locator('#prompt').fill('do not submit a real turn');
  await page.locator('#run').click();
  await expect(page.locator('#notice'))
    .toContainText('[TURN_REJECTED / TURN_START_RPC / RPC -32602]');
  await expect(page.locator('#notice')).not.toContainText('PrivateSynthetic');
  await expect(page.locator('#prompt')).toHaveValue('do not submit a real turn');
  await expect(page.locator('#log')).not.toContainText('do not submit a real turn');
});

test('authenticated Codex CLI shares Desktop history and resumes a real thread @real',async({page})=>{
  test.skip(process.env.CODEX_E2E_REAL!=='1','Run locally with CODEX_E2E_REAL=1');
  test.skip(!process.env.CODEX_DESKTOP_THREAD_ID,'Set CODEX_DESKTOP_THREAD_ID to a test-owned Desktop chat');
  test.setTimeout(180000);
  box=await sandbox();
  const {url}=await box.start({CODEX_DEMO:'0'});
  const errors=browserErrors(page);
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY',{timeout:60000});
  const desktopId=process.env.CODEX_DESKTOP_THREAD_ID;
  if(desktopId){
    await page.locator('#show-all').check();
    await expect(page.locator(`.thread-item[data-thread-id="${desktopId}"]`)).toBeVisible({timeout:30000});
    if(process.env.CODEX_DESKTOP_EXPECT_TEXT){
      await page.locator(`.thread-item[data-thread-id="${desktopId}"]`).click();
      await expectAnswer(page,process.env.CODEX_DESKTOP_EXPECT_TEXT);
      await runPrompt(page,'Reply with INVENTORY_CONTINUED. Do not edit files.');
      await expectAnswer(page,'INVENTORY_CONTINUED');
      await expect(page.locator('#stop')).toBeDisabled({timeout:60000});
    }
  }
  const id=await createChat(page);
  await mkdir(join(root,'.tmp'),{recursive:true});
  await writeFile(join(root,'.tmp','real-e2e-thread.json'),JSON.stringify({threadId:id}),{mode:0o600});
  await runPrompt(page,'Reply with E2E_OK and one short sentence. Do not edit files.');
  await expectAnswer(page,'E2E_OK');
  await expect(page.locator('#stop')).toBeDisabled({timeout:60000});
  await expect(page.locator('#usage')).toHaveText(/\d[\d,]* TOKENS/,{timeout:30000});
  await page.reload();
  await expectAnswer(page,'E2E_OK');
  await runPrompt(page,'Reply with E2E_RESUMED. Do not edit files.');
  await expectAnswer(page,'E2E_RESUMED');
  await expect(page.locator('#stop')).toBeDisabled({timeout:60000});
  const usage=await page.request.get(url+'/api/usage');
  expect(usage.ok()).toBeTruthy();
  const quota=await usage.json();
  expect(quota.primary?.windowDurationMins).toBe(300);
  expect(quota.secondary?.windowDurationMins).toBe(10080);
  expect(errors.httpErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('authenticated Codex CLI runs two browser chats and interrupts one @real',async({page})=>{
  test.skip(process.env.CODEX_E2E_REAL!=='1','Run locally with CODEX_E2E_REAL=1');
  test.setTimeout(180000);
  box=await sandbox();
  const {url}=await box.start({CODEX_DEMO:'0'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY',{timeout:60000});
  const first=await createChat(page);
  const second=await createChat(page);
  const [alpha,beta]=await Promise.all([
    page.request.post(`${url}/api/threads/${first}/turn`,{data:{prompt:'Reply with REAL_ALPHA. Do not edit files.',action:'quest',editing:false}}),
    page.request.post(`${url}/api/threads/${second}/turn`,{data:{prompt:'Reply with REAL_BETA. Do not edit files.',action:'quest',editing:false}})
  ]);
  expect(alpha.status()).toBe(202);expect(beta.status()).toBe(202);
  const status=await (await page.request.get(`${url}/api/status`)).json();
  expect(status.active).toBe(2);
  await expect(page.locator('#stop')).toBeEnabled();
  const duplicate=await page.request.post(`${url}/api/threads/${second}/turn`,{data:{prompt:'duplicate',action:'quest',editing:false}});
  expect(duplicate.status()).toBe(409);
  await page.locator('#stop').click();
  await expect(page.locator('#stop')).toBeDisabled({timeout:30000});
  await page.locator(`.thread-item[data-thread-id="${first}"]`).click();
  await expectAnswer(page,'REAL_ALPHA');
  await expect(page.locator('#stop')).toBeDisabled({timeout:60000});
});

test('foreign-workspace history is readable but cannot start any Codex turn',async({page})=>{
  box=await sandbox();
  const foreignId='mock-foreign';
  const outside=join(box.directory,'foreign-workspace');
  const now=Math.floor(Date.now()/1000);
  await writeFile(box.store,JSON.stringify({nextId:1,threads:[{
    id:foreignId,cwd:outside,preview:'Foreign workspace chat',createdAt:now,updatedAt:now,
    turns:[{id:'foreign-turn',status:'completed',items:[
      {id:'foreign-user',type:'userMessage',content:[{type:'text',text:'Foreign prompt'}]},
      {id:'foreign-reply',type:'agentMessage',text:'Foreign answer'}
    ]}]
  }]}));
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await page.locator('#show-all').check();
  const foreign=page.locator(`.thread-item[data-thread-id="${foreignId}"]`);
  await expect(foreign).toBeVisible();
  await foreign.click();
  await expect(page.locator('#log')).toContainText('Foreign answer');
  await expect(page.locator('#quest-state')).toHaveText('別ワールド・閲覧専用');
  await expect(page.locator('#run')).toBeDisabled();
  const response=await page.request.post(`${url}/api/threads/${foreignId}/turn`,{data:{prompt:'must not run',action:'quest',editing:false}});
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toContain('別プロジェクト');
  const stored=JSON.parse(await readFile(box.store,'utf8'));
  expect(stored.threads[0].turns).toHaveLength(1);
  await createChat(page);
  await expect(page.locator('#run')).toBeEnabled();
});

test('authenticated real Codex CLI can edit only an isolated temporary workspace @real @write',async({page})=>{
  test.skip(process.env.CODEX_E2E_REAL!=='1'||process.env.CODEX_E2E_WRITE!=='1','Opt-in real edit requires CODEX_E2E_REAL=1 and CODEX_E2E_WRITE=1');
  test.setTimeout(240000);
  box=await sandbox();
  const init=spawnSync('git',['init','--quiet',box.directory],{encoding:'utf8',windowsHide:true});
  expect(init.status,init.stderr).toBe(0);
  const {url}=await box.start({CODEX_DEMO:'0',CODEX_WORKSPACE:box.directory});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY',{timeout:60000});
  await page.locator('#editing').check();
  await createChat(page);
  await page.locator('.slot[data-item="build"]').click();
  await runPrompt(page,'Create a new file named inventory-write-proof.txt in the current workspace. Its ONLY content must be CODEX_INVENTORY_WRITE_E2E_OK followed by a newline. Do not modify any other file. Do not access the network.');
  const target=join(box.directory,'inventory-write-proof.txt');
  await expect.poll(async()=>readFile(target,'utf8').catch(()=>null),{timeout:180000}).toBe('CODEX_INVENTORY_WRITE_E2E_OK\n');
  await expect(page.locator('#stop')).toBeDisabled({timeout:60000});
});

test('real Codex permission denial and one-time approval affect only temporary files @real @approval',async({page})=>{
  test.skip(process.env.CODEX_E2E_REAL!=='1'||process.env.CODEX_E2E_APPROVAL!=='1',
    'Requires a disposable test account and CODEX_E2E_REAL=1 CODEX_E2E_APPROVAL=1');
  test.setTimeout(480000);
  box=await sandbox();
  const work=join(box.directory,'approval-work');
  const outside=join(box.directory,'approval-outside');
  await mkdir(work,{recursive:true});
  await mkdir(outside,{recursive:true});
  const init=spawnSync('git',['init','--quiet',work],{encoding:'utf8',windowsHide:true});
  expect(init.status,init.stderr).toBe(0);
  const target=join(outside,'approval-proof.txt');
  const {url}=await box.start({CODEX_DEMO:'0',CODEX_WORKSPACE:work});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY',{timeout:60000});
  await page.locator('#editing').check();
  const instruction='Use a single Windows PowerShell command to create a file at '+
    JSON.stringify(target)+' containing exactly APPROVAL_TEST_OK followed by a newline. '+
    'The path is in a separate TEMP directory outside this temporary Git workspace. '+
    'Do not modify other files and do not access the network. If authorization is required, request it. '+
    'After the command report whether it completed.';
  await createChat(page);
  await runPrompt(page,instruction);
  const panel=page.locator('#codex-approval-panel');
  await expect(panel).toBeVisible({timeout:180000});
  await panel.getByRole('button',{name:'拒否'}).first().click();
  await expect(panel).toBeHidden({timeout:30000});
  await expect.poll(async()=>readFile(target,'utf8').catch(()=>null)).toBe(null);
  await createChat(page);
  await runPrompt(page,instruction);
  await expect(panel).toBeVisible({timeout:180000});
  await panel.getByRole('button',{name:'今回のみ許可'}).first().click();
  await expect.poll(async()=>readFile(target,'utf8').catch(()=>null),{timeout:120000}).toBe('APPROVAL_TEST_OK\n');
  await expect(page.locator('#stop')).toBeDisabled({timeout:90000});
});

test('local Git item produces a separate result without starting Codex',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await openTools(page);
  await expect(page.locator('.local-item-button')).toHaveCount(16);
  await page.locator('.local-item-button').filter({hasText:'差分確認の巻物'}).click();
  await expect(page.locator('#local-results')).toBeVisible();
  await expect(page.locator('#local-result-title')).toContainText('Codex未使用');
  await expect(page.locator('#local-result-text')).toContainText('変更状況');
  const response=await (await page.request.get(url+'/api/threads')).json();
  expect(response.threads).toHaveLength(0);
  const status=await (await page.request.get(url+'/api/status')).json();
  expect(status.active).toBe(0);
});

test('prompt templates never submit to Codex and protect unsent drafts',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await openTemplates(page);
  await page.locator('#template-select').selectOption('e2e-fix');
  await page.locator('#template-apply').click();
  await expect(page.locator('#prompt')).toHaveValue(/実ブラウザE2E/);
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  await page.locator('#prompt').fill('保存したい下書き');
  await page.locator('#template-select').selectOption('diff-review');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#template-apply').click();
  await expect(page.locator('#prompt')).toHaveValue('保存したい下書き');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#template-apply').click();
  await expect(page.locator('#prompt')).toHaveValue(/差分概要/);
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  expect((await (await page.request.get(url+'/api/status')).json()).active).toBe(0);
});

test('catalog pages, keyboard slots and hotbar changes persist by workspace',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.goto(url);
  await page.locator('[data-category="テンプレート"]').click();
  await expect(page.locator('#catalog-page')).toHaveText('1 / 2');
  await expect(page.locator('#slots .slot')).toHaveCount(9);
  await page.locator('#catalog-next').click();
  await expect(page.locator('#catalog-page')).toHaveText('2 / 2');
  const eighth=page.locator('#slots .slot[data-item]').first();
  const name=await eighth.getAttribute('aria-label');
  const selectedId=await eighth.getAttribute('data-item');
  await page.locator('body').click({position:{x:2,y:2}});
  await page.keyboard.press('1');
  await expect(page.locator('#item-title')).toHaveText(name);
  await page.locator('#hotbar').locator('button').nth(7).click();
  await page.locator('#hotbar-add').click();
  await expect(page.locator('#hotbar').locator('button').nth(7)).toHaveAttribute('data-item',selectedId);
  await page.locator('#hotbar-left').click();
  await expect(page.locator('#hotbar').locator('button').nth(6)).toHaveAttribute('data-item',selectedId);
  await page.reload();
  await expect(page.locator('#hotbar').locator('button').nth(6)).toHaveAttribute('data-item',selectedId);
  await page.locator('#hotbar').locator('button').nth(6).click();
  await page.locator('#hotbar-remove').click();
  await expect(page.locator('#hotbar').locator('button').nth(6)).not.toHaveAttribute('data-item',/.+/);
  await page.locator('[data-category="Codex"]').click();
  await page.locator('#slots .slot[data-item="quest"]').click();
  await page.locator('#hotbar-add').click();
  await page.goto('about:blank');await box.restart({CODEX_WORKSPACE:box.directory});await page.goto(url);
  await expect(page.locator('#hotbar').locator('button').nth(6)).not.toHaveAttribute('data-item',/.+/);
  expect(errors.consoleErrors).toEqual([]);expect(errors.httpErrors).toEqual([]);
});

test('project search and selected local result stay local until explicit send',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.goto(url);
  await openTools(page);
  await page.locator('#local-query').fill('CodexService');
  await page.locator('#local-code-search').click();
  await expect(page.locator('#local-result-text')).toContainText('CodexService');
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  await page.locator('#local-attach').check();
  await expect(page.locator('#send-preview')).toContainText('添付 1件');
  await expect(page.locator('#send-preview')).toContainText('表示内のファイル');
  await page.locator('[data-category="Codex"]').click();
  await page.locator('#slots .slot[data-item="quest"]').click();
  await page.locator('#prompt').fill('E2E attached result');
  expect((await (await page.request.get(url+'/api/status')).json()).active).toBe(0);
  await page.locator('#run').click();
  await expect(page.locator('#send-preview')).toContainText('添付なし');
  await expect(page.locator('#log')).toContainText('E2E attached result');
  expect(errors.consoleErrors).toEqual([]);expect(errors.httpErrors).toEqual([]);
});

test('mobile catalog and local controls remain reachable without horizontal overflow',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.setViewportSize({width:390,height:844});await page.goto(url);
  await page.locator('[data-category="プロジェクト"]').click();
  await expect(page.locator('#catalog-page')).toHaveText('1 / 1');
  await page.locator('#slots .slot[data-item="project-tree"]').click();
  await page.locator('#run').click();
  await expect(page.locator('#local-results')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors.consoleErrors).toEqual([]);expect(errors.httpErrors).toEqual([]);
});

test('template edit, variables, duplicate, favorites, import and export survive reload',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.goto(url);
  await openTemplates(page);
  await page.locator('#template-select').selectOption('feature');
  await page.locator('#template-title').fill('編集した標準');
  await page.locator('#template-body').fill('確認: {goal}');
  await page.locator('#template-save').click();
  await expect(page.locator('#template-preview')).toContainText('未入力: {goal}');
  await page.locator('#template-variables input[name="goal"]').fill('日本語E2E');
  await expect(page.locator('#template-preview')).toContainText('確認: 日本語E2E');
  await page.locator('#template-apply').click();
  await expect(page.locator('#prompt')).toHaveValue('確認: 日本語E2E');
  await page.locator('#template-duplicate').click();
  await expect(page.locator('#template-select')).toHaveValue(/^user-/);
  const userId=await page.locator('#template-select').inputValue();
  await page.locator('#template-favorite').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#template-export').click();
  const download=await downloadPromise;
  const raw=await readFile(await download.path(),'utf8');
  expect(JSON.parse(raw).templates).toHaveLength(1);
  await page.reload();
  await openTemplates(page);
  await expect(page.locator('#template-select')).toContainText('編集した標準');
  await expect(page.locator('#template-select')).toContainText('★');
  await page.locator('#template-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await expect(page.locator('#notice')).toContainText('読み込めません');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#template-import').setInputFiles({name:'good.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await expect(page.locator('#notice')).toContainText('読み込みました');
  await page.locator('#template-select').selectOption(userId);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#template-delete').click();
  await expect(page.locator(`#template-select option[value="${userId}"]`)).toHaveCount(0);
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  expect(errors.consoleErrors).toEqual([]);expect(errors.httpErrors).toEqual([]);
});

test('untrusted template text is never rendered as HTML',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.goto(url);
  await openTemplates(page);
  await page.locator('#template-new').click();
  await page.locator('#template-title').fill('<img src=x onerror=window.injected=1>');
  await page.locator('#template-body').fill('<svg onload=window.injected=1></svg>');
  await page.locator('#template-save').click();
  await page.locator('[data-category="テンプレート"]').click();
  await page.locator('#catalog-next').click();
  const malicious=page.locator('#slots .slot[aria-label^="<img"]');
  await expect(malicious).toBeVisible();await malicious.click();
  await expect(page.locator('#item-title')).toContainText('<img src=x');
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
  expect(await page.locator('#slots img,#template-preview svg').count()).toBe(0);
  expect(errors.consoleErrors).toEqual([]);expect(errors.httpErrors).toEqual([]);
});

test('test script requires approval and no Codex turn is started',async({page})=>{
  box=await sandbox();
  await writeFile(join(box.directory,'package.json'),JSON.stringify({scripts:{test:'node -e "console.log(\'LOCAL_PASS\')"'}}));
  const {url}=await box.start({CODEX_WORKSPACE:box.directory});const errors=browserErrors(page);
  await page.goto(url);
  await openTools(page);
  const denied=await page.request.post(url+'/api/local-tools/project-test',{data:{}});expect(denied.status()).toBe(403);
  await Promise.all([
    page.waitForEvent('dialog').then(dialog=>{expect(dialog.message()).toContain('node -e');return dialog.dismiss();}),
    page.locator('#local-project-test').click()
  ]);
  await expect(page.locator('#local-results')).toBeHidden();
  await Promise.all([
    page.waitForEvent('dialog').then(dialog=>dialog.accept()),
    page.locator('#local-project-test').click()
  ]);
  await expect(page.locator('#local-results')).toBeVisible();
  await expect(page.locator('#local-result-text')).toContainText('LOCAL_PASS');
  expect((await (await page.request.get(url+'/api/status')).json()).active).toBe(0);
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  expect(errors.consoleErrors).toEqual([]);expect(errors.httpErrors).toEqual([]);
});

test('workbench stays closed on load, tabs switch accessibly and preserve drafts',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.setViewportSize({width:1280,height:800});
  await page.goto(url);await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#utility-drawer')).toBeHidden();
  await expect(page.locator('#utility-tools-pane')).toBeHidden();
  await expect(page.locator('#utility-templates-pane')).toBeHidden();
  await expect(page.locator('#open-local-tools')).toHaveAttribute('aria-expanded','false');
  await page.locator('#open-local-tools').click();
  await expect(page.locator('#utility-tools-pane')).toBeVisible();
  await expect(page.locator('#utility-templates-pane')).toBeHidden();
  await expect(page.locator('#open-local-tools')).toHaveAttribute('aria-expanded','true');
  await page.locator('#utility-tools-tab').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#utility-templates-tab')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#utility-templates-pane')).toBeVisible();
  await page.locator('#template-select').selectOption('feature');
  await page.locator('#template-body').fill('E2E drawer draft: {goal}');
  await page.locator('#utility-close').click();
  await expect(page.locator('#utility-drawer')).toBeHidden();
  await expect(page.locator('#open-templates')).toBeFocused();
  await page.locator('#open-templates').click();
  await expect(page.locator('#template-body')).toHaveValue('E2E drawer draft: {goal}');
  await page.keyboard.press('Escape');
  await expect(page.locator('#utility-drawer')).toBeHidden();
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.httpErrors).toEqual([]);
});

test('secondary panel does not cause horizontal overflow across viewport sizes',async({page})=>{
  box=await sandbox();const {url}=await box.start();const errors=browserErrors(page);
  await page.goto(url);await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  for(const width of [390,768,1280,1920]){
    await page.setViewportSize({width,height:900});
    for(const tab of ['tools','templates']){
      await page.locator(tab==='tools'?'#open-local-tools':'#open-templates').click();
      await expect(page.locator('#utility-'+tab+'-pane')).toBeVisible();
      const delta=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(delta,'Overflow at '+width+'px in '+tab+' pane').toBeLessThanOrEqual(1);
    }
  }
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.httpErrors).toEqual([]);
});


async function seededProjects({alphaName='alpha',betaName='beta'}={}){
  const box=await sandbox();
  const alpha=join(box.directory,alphaName),beta=join(box.directory,betaName);
  await mkdir(alpha);await mkdir(beta);
  await writeFile(join(alpha,'README.md'),'ALPHA_PROJECT_E2E');
  await writeFile(join(beta,'README.md'),'BETA_PROJECT_E2E');
  const t=Math.floor(Date.now()/1000);
  const thread=(id,cwd,preview,time,text)=>({id,cwd,preview,createdAt:time-10,updatedAt:time,
    turns:[{id:'turn-'+id,status:'completed',items:[
      {id:'user-'+id,type:'userMessage',content:[{type:'text',text:'Open '+preview}]},
      {id:'reply-'+id,type:'agentMessage',text}
    ]}]
  });
  const threads=[
    thread('mock-alpha-auto',alpha,'Alpha project',t-120,'ANSWER_ALPHA'),
    thread('mock-beta-auto',beta,'Beta project',t,'ANSWER_BETA')
  ];
  await writeFile(box.store,JSON.stringify({nextId:100,threads}));
  return {...box,alpha,beta};
}

test('without -Workspace, Inventory discovers App Server projects and changes active chat and local tools',async({page})=>{
  box=await seededProjects();
  const {url}=await box.start({CODEX_WORKSPACE:''});
  const errors=browserErrors(page);
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#project-select')).toBeEnabled();
  await expect(page.locator('#project-select option')).toHaveCount(2);
  await expect(page.locator('#project-select')).toHaveValue(box.beta);
  await expect(page.locator('#workspace')).toHaveText('beta');
  const betaLabel=await page.locator('#workspace').textContent();
  await expect(page.locator('#log')).toContainText('ANSWER_BETA');
  await page.locator('#project-select').selectOption(box.alpha);
  await expect(page.locator('#workspace')).toHaveText('alpha');
  expect(await page.locator('#workspace').textContent()).not.toBe(betaLabel);
  await expect(page.locator('#log')).toContainText('ANSWER_ALPHA');
  await expect(page.locator('#log')).not.toContainText('ANSWER_BETA');
  // Restart Inventory; App Server's newest project is beta, but saved browser
  // selection must restore alpha without explicitly providing -Workspace.
  await page.goto('about:blank');
  await box.restart({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#project-select')).toHaveValue(box.alpha);
  await expect(page.locator('#log')).toContainText('ANSWER_ALPHA');
  const preview=await page.request.post(url+'/api/local-tools/project-preview',{data:{},headers:{'X-Codex-Workspace':encodeURIComponent(box.alpha)}});
  expect(preview.status()).toBe(200);
  expect(JSON.stringify(await preview.json())).toContain('ALPHA_PROJECT_E2E');
  const created=await createChat(page);
  const owner=await (await page.request.get(url+'/api/threads/'+created)).json();
  expect(owner.thread.cwd).toBe(box.alpha);
  await page.reload();
  await expect(page.locator('#project-select')).toHaveValue(box.alpha);
  await expect(page.locator('#active-thread')).toHaveText(/^チャット\d+$/);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.httpErrors).toEqual([]);
});

test('without detected projects, Inventory never silently writes into its own repository',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#project-select')).toBeDisabled();
  await expect(page.locator('#project-hint')).toContainText('履歴がありません');
  await expect(page.locator('#project-hint')).toContainText('Web版は -Workspace を指定して起動してください');
  await expect(page.locator('#new-thread')).toBeDisabled();
  await expect(page.locator('#run')).toBeDisabled();
  const status=await (await page.request.get(url+'/api/status')).json();
  expect(status.workspace).toBeNull();
  expect((await page.request.post(url+'/api/local-tools/project-preview',{data:{}})).status()).toBe(409);
  expect((await page.request.post(url+'/api/threads',{data:{editing:false}})).status()).toBe(409);
});

test('project hotbars are restored independently and old threads are never sent to a new cwd',async({page})=>{
  box=await seededProjects();const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#project-select')).toBeEnabled();
  // Customize the hotbar for beta; alpha must retain its own defaults.
  await page.locator('#catalog-categories [data-category="Codex"]').click();
  await page.locator('#slots [data-item="review"]').click();
  await page.locator('#hotbar-add').click();
  await expect(page.locator('#hotbar button').first()).toHaveAttribute('data-item','review');
  await page.locator('#show-all').check();
  await expect(page.locator('.thread-item')).toHaveCount(2);
  await page.locator('.thread-item[data-thread-id="mock-alpha-auto"]').click();
  await expect(page.locator('#run')).toBeDisabled();
  await page.locator('#project-select').selectOption(box.alpha);
  await expect(page.locator('#run')).toBeEnabled();
  await expect(page.locator('#hotbar button').first()).not.toHaveAttribute('data-item','review');
  await page.locator('#project-select').selectOption(box.beta);
  await expect(page.locator('#hotbar button').first()).toHaveAttribute('data-item','review');
  // The beta project must restore its own titled chat, never a foreign one.
  await expect(page.locator('#active-thread')).toHaveText('Beta project');
  await expect(page.locator('#run')).toBeEnabled();
  await page.reload();
  await expect(page.locator('#project-select')).toHaveValue(box.beta);
  await expect(page.locator('#active-thread')).toHaveText('Beta project');
  await expect(page.locator('#run')).toBeEnabled();
});

test('project picker does not overflow at phone and desktop widths',async({page})=>{
  box=await seededProjects();const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#project-select')).toBeEnabled();
  for(const width of [390,768,1280,1920]){
    await page.setViewportSize({width,height:850});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});


test('approved npm command refuses execution when package.json changes during user confirmation',async({page})=>{
  box=await sandbox();
  const manifest=join(box.directory,'package.json');
  await writeFile(manifest,JSON.stringify({scripts:{
    pretest:'node -e "console.log(\'SAFE_PREP\')"',
    test:'node -e "console.log(\'SAFE_TEST\')"',
    posttest:'node -e "console.log(\'SAFE_CLEANUP\')"'
  }}));
  const {url}=await box.start({CODEX_WORKSPACE:box.directory});
  const errors=browserErrors(page);
  await page.goto(url);
  await openTools(page);
  const dialog=page.waitForEvent('dialog').then(async d=>{
    expect(d.message()).toContain('SAFE_PREP');
    expect(d.message()).toContain('SAFE_TEST');
    expect(d.message()).toContain('SAFE_CLEANUP');
    expect(d.message()).toContain('外部');
    // Replace the script after preview but before the user accepts.
    await writeFile(manifest,JSON.stringify({scripts:{
      pretest:'node -e "process.exit(75)"',
      test:'node -e "console.log(\'SAFE_TEST\')"'
    }}));
    await d.accept();
  });
  const rejected=page.waitForResponse(response=>
    response.url().endsWith('/api/local-tools/project-test')&&response.request().method()==='POST');
  await Promise.all([dialog,page.locator('#local-project-test').click()]);
  expect((await rejected).status()).toBe(409);
  await expect(page.locator('#notice')).toContainText('実行できません');
  await expect(page.locator('#local-results')).toBeHidden();
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  // Chromium logs an expected "Failed to load resource" for HTTP 409.
  // Assert it is the only kind of console error, never hide other failures.
  expect(errors.consoleErrors.every(message=>
    /Failed to load resource: the server responded with a status of 409/.test(message))).toBe(true);
  expect(errors.httpErrors).toEqual([]);
});


test('reset ticket item shows real owned count and consumes only after explicit final checkbox',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_RESET_CREDITS:'1'});
  const errors=browserErrors(page);
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#ticket-count')).toHaveText('残り 2枚');
  await expect(page.locator('#ticket-expiry')).toContainText('有効期限');
  // Confirmation screen 1: choosing a ticket is NOT consumption.
  await page.locator('#ticket-open').click();
  await expect(page.locator('#reset-credit-dialog')).toBeVisible();
  await expect(page.locator('#reset-credit-choice option')).toHaveCount(2);
  await expect(page.locator('#reset-credit-choice')).toHaveValue('mock-credit-near');
  await page.locator('#reset-credit-review').click();
  await expect(page.locator('#reset-credit-review-panel')).toBeVisible();
  await expect(page.locator('#reset-credit-review-details')).toContainText('5h + 週間 Full Reset');
  await expect(page.locator('#reset-credit-review-details')).toContainText('5時間:');
  await expect(page.locator('#reset-credit-review-details')).toContainText('週間:');
  await expect(page.locator('#reset-credit-review-details')).toContainText('2枚');
  await expect(page.locator('#reset-credit-confirm')).toBeDisabled();
  await page.locator('#reset-credit-close').click();
  await expect(page.locator('#reset-credit-dialog')).toBeHidden();
  expect((await (await page.request.get(url+'/api/usage')).json()).resetCreditTickets.availableCount).toBe(2);
  // Confirmation screen 2: explicit consent is required.
  await page.locator('#ticket-open').click();
  await page.locator('#reset-credit-review').click();
  await page.locator('#reset-credit-consent').check();
  await expect(page.locator('#reset-credit-confirm')).toBeEnabled();
  const consumed=page.waitForResponse(r=>r.url().endsWith('/api/reset-credits/confirm')&&r.request().method()==='POST');
  await page.locator('#reset-credit-confirm').click();
  expect((await consumed).status()).toBe(200);
  await expect(page.locator('#reset-credit-result')).toContainText('1枚使用');
  await expect(page.locator('#ticket-count')).toHaveText('残り 1枚');
  await expect(page.locator('#featured-item .reset-ticket-count')).toHaveText('1枚');
  await expect(page.locator('#quota-primary')).toContainText('100% 残り');
  await page.locator('#reset-credit-close').click();
  await expect(page.locator('#reset-credit-dialog')).toBeHidden();
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.httpErrors).toEqual([]);
});

test('reset ticket is not falsely shown as zero when the API omits the credit summary',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#ticket-count')).toHaveText('残り 未取得');
  await expect(page.locator('#ticket-open')).toBeDisabled();
  await page.locator('#catalog-categories [data-category="Codex"]').click();
  await expect(page.locator('#featured-item [data-item="reset-credit"] .reset-ticket-count')).toHaveText('未取得');
  await page.locator('#featured-item [data-item="reset-credit"]').click();
  await expect(page.locator('#item-title')).toHaveText('Codexのリセットチケット');
  await expect(page.locator('#item-description')).toContainText('残枚数を取得できません');
  await page.locator('#run').click();
  await expect(page.locator('#reset-credit-dialog')).toBeVisible();
  await expect(page.locator('#reset-credit-dialog-message')).toContainText('取得できません');
  await expect(page.locator('#reset-credit-confirm')).toBeDisabled();
  await page.locator('#reset-credit-close').click();
});

test('a reset ticket can be used from the item itself and the dialog fits a small viewport',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_RESET_CREDITS:'1'});
  await page.setViewportSize({width:390,height:800});
  await page.goto(url);
  await expect(page.locator('#ticket-count')).toHaveText('残り 2枚');
  await page.locator('#catalog-categories [data-category="Codex"]').click();
  await page.locator('#featured-item [data-item="reset-credit"]').click();
  await expect(page.locator('#item-title')).toHaveText('Codexのリセットチケット');
  await page.locator('#run').click();
  await expect(page.locator('#reset-credit-dialog')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#reset-credit-dialog')).toBeHidden();
  expect((await (await page.request.get(url+'/api/usage')).json()).resetCreditTickets.availableCount).toBe(2);
});

test('count-only reset tickets warn that expiry is unknown before consumption',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_RESET_CREDITS:'1',MOCK_RESET_CREDITS_COUNT_ONLY:'1'});
  await page.goto(url);
  await expect(page.locator('#ticket-count')).toHaveText('残り 2枚');
  await expect(page.locator('#ticket-expiry')).toContainText('有効期限は未取得');
  await page.locator('#ticket-open').click();
  await expect(page.locator('#reset-credit-choice')).toHaveValue('');
  await expect(page.locator('#reset-credit-choice-info')).toContainText('自動選択');
  await page.locator('#reset-credit-review').click();
  await expect(page.locator('#reset-credit-review-details')).toContainText('有効期限: 未取得');
  await page.locator('#reset-credit-close').click();
  expect((await (await page.request.get(url+'/api/usage')).json()).resetCreditTickets.availableCount).toBe(2);
});


test('model and reasoning picker sends catalog-validated overrides to the real turn RPC mock',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const model=page.locator('#model-select'),effort=page.locator('#reasoning-select');
  await expect(model).toBeEnabled();
  await expect(model.locator('option')).toHaveCount(3);
  await model.selectOption('mock-deep');
  await expect(effort.locator('option')).toHaveCount(4);
  await expect(effort.locator('option').nth(1)).toHaveAttribute('value','high');
  await expect(effort.locator('option').nth(2)).toHaveAttribute('value','xhigh');
  await expect(effort.locator('option').nth(3)).toHaveAttribute('value','ultra');
  await effort.selectOption('ultra');
  await expect(page.locator('#model-hint')).toContainText('次の送信');
  const threadId=await createChat(page);
  await runPrompt(page,'Run a mock high reasoning task');
  await expectAnswer(page,'【デモ】');
  const stored=JSON.parse(await readFile(box.store,'utf8'));
  const saved=stored.threads.find(thread=>thread.id===threadId);
  expect(saved.turns[0].requestedModel).toBe('mock-deep');
  expect(saved.turns[0].requestedEffort).toBe('ultra');
  await page.reload();
  await expect(model).toHaveValue('mock-deep');
  await expect(effort).toHaveValue('ultra');
  await model.selectOption('mock-model');
  await expect(effort).toHaveValue('');
  await expect(effort.locator('option[value="ultra"]')).toHaveCount(0);
  await expect(effort.locator('option[value="low"]')).toHaveCount(1);
});

test('model and reasoning preferences remain separate across selected projects',async({page})=>{
  box=await seededProjects();
  const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#project-select')).toHaveValue(box.beta);
  await expect(page.locator('#model-select')).toBeEnabled();
  await page.locator('#model-select').selectOption('mock-deep');
  await page.locator('#reasoning-select').selectOption('xhigh');
  await page.locator('#project-select').selectOption(box.alpha);
  await expect(page.locator('#model-select')).toHaveValue('');
  await expect(page.locator('#reasoning-select')).toHaveValue('');
  await page.locator('#model-select').selectOption('mock-model');
  await page.locator('#reasoning-select').selectOption('low');
  await page.locator('#project-select').selectOption(box.beta);
  await expect(page.locator('#model-select')).toHaveValue('mock-deep');
  await expect(page.locator('#reasoning-select')).toHaveValue('xhigh');
  await page.reload();
  await expect(page.locator('#model-select')).toHaveValue('mock-deep');
  await expect(page.locator('#reasoning-select')).toHaveValue('xhigh');
});

test('unsupported model effort combination is rejected before a turn and does not reach the model',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  const thread=await createChat(page);
  const invalid=await page.request.post(url+'/api/threads/'+thread+'/turn',{
    data:{prompt:'DO NOT SEND',action:'quest',editing:false,model:'mock-deep',effort:'low'}
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toContain('対応していません');
  const unknown=await page.request.post(url+'/api/threads/'+thread+'/turn',{
    data:{prompt:'DO NOT SEND',action:'quest',editing:false,model:'unknown-model',effort:'high'}
  });
  expect(unknown.status()).toBe(400);
  const invalidType=await page.request.post(url+'/api/threads/'+thread+'/turn',{
    data:{prompt:'DO NOT SEND',action:'quest',editing:false,model:{evil:1},effort:'high'}
  });
  expect(invalidType.status()).toBe(400);
  const stored=JSON.parse(await readFile(box.store,'utf8'));
  expect(stored.threads.find(t=>t.id===thread).turns).toHaveLength(0);
});

test('model and effort dropdowns remain usable at 390px without horizontal overflow',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.setViewportSize({width:390,height:780});
  await page.goto(url);
  await expect(page.locator('#reasoning-select')).toBeEnabled();
  await page.locator('#reasoning-select').selectOption('high');
  expect(await page.evaluate(()=>
    document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});


test('inventory renders full item names without cropping, overlap or horizontal overflow',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  for(const width of [390,768,1366,1680]){
    await page.setViewportSize({width,height:850});
    await page.goto(url);
    await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
    for(const category of ['Codex','ローカル','テンプレート']){
      await page.locator('#catalog-categories button[data-category="'+category+'"]').click();
      for(let pageNumber=0;pageNumber<5;pageNumber++){
        const measurements=await page.locator('#slots .slot[data-item]').evaluateAll(buttons=>
          buttons.map(button=>{
            const label=button.querySelector('.slot-label');
            const icon=button.querySelector('svg,.item-emoji');
            const outer=button.getBoundingClientRect();
            const text=label.getBoundingClientRect();
            const sprite=icon?.getBoundingClientRect();
            return {
              name:button.getAttribute('aria-label'),
              label:label.textContent,
              labelInside:text.left>=outer.left-1&&text.right<=outer.right+1&&
                text.top>=outer.top-1&&text.bottom<=outer.bottom+1,
              clipped:label.scrollHeight>label.clientHeight+1,
              iconOverlaps:sprite?sprite.bottom>text.top+1:false
            };
          }));
        expect(measurements.length).toBeGreaterThan(0);
        for(const entry of measurements){
          expect(entry.label).toBe(entry.name);
          expect(entry.labelInside,entry.name+' should stay inside its slot').toBe(true);
          expect(entry.clipped,entry.name+' should not be vertically clipped').toBe(false);
          expect(entry.iconOverlaps,entry.name+' must not overlap its icon').toBe(false);
        }
        if(await page.locator('#catalog-next').isDisabled())break;
        await page.locator('#catalog-next').click();
      }
    }
    const horizontalOverflow=await page.evaluate(()=>
      document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(horizontalOverflow,'horizontal overflow at width '+width+'px').toBeLessThanOrEqual(1);
  }
  await page.locator('#catalog-categories [data-category="Codex"]').click();
  const credit=page.locator('#featured-item .slot[data-item="reset-credit"]');
  await expect(credit.locator('.slot-label')).toHaveText('Codexのリセットチケット');
  const badgeOverlap=await credit.evaluate(button=>{
    const label=button.querySelector('.slot-label').getBoundingClientRect();
    const badge=button.querySelector('.reset-ticket-count').getBoundingClientRect();
    return label.left<badge.right&&badge.left<label.right&&
      label.top<badge.bottom&&badge.top<label.bottom;
  });
  expect(badgeOverlap).toBe(false);
});


test('Unicode project paths can fetch history, create and resume a mock Codex turn',async({page})=>{
  box=await seededProjects({
    alphaName:'日本語 🌸 100% workspace',
    betaName:'English beta'
  });
  const {url}=await box.start({CODEX_WORKSPACE:''});
  const errors=browserErrors(page);
  const scopedHeaders=[];
  page.on('request',request=>{
    const value=request.headers()['x-codex-workspace'];
    if(value)scopedHeaders.push(value);
  });
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#project-select')).toHaveValue(box.beta);

  await page.locator('#project-select').selectOption(box.alpha);
  await expect(page.locator('#workspace')).toHaveText('日本語 🌸 100% workspace');
  await expect(page.locator('#log')).toContainText('ANSWER_ALPHA');
  const thread=await createChat(page);
  await runPrompt(page,'Unicode workspace mock run');
  await expect(page.locator('#log')).toContainText('Unicode workspace mock run');
  await expectAnswer(page,'【デモ】');
  const owned=await (await page.request.get(url+'/api/threads/'+thread)).json();
  expect(owned.thread.cwd).toBe(box.alpha);

  await openTools(page);
  await page.locator('#local-project-preview').click();
  await expect(page.locator('#local-result-text')).toContainText('ALPHA_PROJECT_E2E');
  await page.reload();
  await expect(page.locator('#project-select')).toHaveValue(box.alpha);
  await expect(page.locator('#log')).toContainText('Unicode workspace mock run');

  expect(scopedHeaders).toContain(encodeURIComponent(box.alpha));
  expect(scopedHeaders.every(h=>[...h].every(c=>c.charCodeAt(0)<128))).toBe(true);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.httpErrors).toEqual([]);
});


test('verbose commands default to a compact preview and expand without losing full content',async({page})=>{
  box=await seededProjects();
  const seeded=JSON.parse(await readFile(box.store,'utf8'));
  const longCommand=[
    'powershell -NoProfile -Command "Get-ChildItem -Recurse -File |',
    '  Where-Object { $_.Extension -in @(\'.mjs\', \'.js\') } |',
    '  Select-Object -First 120 FullName"',
    'This is the final command line that must be visible in the expanded view.'
  ].join('\n');
  const active=seeded.threads.find(t=>t.id==='mock-beta-auto');
  active.turns[0].items.push({
    id:'test-command-item',type:'commandExecution',command:longCommand
  });
  await writeFile(box.store,JSON.stringify(seeded));

  const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const command=page.locator('#log .log-entry.command .command-details');
  await expect(command).toHaveCount(1);
  expect(await command.evaluate(node=>node.open)).toBe(false);
  await expect(command.locator('.command-preview')).toContainText('powershell -NoProfile');
  await expect(command.locator('summary')).toContainText('全文表示');
  const compact=await command.locator('summary').evaluate(node=>({
    width:node.clientWidth,scrollWidth:node.scrollWidth
  }));
  expect(compact.scrollWidth-compact.width).toBeLessThanOrEqual(1);

  await command.locator('summary').click();
  expect(await command.evaluate(node=>node.open)).toBe(true);
  await expect(command.locator('.command-full')).toContainText(
    'This is the final command line that must be visible');
  await expect(command.locator('summary')).toContainText('閉じる');
  // Expanded commands remain contained when the desktop window is narrow.
  await page.setViewportSize({width:390,height:760});
  expect(await page.evaluate(()=>
    document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({width:1280,height:850});
  await expect(page.locator('#log .log-entry.answer')).toContainText('ANSWER_BETA');

  // A history refresh redraws all DOM entries; intentional expansions persist.
  await page.locator('#clear-log').click();
  await expect(command).toHaveCount(1);
  expect(await command.evaluate(node=>node.open)).toBe(true);
  await command.locator('summary').click();
  expect(await command.evaluate(node=>node.open)).toBe(false);

  // Copy All uses the underlying unabridged transcript, not the summary text.
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
  await page.locator('#copy-log').click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('This is the final command line that must be visible');
  expect(copied).toContain('Where-Object');

  await page.reload();
  await expect(command).toHaveCount(1);
  expect(await command.evaluate(node=>node.open)).toBe(false);
});


test('reset-credit remains a visible genuine inventory item across categories and pages',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_RESET_CREDITS:'1'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const item=page.locator('#featured-item .featured-ticket[data-item="reset-credit"]');
  await expect(item).toBeVisible();
  await expect(item.locator('svg')).toBeVisible();
  await expect(item.locator('.slot-label')).toHaveText('Codexのリセットチケット');
  await expect(item.locator('.reset-ticket-count')).toHaveText('2枚');
  for(const width of [390,768,1366,1680]){
    await page.setViewportSize({width,height:820});
    await expect(item).toBeVisible();
    // The permanent ticket is a small tool-sized item, never a wide banner.
    const bounds=await item.boundingBox();
    expect(bounds.width,'ticket width at '+width+'px').toBeLessThanOrEqual(270);
    expect(bounds.height,'ticket height at '+width+'px').toBeLessThanOrEqual(60);
    const badge=await item.locator('.reset-ticket-count').boundingBox();
    const label=await item.locator('.slot-label').boundingBox();
    expect(badge.x,'count badge must follow label').toBeGreaterThanOrEqual(label.x+label.width-1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if(process.env.RELEASE_EVIDENCE_DIR){
      await mkdir(process.env.RELEASE_EVIDENCE_DIR,{recursive:true});
      await page.screenshot({path:join(process.env.RELEASE_EVIDENCE_DIR,`inventory-${width}.png`),fullPage:true});
    }
  }
  for(const category of ['Codex','Git','ローカル','プロジェクト','テンプレート']){
    await page.locator('#catalog-categories button[data-category="'+category+'"]').click();
    await expect(item).toBeVisible();
    await expect(page.locator('#slots [data-item="reset-credit"]')).toHaveCount(0);
    if(await page.locator('#catalog-next').isEnabled()){
      await page.locator('#catalog-next').click();
      await expect(item).toBeVisible();
    }
  }
  await item.click();
  await expect(page.locator('#item-title')).toHaveText('Codexのリセットチケット');
  await expect(item).toHaveClass(/selected/);
  await page.locator('#run').click();
  await expect(page.locator('#reset-credit-dialog')).toBeVisible();
  await expect(page.locator('#reset-credit-choice option')).toHaveCount(2);
  await page.locator('#reset-credit-close').click();
  await expect(page.locator('#reset-credit-dialog')).toBeHidden();
  expect((await (await page.request.get(url+'/api/usage')).json()).resetCreditTickets.availableCount).toBe(2);
  await page.reload();
  await expect(item).toBeVisible();
  await expect(item.locator('.reset-ticket-count')).toHaveText('2枚');
});

test('Codex completion provides in-app and native bridge notifications once, with an opt-out',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_DUP_COMPLETION:'1'});
  await page.addInitScript(()=>{
    window.testNativeCompletionCalls=[];
    window.codexInventory={
      notifyTurnComplete:status=>{
        window.testNativeCompletionCalls.push(status);
        return Promise.resolve({shown:true});
      }
    };
  });
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#completion-notifications')).toBeChecked();
  await createChat(page);
  await runPrompt(page,'Notify on completion');
  await expect(page.locator('#completion-toast')).toBeVisible();
  await expect(page.locator('#completion-toast-text')).toContainText('処理が完了しました');
  await expect.poll(()=>page.evaluate(()=>window.testNativeCompletionCalls.length)).toBe(1);
  expect(await page.evaluate(()=>window.testNativeCompletionCalls)).toEqual(['completed']);
  await page.locator('#completion-toast-open').click();
  await expect(page.locator('#completion-toast')).toBeHidden();
  await expect(page.locator('#active-thread')).toHaveText(await page.locator('.thread-item.chosen .thread-name').textContent());
  await page.locator('#completion-notifications').uncheck();
  await page.reload();
  await expect(page.locator('#completion-notifications')).not.toBeChecked();
  await runPrompt(page,'Second turn should not notify');
  await expectAnswer(page,'Second turn should not notify');
  await expect(page.locator('#completion-toast')).toBeHidden();
  await expect(page.locator('#stop')).toBeDisabled();
  expect(await page.evaluate(()=>window.testNativeCompletionCalls)).toHaveLength(0);
});

test('failed Codex turns show an appropriate completion warning without leaking the prompt',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_TURN_STATUS:'failed'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await createChat(page);
  await runPrompt(page,'sensitive developer prompt should not be in notification');
  await expect(page.locator('#completion-toast')).toBeVisible();
  await expect(page.locator('#completion-toast-text')).toContainText('失敗しました');
  await expect(page.locator('#completion-toast-text')).not.toContainText('sensitive developer prompt');
  await expect(page.locator('#completion-toast')).toHaveAttribute('data-status','failed');
  await page.locator('#completion-toast-dismiss').click();
  await expect(page.locator('#completion-toast')).toBeHidden();
});

test('split panes keep independent drafts and target the selected thread (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  const diagnostics=browserErrors(page);
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const first=await createChat(page);
  const second=await createChat(page);
  await page.locator('.thread-item[data-thread-id="'+first+'"]').click();
  await page.locator('#prompt').fill('primary unsent draft');
  await page.locator('#split-toggle').click();
  await expect(page.locator('#secondary-pane')).toBeVisible();
  await page.locator('#secondary-thread').selectOption(second);
  await expect(page.locator('#secondary-status')).toHaveText('待機中');
  await page.locator('#secondary-prompt').fill('secondary demo prompt');
  await page.locator('#secondary-send').click();
  await expect(page.locator('#secondary-log .user-message').first()).toContainText('secondary demo prompt');
  await expect(page.locator('#prompt')).toHaveValue('primary unsent draft');
  await page.locator('#secondary-prompt').fill('secondary unsent draft');
  await page.locator('#split-toggle').click();
  await expect(page.locator('#secondary-pane')).toBeHidden();
  await page.locator('#split-toggle').click();
  await expect(page.locator('#secondary-pane')).toBeVisible();
  await expect(page.locator('#secondary-prompt')).toHaveValue('secondary unsent draft');
  for(const width of [390,768,1280,1920]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),
      'split UI overflow at '+width).toBeLessThanOrEqual(1);
  }
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.httpErrors).toEqual([]);
});

test('missing template variables stay out of the activity notice',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await openTemplates(page);
  await page.locator('#template-select').selectOption('feature');
  await page.locator('#template-body').fill('Synthetic task: {private_marker}');
  await page.locator('#template-save').click();
  await page.locator('#template-apply').click();
  await expect(page.locator('#notice')).toHaveText('未入力の変数があります');
  await expect(page.locator('#notice')).not.toContainText('private_marker');
  expect((await (await page.request.get(url+'/api/threads')).json()).threads).toHaveLength(0);
});

test('split selection and width survive reload, and separator supports pointer and keyboard (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.setViewportSize({width:1280,height:900});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const first=await createChat(page);
  const second=await createChat(page);
  await page.locator(`.thread-item[data-thread-id="${first}"]`).click();
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-thread').selectOption(second);
  const separator=page.getByRole('separator',{name:/resize|幅/i});
  await expect(separator).toBeVisible();
  await expect(separator).toHaveAttribute('aria-orientation','vertical');
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow','52');
  const boxBefore=await separator.boundingBox();
  await page.mouse.move(boxBefore.x+boxBefore.width/2,boxBefore.y+boxBefore.height/2);
  await page.mouse.down();
  await page.mouse.move(boxBefore.x+boxBefore.width/2+75,boxBefore.y+boxBefore.height/2);
  await page.mouse.up();
  const dragged=Number(await separator.getAttribute('aria-valuenow'));
  expect(dragged).toBeGreaterThan(52);
  await page.reload();
  await expect(page.locator('#secondary-pane')).toBeVisible();
  await expect(page.locator('#secondary-thread')).toHaveValue(second);
  await expect(page.getByRole('separator',{name:/resize|幅/i})).toHaveAttribute('aria-valuenow',String(dragged));
});

test('secondary controls and log scroll belong to each chat (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const first=await createChat(page);
  const second=await createChat(page);
  const third=await createChat(page);
  await page.locator(`.thread-item[data-thread-id="${first}"]`).click();
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-thread').selectOption(second);
  await page.locator('#secondary-prompt').fill('draft for second');
  await page.locator('#secondary-model').selectOption('mock-deep');
  await page.locator('#secondary-effort').selectOption('high');
  // The visible radio tile is the user-facing control. The underlying select
  // is intentionally hidden and remains the API/state source of truth.
  await page.locator('#secondary-action-options [data-action="review"]').click();
  await expect(page.locator('#secondary-action')).toHaveValue('review');
  await expect(page.locator('#secondary-action-options [data-action="review"]')).toHaveAttribute('aria-checked','true');
  await page.locator('#secondary-editing').check();
  await page.locator('#secondary-thread').selectOption(third);
  await page.locator('#secondary-prompt').fill('draft for third');
  await expect(page.locator('#secondary-model')).toHaveValue('');
  await expect(page.locator('#secondary-effort')).toHaveValue('');
  await expect(page.locator('#secondary-action')).toHaveValue('quest');
  await expect(page.locator('#secondary-action-options [data-action="quest"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#secondary-editing')).not.toBeChecked();
  await page.locator('#secondary-thread').selectOption(second);
  await expect(page.locator('#secondary-prompt')).toHaveValue('draft for second');
  await expect(page.locator('#secondary-model')).toHaveValue('mock-deep');
  await expect(page.locator('#secondary-effort')).toHaveValue('high');
  await expect(page.locator('#secondary-action')).toHaveValue('review');
  await expect(page.locator('#secondary-action-options [data-action="review"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#secondary-editing')).toBeChecked();
  await page.locator('#secondary-prompt').fill('a reply to scroll beyond the top');
  await page.locator('#secondary-send').click();
  await expect(page.locator('#secondary-log .answer')).toContainText('a reply to scroll beyond the top');
  const scroll=page.locator('#secondary-log');
  const storedTop=await scroll.evaluate(element=>{
    element.style.height='20px';
    element.style.minHeight='20px';
    element.style.maxHeight='20px';
    element.scrollTop=Math.floor((element.scrollHeight-element.clientHeight)/2);
    return element.scrollTop;
  });
  expect(storedTop).toBeGreaterThan(0);
  await page.locator('#secondary-thread').selectOption(third);
  await page.locator('#secondary-thread').selectOption(second);
  await expect.poll(()=>scroll.evaluate(element=>element.scrollTop)).toBe(storedTop);
});

test('split action palette supports keyboard, languages, per-thread state and independent editing (@mock)',async({page})=>{
  box=await sandbox();
  const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const primary=await createChat(page);
  const secondary=await createChat(page);
  const third=await createChat(page);
  await page.locator(`.thread-item[data-thread-id="${primary}"]`).click();
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-thread').selectOption(secondary);
  await page.locator('#ui-language').selectOption('ja');
  const radio=value=>page.locator(`#secondary-action-options [data-action="${value}"]`);
  await expect(radio('quest')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#secondary-action')).toHaveValue('quest');
  await page.locator('#secondary-prompt').fill('synthetic unchanged draft');
  await radio('review').click();
  await expect(radio('review')).toHaveAttribute('aria-checked','true');
  await expect(radio('quest')).toHaveAttribute('aria-checked','false');
  await expect(page.locator('#secondary-action')).toHaveValue('review');
  await expect(page.locator('#secondary-action-help')).toContainText('レビュー');
  await radio('review').press('ArrowRight');
  await expect(radio('map')).toHaveAttribute('aria-checked','true');
  await expect(radio('map')).toBeFocused();
  await radio('map').press('Home');
  await expect(radio('quest')).toHaveAttribute('aria-checked','true');
  await radio('build').click();
  await expect(page.locator('#secondary-action-help')).toContainText('編集許可');
  await expect(page.locator('#secondary-editing')).not.toBeChecked();
  await expect(page.locator('#secondary-prompt')).toHaveValue('synthetic unchanged draft');
  await page.locator('#secondary-thread').selectOption(third);
  await expect(radio('quest')).toHaveAttribute('aria-checked','true');
  await page.locator('#secondary-thread').selectOption(secondary);
  await expect(radio('build')).toHaveAttribute('aria-checked','true');
  await page.locator('#ui-language').selectOption('en');
  await expect(radio('build')).toContainText('Build');
  await expect(page.locator('#secondary-action-help')).toContainText('Requires file editing permission');
  await expect(page.locator('#secondary-action')).toHaveValue('build');
  await page.locator('#ui-language').selectOption('ja');
  await expect(radio('build')).toContainText('実装');
  for(const width of [390,768,1280]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),
      'action chooser caused horizontal overflow at '+width).toBeLessThanOrEqual(1);
  }
});

test('mobile split tabs show one chat and preserve an active turn (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_TURN_DELAY_MS:'3000'});
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const first=await createChat(page);
  const second=await createChat(page);
  await page.locator(`.thread-item[data-thread-id="${first}"]`).click();
  await page.locator('#split-toggle').click();
  const tabs=page.getByRole('tablist',{name:/chat|チャット/i});
  await expect(tabs).toBeVisible();
  await expect(page.locator('.quest-column').first()).toBeVisible();
  await expect(page.locator('#secondary-pane')).toBeHidden();
  await page.getByRole('tab',{name:/second|右|2/i}).click();
  await expect(page.locator('#secondary-pane')).toBeVisible();
  await expect(page.locator('.quest-column').first()).toBeHidden();
  await page.locator('#secondary-thread').selectOption(second);
  await page.locator('#secondary-prompt').fill('continue while switching tabs');
  await page.locator('#secondary-send').click();
  await expect(page.locator('#secondary-stop')).toBeEnabled();
  await page.getByRole('tab',{name:/first|左|1/i}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:/second|右|2/i})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/first|左|1/i}).click();
  await page.getByRole('tab',{name:/second|右|2/i}).click();
  await expect(page.locator('#secondary-log')).toContainText('continue while switching tabs');
  await expect(page.locator('#secondary-log .answer')).toContainText('continue while switching tabs',{timeout:15000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('selecting the primary chat in the second pane keeps actions disabled (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const id=await createChat(page);
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-thread').selectOption(id);
  await page.locator('#secondary-prompt').fill('must not duplicate a turn');
  await expect(page.locator('#secondary-send')).toBeDisabled();
  await expect(page.locator('#secondary-stop')).toBeDisabled();
  await expect(page.locator('#secondary-status')).toContainText('同じチャット');
});

test('split chats run in separate discovered workspaces without changing the project picker (@mock)',async({page})=>{
  box=await seededProjects();
  const {url}=await box.start({CODEX_WORKSPACE:'',MOCK_TURN_DELAY_MS:'1200'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#project-select')).toHaveValue(box.beta);
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-project').selectOption(box.alpha);
  await page.locator('#secondary-thread').selectOption('mock-alpha-auto');
  await page.locator('#prompt').fill('beta parallel request');
  await page.locator('#run').click();
  await page.locator('#secondary-prompt').fill('alpha parallel request');
  await page.locator('#secondary-send').click();
  await expect(page.locator('#log')).toContainText('beta parallel request');
  await expect(page.locator('#secondary-log')).toContainText('alpha parallel request');
  await expect(page.locator('#project-select')).toHaveValue(box.beta);
  const history=async id=>(await (await fetch(url+'/api/threads/'+id)).json()).messages||[];
  await expect.poll(async()=>[(await history('mock-beta-auto')).some(x=>x.role==='assistant'&&x.text.includes('beta parallel request')),
    (await history('mock-alpha-auto')).some(x=>x.role==='assistant'&&x.text.includes('alpha parallel request'))]).toEqual([true,true]);
});

test('freshly registered zero-chat project appears in split picker and creates a scoped chat (@mock)',async({page})=>{
  box=await seededProjects();
  const gamma=join(box.directory,'fresh-zero-chat-project');
  await mkdir(gamma);
  const backend=await startInventoryServer({
    command:process.execPath,
    commandArgs:[join(root,'tests/fixtures/mock-app-server.mjs')],
    commandEnv:{...process.env,MOCK_STORE_FILE:box.store},
    cwd:root,selectedWorkspace:null,listenPort:0,
    knownProjects:[box.alpha,box.beta]
  });
  try{
    const url=backend.url;
    const errors=browserErrors(page);
    await page.goto(url);
    await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
    await expect(page.locator('#project-select')).toHaveValue(box.beta);
    await page.locator('#split-toggle').click();
    await expect(page.locator('#secondary-project option')).toHaveCount(3);
    // Matches the registration operation used by Electron's trusted + dialog.
    await backend.service.registerProject(gamma);
    await page.locator('#project-refresh').click();
    await expect.poll(async()=>page.locator('#secondary-project option')
      .evaluateAll(nodes=>nodes.map(node=>node.value).includes(gamma))).toBe(true);
    await page.locator('#secondary-project').selectOption(gamma);
    await expect(page.locator('#secondary-project')).toHaveValue(gamma);
    await expect(page.locator('#secondary-thread option')).toHaveCount(1);
    await expect(page.locator('#secondary-new')).toBeEnabled();
    await expect(page.locator('#secondary-send')).toBeDisabled();
    // Left and right workspace selections must be independent.
    await page.locator('#project-select').selectOption(box.beta);
    await expect(page.locator('#secondary-project')).toHaveValue(gamma);
    // An explicitly chosen project must survive reload even before a chat exists.
    await page.reload();
    await expect(page.locator('#secondary-project')).toHaveValue(gamma);
    await expect(page.locator('#secondary-thread option')).toHaveCount(1);
    await expect(page.locator('#secondary-new')).toBeEnabled();
    const requestPromise=page.waitForRequest(r=>r.url().endsWith('/api/threads')&&r.method()==='POST');
    await page.locator('#secondary-new').click();
    const request=await requestPromise;
    expect(decodeURIComponent(request.headers()['x-codex-workspace'])).toBe(gamma);
    await expect(page.locator('#secondary-thread option')).toHaveCount(2);
    await expect.poll(()=>page.locator('#secondary-thread').inputValue()).not.toBe('');
    const id=await page.locator('#secondary-thread').inputValue();
    const fetched=await page.request.get(url+'api/threads/'+encodeURIComponent(id));
    expect(fetched.ok()).toBeTruthy();
    expect((await fetched.json()).thread.cwd).toBe(gamma);
    await expect(page.locator('#project-select')).toHaveValue(box.beta);
    await page.reload();
    await expect(page.locator('#secondary-project')).toHaveValue(gamma);
    await expect(page.locator('#secondary-thread')).toHaveValue(id);
    expect(errors.consoleErrors).toEqual([]);
    expect(errors.httpErrors).toEqual([]);
  }finally{await backend.stop();}
});

test('SSE reconnect reloads a secondary chat that completed while events were unavailable (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start();
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const first=await createChat(page);
  const second=await createChat(page);
  await page.locator('.thread-item[data-thread-id="'+first+'"]').click();
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-thread').selectOption(second);
  let blocked=0;
  await page.route('**/api/events',route=>{blocked++;return route.abort();});
  await box.restart();
  await expect.poll(()=>blocked).toBeGreaterThan(0);
  const response=await fetch(url+'/api/threads/'+second+'/turn',{
    method:'POST',headers:{'Content-Type':'application/json','X-Codex-Workspace':encodeURIComponent(root)},
    body:JSON.stringify({prompt:'Recovered secondary',action:'quest',editing:false,model:null,effort:null})
  });
  expect(response.status).toBe(202);
  await expect.poll(async()=>{
    const history=await (await fetch(url+'/api/threads/'+second)).json();
    return history.messages?.some(message=>message.role==='assistant'&&message.text.includes('Recovered secondary'));
  }).toBe(true);
  let resyncs=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/activity-state')resyncs++;});
  await page.unroute('**/api/events');
  await expect.poll(()=>resyncs).toBeGreaterThan(0);
  await expect(page.locator('#secondary-log .answer')).toContainText('Recovered secondary',{timeout:15000});
});

test('a stale secondary history response cannot erase a newer SSE reply (@mock)',async({page})=>{
  box=await seededProjects();
  const {url}=await box.start({CODEX_WORKSPACE:''});
  // The E2E harness considers the HTTP listener ready as soon as GET /
  // succeeds, but Codex mock initialize and project discovery continue
  // asynchronously. Check the backend readiness *independently* before
  // starting this renderer/SSE race test; fail with a specific stage rather
  // than attributing backend startup latency to SSE history reconciliation.
  await expect.poll(async()=>{
    try{
      const response=await page.request.get(url+'/api/status',{timeout:4000});
      if(!response.ok())return 'HTTP_'+response.status();
      const status=await response.json();
      return status.connected===true?'READY':'MOCK_APP_SERVER_NOT_READY';
    }catch{return 'MOCK_STATUS_UNREACHABLE';}
  },{message:'mock backend initialization before secondary SSE race',timeout:20000,
    intervals:[200,500,1000]}).toBe('READY');
  const rendererErrors=[];
  page.on('pageerror',error=>rendererErrors.push(error.message));
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY',{timeout:15000});
  expect(rendererErrors).toEqual([]);
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-project').selectOption(box.alpha);
  await page.locator('#secondary-thread').selectOption('mock-alpha-auto');
  await expect(page.locator('#secondary-log')).toContainText('ANSWER_ALPHA');
  let snapshotTaken,releaseSnapshot;
  const captured=new Promise(resolve=>{snapshotTaken=resolve;});
  const gate=new Promise(resolve=>{releaseSnapshot=resolve;});
  await page.route('**/api/threads/mock-alpha-auto',async route=>{
    const response=await route.fetch();
    snapshotTaken();
    await gate;
    await route.fulfill({response});
  });
  await page.locator('#secondary-reload').click();
  await captured;
  const response=await fetch(url+'/api/threads/mock-alpha-auto/turn',{
    method:'POST',headers:{'Content-Type':'application/json',
      'X-Codex-Workspace':encodeURIComponent(box.alpha),'X-Codex-Workspace-Mode':'explicit'},
    body:JSON.stringify({prompt:'newer live reply',action:'quest',editing:false,model:null,effort:null})
  });
  expect(response.status).toBe(202);
  await expect(page.locator('#secondary-status')).toHaveText('実行中');
  await expect(page.locator('#secondary-status')).toHaveText('待機中');
  await expect(page.locator('#secondary-log')).toContainText('newer live reply');
  await page.evaluate(()=>{
    window.secondaryHistoryPainted=new Promise(resolve=>{
      const observer=new MutationObserver(()=>{observer.disconnect();resolve();});
      observer.observe(document.getElementById('secondary-log'),{childList:true});
    });
  });
  releaseSnapshot();
  await page.evaluate(()=>window.secondaryHistoryPainted);
  await expect(page.locator('#secondary-log')).toContainText('newer live reply');
});

test('a stale primary history response cannot erase a newer SSE reply (@mock)',async({page})=>{
  box=await seededProjects();
  const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#log')).toContainText('ANSWER_BETA');
  let snapshotTaken,releaseSnapshot;
  const captured=new Promise(resolve=>{snapshotTaken=resolve;});
  const gate=new Promise(resolve=>{releaseSnapshot=resolve;});
  await page.route('**/api/threads/mock-beta-auto',async route=>{
    const response=await route.fetch();
    snapshotTaken();
    await gate;
    await route.fulfill({response});
  });
  await page.locator('#clear-log').click();
  await captured;
  const response=await fetch(url+'/api/threads/mock-beta-auto/turn',{
    method:'POST',headers:{'Content-Type':'application/json','X-Codex-Workspace':encodeURIComponent(box.beta)},
    body:JSON.stringify({prompt:'newer primary reply',action:'quest',editing:false,model:null,effort:null})
  });
  expect(response.status).toBe(202);
  await expect(page.locator('#stop')).toBeEnabled();
  await expect(page.locator('#stop')).toBeDisabled();
  await expect(page.locator('#log')).toContainText('newer primary reply');
  await page.evaluate(()=>{
    window.primaryHistoryPainted=new Promise(resolve=>{
      const observer=new MutationObserver(()=>{observer.disconnect();resolve();});
      observer.observe(document.getElementById('log'),{childList:true});
    });
  });
  releaseSnapshot();
  await page.evaluate(()=>window.primaryHistoryPainted);
  await expect(page.locator('#log')).toContainText('newer primary reply');
});

test('a stale approval list cannot erase an SSE approval request (@mock)',async({page})=>{
  box=await sandbox();
  const {url}=await box.start({MOCK_APPROVAL_REQUEST:'1'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const thread=await createChat(page);
  let snapshotTaken,releaseSnapshot,intercepted=0,fulfilled=0;
  const captured=new Promise(resolve=>{snapshotTaken=resolve;});
  const gate=new Promise(resolve=>{releaseSnapshot=resolve;});
  await page.route('**/api/approvals',async route=>{
    intercepted++;
    const response=await route.fetch();
    snapshotTaken();
    await gate;
    await route.fulfill({response});
    fulfilled++;
  });
  await box.restart({MOCK_APPROVAL_REQUEST:'1'});
  await captured;
  const response=await fetch(url+'/api/threads/'+thread+'/turn',{
    method:'POST',headers:{'Content-Type':'application/json','X-Codex-Workspace':encodeURIComponent(root)},
    body:JSON.stringify({prompt:'synthetic approval race',action:'quest',editing:false,model:null,effort:null})
  });
  expect(response.status).toBe(202);
  await expect(page.locator('#codex-approval-panel')).toBeVisible();
  releaseSnapshot();
  await expect.poll(()=>fulfilled).toBeGreaterThan(0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(page.locator('#codex-approval-panel')).toBeVisible();
});

test('failed activity stays until acknowledged and duplicate completion stays singular (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_TURN_STATUS:'failed',MOCK_DUP_COMPLETION:'1'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const hidden=await createChat(page);
  await createChat(page);
  const response=await page.request.post(`${url}/api/threads/${hidden}/turn`,{
    data:{prompt:'synthetic failed turn',action:'quest',editing:false,model:null,effort:null}
  });
  expect(response.status()).toBe(202);
  const row=page.locator('#activity-feed-list .activity-failed');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(/チャット1|synthetic failed turn/);
  await page.waitForTimeout(8500);
  await expect(row).toHaveCount(1);
  await expect(page.locator('#activity-feed-list .activity-dismiss')).toBeVisible();
  await page.locator('#activity-feed-list .activity-dismiss').click();
  await expect(row).toHaveCount(0);
  await page.locator('#activity-feed-launcher').click();
  await expect(row).toHaveCount(1);
  await expect(page.locator('#activity-feed-list .activity-dismiss')).toHaveCount(0);
  await row.click();
  await expect(page.locator('#active-thread')).toHaveText(await page.locator('.thread-item.chosen .thread-name').textContent());
});

test('approval activity is deduplicated and clears when the request resolves (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_APPROVAL_REQUEST:'1',MOCK_DUP_APPROVAL_ID:'1'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const hidden=await createChat(page);
  await createChat(page);
  const response=await page.request.post(`${url}/api/threads/${hidden}/turn`,{
    data:{prompt:'synthetic approval request',action:'quest',editing:false,model:null,effort:null}
  });
  expect(response.status()).toBe(202);
  const activity=page.locator('#activity-feed-list .activity-approval');
  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText(/チャット1|synthetic approval request/);
  await page.reload();
  await expect(activity).toHaveCount(1);
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-thread').selectOption(hidden);
  await expect(activity).toHaveCount(0);
  await page.locator('#split-toggle').click();
  await expect(activity).toHaveCount(1);
  const pending=await page.request.get(`${url}/api/approvals`);
  expect(pending.status()).toBe(200);
  const [approval]=(await pending.json()).approvals;
  expect(approval).toBeDefined();
  const resolved=await page.request.post(`${url}/api/approvals/${approval.approvalId}/respond`,{
    headers:{Origin:url},data:{decision:'decline',threadId:approval.threadId,turnId:approval.turnId}
  });
  expect(resolved.status()).toBe(200);
  await expect(activity).toHaveCount(0);
});

test('workspace conflict warning uses safe thread titles and clears automatically (@mock)',async({page})=>{
  box=await sandbox();const {url}=await box.start({MOCK_TURN_DELAY_MS:'3500'});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  const first=await createChat(page);
  const second=await createChat(page);
  const started=await page.request.post(`${url}/api/threads/${first}/turn`,{
    data:{prompt:'synthetic edit one',action:'quest',editing:true,model:null,effort:null}
  });
  expect(started.status()).toBe(202);
  await page.locator('.edit-switch').click();
  await expect(page.locator('#editing')).toBeChecked();
  await page.locator('#prompt').fill('synthetic edit two');
  await page.locator('#run').click();
  const warning=page.locator('#workspace-conflicts');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(/チャット1|synthetic edit one/);
  await expect(warning).toContainText(/チャット2|synthetic edit two/);
  await expect(warning).toContainText('未確定');
  await expect(warning).not.toContainText(first);
  await expect(warning).not.toContainText(second);
  await expect(page.locator('#stop')).toBeEnabled();
  await expect(warning).toBeHidden({timeout:15000});
});

test('project folder names display while parent paths stay private (@mock)',async({page})=>{
  box=await seededProjects();const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#workspace')).toHaveText('beta');
  await expect(page.locator('#active-thread')).toHaveText('Beta project');
  await expect(page.locator('.thread-item')).toHaveCount(1);
  await expect(page.locator('.thread-item')).toHaveAttribute('title','Beta project');
  for(const selector of ['#workspace','#project-select','#project-hint','#thread-list','#active-thread']){
    const value=await page.locator(selector).textContent();
    expect(value).not.toContain('ANSWER_');
    expect(value).not.toContain(box.alpha);
    expect(value).not.toContain(box.beta);
  }
  const options=await page.locator('#project-select option').evaluateAll(nodes=>nodes.map(node=>node.title));
  expect(options).toEqual(expect.arrayContaining(['alpha','beta']));
  await page.locator('#project-select').selectOption(box.alpha);
  await expect(page.locator('#workspace')).toHaveText('alpha');
  await page.locator('#ui-language').selectOption('en');
  await expect(page.locator('#workspace')).toHaveText('alpha');
  await expect(page.locator('#project-select')).toContainText('alpha · 1 chats');
  await expect(page.locator('#project-select')).toContainText('beta · 1 chats');
  await page.reload();
  await expect(page.locator('#workspace')).toHaveText('alpha');
  await expect(page.locator('#active-thread')).toHaveText('Alpha project');
  const chatTitles=await page.locator('.thread-item').evaluateAll(nodes=>nodes.map(node=>node.title));
  // Project-scoped view must not show the other project's chat.
  expect(chatTitles).toEqual(['Alpha project']);
  await page.locator('#show-all').check();
  await expect(page.locator('.thread-item')).toHaveCount(2);
  const allTitles=await page.locator('.thread-item').evaluateAll(nodes=>nodes.map(node=>node.title));
  expect(allTitles).toEqual(expect.arrayContaining(['Alpha project','Beta project']));
});

test('three chats across two workspaces keep activity, approvals and stops correctly scoped (@mock)',async({page})=>{
  test.setTimeout(90000);
  box=await seededProjects();
  const {url}=await box.start({CODEX_WORKSPACE:'',MOCK_TURN_DELAY_MS:'3500',
    MOCK_SLOW_TURN_MATCH:'B1-slow',MOCK_SLOW_TURN_DELAY_MS:'12000',
    MOCK_APPROVAL_REQUEST:'1',MOCK_APPROVAL_MATCH:'A1-approval',
    MOCK_ACTIVITY_COMMAND_MATCH:'A2-progress',MOCK_DUP_COMPLETION:'1'});
  const scope=cwd=>({'X-Codex-Workspace':encodeURIComponent(cwd),'X-Codex-Workspace-Mode':'explicit'});
  const a1='mock-alpha-auto',b1='mock-beta-auto';
  const start=(id,cwd,prompt,editing=false)=>page.request.post(`${url}/api/threads/${id}/turn`,{
    headers:scope(cwd),data:{prompt,action:'quest',editing,model:null,effort:null}
  });
  const state=async()=>(await (await fetch(`${url}/api/activity-state`)).json());
  await page.addInitScript(()=>{
    const NativeEventSource=window.EventSource;
    window.EventSource=class extends NativeEventSource{
      constructor(...args){super(...args);window.syntheticEventStream=this;}
    };
  });
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await page.locator('#project-select').selectOption(box.alpha);
  const created=await page.request.post(`${url}/api/threads`,{headers:scope(box.alpha),data:{editing:false}});
  expect(created.status()).toBe(201);
  const a2=(await created.json()).thread.id;
  await page.locator('#reload-threads').click();
  await expect(page.locator(`.thread-item[data-thread-id="${a2}"]`)).toBeVisible();
  const a2Label=await page.locator(`.thread-item[data-thread-id="${a2}"] .thread-name`).textContent();
  await page.locator(`.thread-item[data-thread-id="${a1}"]`).click();
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-project').selectOption(box.beta);
  await page.locator('#secondary-thread').selectOption(b1);
  await expect(page.locator('#secondary-pane')).toBeVisible();

  const [a1Start,a2Start,b1Start]=await Promise.all([
    start(a1,box.alpha,'A1-approval synthetic request'),
    start(a2,box.alpha,'A2-progress synthetic work'),
    start(b1,box.beta,'B1-slow synthetic work')
  ]);
  expect([a1Start.status(),a2Start.status(),b1Start.status()]).toEqual([202,202,202]);
  await expect.poll(async()=>{const running=(await state()).runningThreadIds;return [a1,a2,b1].every(id=>running.includes(id));}).toBe(true);
  await expect(page.locator('#activity-feed-list .activity-started')).toContainText(a2Label);
  await expect(page.locator('#activity-feed-list .activity-command')).toContainText(a2Label);
  await expect(page.locator('#activity-feed-list')).not.toContainText(box.alpha);
  await expect(page.locator('#activity-feed-list')).not.toContainText(box.beta);
  await expect(page.locator('#codex-approval-panel')).toBeVisible();

  await page.locator('#project-select').selectOption(box.beta);
  await expect.poll(async()=>{const running=(await state()).runningThreadIds;return [a1,a2,b1].every(id=>running.includes(id));}).toBe(true);
  await page.locator('#project-select').selectOption(box.alpha);
  const pendingResponse=await page.request.get(`${url}/api/approvals`,{headers:scope(box.alpha)});
  expect(pendingResponse.status()).toBe(200);
  const [approval]=(await pendingResponse.json()).approvals;
  expect(approval.threadId).toBe(a1);
  const b1Turn=(await state()).runningTurns.find(row=>row.threadId===b1).turnId;
  const wrong=await page.request.post(`${url}/api/approvals/${approval.approvalId}/respond`,{
    headers:{...scope(box.beta),Origin:url},
    data:{decision:'accept',threadId:b1,turnId:b1Turn}
  });
  expect(wrong.status()).toBe(409);
  expect((await (await page.request.get(`${url}/api/approvals`,{headers:scope(box.alpha)})).json()).approvals).toHaveLength(1);
  await expect.poll(async()=>!(await state()).runningThreadIds.includes(a2)).toBe(true);
  // The thread preview becomes the user-visible title after its first turn.
  // Do not compare against the stale anonymous label captured at creation.
  await expect(page.locator('#activity-feed-list .activity-completed'))
    .toContainText('A2-progress synthetic work');
  await expect.poll(async()=>[(await state()).runningThreadIds.includes(a1),
    (await state()).runningThreadIds.includes(b1)]).toEqual([true,true]);
  const stopped=await page.request.post(`${url}/api/threads/${b1}/interrupt`,{
    headers:scope(box.beta),data:{turnId:b1Turn}
  });
  expect(stopped.status()).toBe(200);
  await expect.poll(async()=>[(await state()).runningThreadIds.includes(a1),
    (await state()).runningThreadIds.includes(b1)]).toEqual([true,false]);
  await expect(page.locator('#secondary-stop')).toBeDisabled();
  await expect(page.locator('#codex-approval-panel')).toBeVisible();

  await page.locator('#split-toggle').click();
  await page.locator('#split-toggle').click();
  await page.locator('#secondary-project').selectOption(box.beta);
  await page.locator('#secondary-thread').selectOption(b1);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('tab',{name:/second|右|2/i}).click();
  await page.getByRole('tab',{name:/first|左|1/i}).click();
  expect((await state()).runningThreadIds).toContain(a1);
  await page.evaluate(()=>{
    window.syntheticCompletionCalls=[];
    window.codexInventory={...(window.codexInventory||{}),
      notifyTurnComplete:async status=>{window.syntheticCompletionCalls.push(status);}};
  });
  const reconnectTurn=await start(a2,box.alpha,'A2-progress reconnect completion');
  expect(reconnectTurn.status()).toBe(202);
  await expect(page.locator(`.thread-item[data-thread-id="${a2}"]`)).toContainText('実行中');
  await page.evaluate(()=>window.syntheticEventStream.close());
  await page.context().setOffline(true);
  await expect(page.locator('#connection')).toHaveText('APP SERVER OFFLINE');
  const denied=await fetch(`${url}/api/approvals/${approval.approvalId}/respond`,{
    method:'POST',headers:{...scope(box.alpha),Origin:url,'Content-Type':'application/json'},
    body:JSON.stringify({decision:'decline',threadId:a1,turnId:approval.turnId})
  });
  expect(denied.status).toBe(200);
  await expect.poll(async()=>{
    const record=await (await fetch(`${url}/api/threads/${a2}`)).json();
    return record.messages?.some(message=>message.role==='assistant'&&message.text.includes('reconnect completion'));
  }).toBe(true);
  expect(await page.evaluate(()=>window.syntheticCompletionCalls)).toEqual([]);
  await page.context().setOffline(false);
  await expect(page.locator('#codex-approval-panel')).toBeHidden({timeout:15000});
  await expect.poll(()=>page.evaluate(()=>window.syntheticCompletionCalls.length),{timeout:15000}).toBe(2);
  expect((await page.evaluate(()=>window.syntheticCompletionCalls)).sort()).toEqual(['completed','failed']);
  await expect.poll(async()=>(await (await page.request.get(`${url}/api/approvals`,{headers:scope(box.alpha)})).json()).approvals.length).toBe(0);

  expect((await start(a1,box.alpha,'A1-approval second')).status()).toBe(202);
  await expect(page.locator('#codex-approval-panel')).toBeVisible();
  const [older]=(await (await page.request.get(`${url}/api/approvals`,{headers:scope(box.alpha)})).json()).approvals;
  let releaseResponse,processedResponse,completedResponse=0;
  const processed=new Promise(resolve=>{processedResponse=resolve;});
  const hold=new Promise(resolve=>{releaseResponse=resolve;});
  await page.route('**/api/approvals/*/respond',async route=>{
    const response=await route.fetch();processedResponse();await hold;
    await route.fulfill({response});completedResponse++;
  });
  await page.locator('#codex-approval-list .approval-decline').click();
  await processed;
  await expect.poll(async()=>!(await state()).runningThreadIds.includes(a1)).toBe(true);
  expect((await start(a1,box.alpha,'A1-approval third')).status()).toBe(202);
  await expect(page.locator('#codex-approval-list .codex-approval-card')).toHaveCount(1);
  releaseResponse();
  await expect.poll(()=>completedResponse).toBe(1);
  const [newer]=(await (await page.request.get(`${url}/api/approvals`,{headers:scope(box.alpha)})).json()).approvals;
  expect(newer.approvalId).not.toBe(older.approvalId);
  await expect(page.locator('#codex-approval-list .codex-approval-card')).toHaveCount(1);
  expect((await fetch(`${url}/api/approvals/${newer.approvalId}/respond`,{
    method:'POST',headers:{...scope(box.alpha),Origin:url,'Content-Type':'application/json'},
    body:JSON.stringify({decision:'decline',threadId:a1,turnId:newer.turnId})
  })).status).toBe(200);
  await expect.poll(async()=>!(await state()).runningThreadIds.includes(a1)).toBe(true);
  const [editOne,editTwo]=await Promise.all([
    start(a1,box.alpha,'A1 synthetic edit',true),
    start(a2,box.alpha,'A2 synthetic edit',true)
  ]);
  expect([editOne.status(),editTwo.status()]).toEqual([202,202]);
  const conflict=page.locator('#workspace-conflicts');
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('A2-progress synthetic work');
  await expect(conflict).not.toContainText(box.alpha);
  await expect(conflict).toBeHidden({timeout:15000});
});

test('official Codex conversation title outranks preview in primary and split history (@mock)',async({page})=>{
  box=await seededProjects();
  const snapshot=JSON.parse(await readFile(box.store,'utf8'));
  const beta=snapshot.threads.find(t=>t.id==='mock-beta-auto');
  beta.name='正式なチャット名';
  await writeFile(box.store,JSON.stringify(snapshot));
  const {url}=await box.start({CODEX_WORKSPACE:''});
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#active-thread')).toHaveText('正式なチャット名');
  await expect(page.locator('.thread-item[data-thread-id="mock-beta-auto"] .thread-name')).toHaveText('正式なチャット名');
  await page.locator('#split-toggle').click();
  await expect(page.locator('#secondary-thread option[value="mock-beta-auto"]')).toHaveText('正式なチャット名');
  await expect(page.locator('#secondary-thread option[value="mock-alpha-auto"]')).toHaveCount(0);
  await page.locator('#secondary-project').selectOption(box.alpha);
  await expect(page.locator('#secondary-thread option[value="mock-alpha-auto"]')).toHaveText('Alpha project');
  await page.locator('#ui-language').selectOption('en');
  await expect(page.locator('#active-thread')).toHaveText('正式なチャット名');
  await expect(page.locator('.thread-item[data-thread-id="mock-beta-auto"]')).toHaveAttribute('title','正式なチャット名');
  await expect(page.locator('#secondary-thread option[value="mock-alpha-auto"]')).toHaveText('Alpha project');
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>
    (localStorage.getItem(key)||'').includes('正式なチャット名')))).toBe(false);
  await page.reload();
  await expect(page.locator('#active-thread')).toHaveText('正式なチャット名');
});


test('legacy Codex thread without summary shows first stored user request (@mock)',async({page})=>{
  box=await seededProjects();
  const snapshot=JSON.parse(await readFile(box.store,'utf8'));
  const beta=snapshot.threads.find(row=>row.id==='mock-beta-auto');
  beta.name=null;
  beta.preview='';
  await writeFile(box.store,JSON.stringify(snapshot));
  const {url}=await box.start({CODEX_WORKSPACE:''});
  // Start loads the stored mock history with no list/read metadata title.
  // No turn/start, model inference or real user profile is used.
  await page.goto(url);
  await expect(page.locator('#connection')).toHaveText('APP SERVER READY');
  await expect(page.locator('#active-thread')).toHaveText('Open Beta project');
  await expect(page.locator('.thread-item[data-thread-id="mock-beta-auto"] .thread-name'))
    .toHaveText('Open Beta project');
  await page.locator('#split-toggle').click();
  await expect(page.locator('#secondary-thread option[value="mock-beta-auto"]'))
    .toHaveText('Open Beta project');
  await page.reload();
  await expect(page.locator('#active-thread')).toHaveText('Open Beta project');
});
