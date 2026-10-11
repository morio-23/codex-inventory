import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {executeBoundedProcess} from './script-process.mjs';
import {promisify} from 'node:util';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';

const exec=promisify(execFile);
const ignored=new Set(['.git','node_modules','.next','dist','build','coverage','.venv','venv','vendor','target']);
const textExtensions=/\.(?:[cm]?[jt]sx?|json|md|txt|css|html|ya?ml|toml|py|rs|go|java|sh|ps1)$/i;
const secretName=/(?:^\.env(?:\.|$)|secret|credential|private[-_.]?key|\.pem$|\.p12$)/i;
const limit=32_000;
const maxFiles=2000;
const maxFileBytes=1_000_000;
let activeRuns=0;

function bad(message,status=400){return Object.assign(new Error(message),{status});}
function clip(value){return value.length>limit?value.slice(0,limit)+'\n…表示上限に達したため省略しました':value||'(該当なし)';}
async function filesIn(workspace){
  const root=await realpath(workspace);
  const pending=[''];const files=[];
  const deadline=Date.now()+8000;let visited=0;
  while(pending.length&&files.length<maxFiles&&visited<500&&Date.now()<deadline){
    const folder=pending.shift();
    visited++;
    let entries;
    try{entries=await readdir(join(root,folder),{withFileTypes:true});}catch{continue;}
    for(const entry of entries){
      if(entry.isSymbolicLink()||entry.name.startsWith('.')||secretName.test(entry.name))continue;
      const path=join(folder,entry.name);
      if(entry.isDirectory()){if(!ignored.has(entry.name)&&pending.length<maxFiles)pending.push(path);}
      else if(entry.isFile()&&textExtensions.test(entry.name)){files.push(path);if(files.length>=maxFiles)break;}
    }
  }
  return {root,files};
}
async function safeRead(root,relativePath){
  const candidate=resolve(root,relativePath);
  if(candidate!==root&&!candidate.startsWith(root+sep))throw bad('ワークスペース外のパスです');
  const info=await lstat(candidate);
  if(!info.isFile()||info.isSymbolicLink()||info.size>maxFileBytes||secretName.test(basename(candidate)))return null;
  const actual=await realpath(candidate);
  if(actual!==root&&!actual.startsWith(root+sep))throw bad('ワークスペース外のパスです');
  return readFile(actual,'utf8');
}
async function scan(workspace,pattern){
  const {root,files}=await filesIn(workspace);const matches=[];
  let bytes=0;const deadline=Date.now()+8000;
  for(const file of files){
    if(bytes>=8_000_000||Date.now()>deadline)break;
    try{bytes+=(await lstat(join(root,file))).size;}catch{continue;}
    let content;try{content=await safeRead(root,file);}catch{continue;}
    if(content===null||content.includes('\0'))continue;
    const lines=content.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      const found=pattern(lines[i]);
      if(found){matches.push(`${file.replace(/\\/g,'/')}:${i+1}: ${lines[i].slice(0,300)}`);if(matches.length>=100)return matches;}
    }
  }
  return matches;
}
function result(heading,output){return [{heading,output:clip(output)}];}
function searchQuery(input){
  if(typeof input.query!=='string'||input.query.trim().length<2||input.query.length>80||/[\x00-\x1f]/.test(input.query))throw bad('検索語は2～80文字の文字列にしてください');
  return input.query.trim();
}
async function search(workspace,query,executor){
  // Fixed arguments and shell:false prevent command injection. rg respects ignore files.
  try{
    const found=await executor('rg',['-F','-n','--no-heading','--max-count','3','--max-filesize','1M','--glob','!**/.env*','--glob','!**/*secret*','--glob','!**/*credential*','--glob','!**/*.pem','--glob','!**/node_modules/**','--glob','!**/.git/**','--',query,'.'],{cwd:workspace,timeout:8000,maxBuffer:1_000_000,windowsHide:true,encoding:'utf8',shell:false});
    return result('コード検索',found.stdout||'');
  }catch(error){
    if(error.code===1)return result('コード検索','');
    if(error.code!=='ENOENT')throw bad(error.killed?'検索がタイムアウトしました':'検索に失敗しました');
    const lines=await scan(workspace,line=>line.includes(query));
    return result('コード検索（内蔵検索）',lines.join('\n'));
  }
}
async function preview(workspace){
  const root=await realpath(workspace);const sections=[];
  for(const name of ['README.md','README.txt','package.json','Cargo.toml','pyproject.toml','go.mod']){
    try{const data=await safeRead(root,name);if(data!==null)sections.push({heading:name,output:clip(data.slice(0,8000))});}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return sections.length?sections:result('README・マニフェスト','該当なし');
}
async function dependencies(workspace){
  const root=await realpath(workspace);let raw;
  try{raw=await safeRead(root,'package.json');}catch(error){if(error.code==='ENOENT')return result('依存関係','package.json がありません');throw error;}
  if(!raw)return result('依存関係','package.json を読み取れません');
  let data;try{data=JSON.parse(raw);}catch{throw bad('package.json の形式が不正です');}
  const lines=[];
  for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies']){
    const entries=Object.entries(data[field]||{}).slice(0,150);
    if(entries.length)lines.push(`${field}:\n${entries.map(([name,version])=>`${name}: ${String(version).slice(0,100)}`).join('\n')}`);
  }
  return result('依存関係',lines.join('\n\n'));
}
async function diagnostics(workspace){
  const {root,files}=await filesIn(workspace);const findings=[`走査したテキストファイル: ${files.length}${files.length>=maxFiles?'（上限）':''}`];
  for(const name of ['package.json','README.md','.gitignore']){
    try{await lstat(join(root,name));findings.push(`${name}: あり`);}catch{findings.push(`${name}: なし`);}
  }
  try{JSON.parse(await safeRead(root,'package.json'));findings.push('package.json: JSON正常');}
  catch(error){if(error.code!=='ENOENT')findings.push('package.json: JSON解析失敗');}
  return result('プロジェクト診断',findings.join('\n'));
}
async function script(workspace,id,executor,approval,signal){
  if(!approval||approval.id!==id||typeof approval.manifestHash!=='string')
    throw bad('実行前のプレビューと承認が必要です',403);
  const plan=await previewProjectCommand(id,workspace);
  if(plan.workspace!==approval.workspace||plan.manifestHash!==approval.manifestHash)
    throw bad('プレビュー後にpackage.jsonが変更されました。内容を確認して再承認してください',409);
  const name=id==='project-test'?'test':'lint';
  const isWindows=process.platform==='win32';
  try{
    // Fixed npm script names only; never interpolate user input into cmd.exe.
    // Works for standard npm, npm-installed Node and Scoop Node. Packaged
    // Electron itself does not provide npm or Node for project test/lint.
    const command=isWindows?'cmd.exe':'npm';
    const args=isWindows?['/d','/s','/c','npm run '+name]:['run',name];
    // npm may execute lifecycle scripts. The last manifest check is
    // best-effort: another process could still modify it before npm reads it.
    const output=await (executor||executeBoundedProcess)(command,args,{
      cwd:plan.workspace,timeout:60_000,maxBuffer:1_000_000,windowsHide:true,
      encoding:'utf8',shell:false,signal
    });
    return result('npm run '+name,[output.stdout,output.stderr].filter(Boolean).join('\n'));
  }catch(error){
    if(error.status)throw error;
    const message=error.code==='EXEC_STOPPED'?error.message:
      error.killed?'実行がタイムアウトしました':
      String(error.stdout||error.stderr||error.message).slice(0,1000);
    throw bad(isWindows&&/not recognized|見つかりません|ENOENT/i.test(message)?
      'テスト/Lintには別途Node.jsとnpmが必要です。GUI・チャット機能には不要です。 '+message:message);
  }
}

export async function previewProjectCommand(id,workspace){
  if(!['project-test','project-lint'].includes(id))throw bad('対象外のコマンドです',404);
  const name=id==='project-test'?'test':'lint';
  const root=await realpath(workspace);let raw,data;
  try{
    raw=await safeRead(root,'package.json');
    if(raw===null)throw bad('package.json を読み取れません');
    data=JSON.parse(raw);
  }catch{throw bad('package.json を読み取れません');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw bad('package.json の形式が不正です');
  const scripts=data.scripts;
  const main=scripts?.[name];
  if(typeof main!=='string'||!main.trim()||main.length>2000)
    throw bad('npm '+name+' スクリプトがありません、または長すぎます');
  const steps=[];
  for(const key of ['pre'+name,name,'post'+name]){
    const value=scripts?.[key];
    if(value===undefined)continue;
    if(typeof value!=='string'||value.length>2000)throw bad(key+' の形式または長さが不正です');
    steps.push({name:key,script:value});
  }
  return {
    command:'npm run '+name,script:main,steps,workspace:root,
    manifestHash:createHash('sha256').update(raw).digest('hex'),
    warning:'Codex利用枠の消費なし。ただしnpmスクリプトはファイル変更・外部通信・API課金を行う場合があります。'
  };
}

export const projectToolSpecs=[
  {id:'code-search',name:'コード検索',icon:'🔎',category:'プロジェクト',description:'文字列でコードを検索（rg、未導入時は内蔵検索）',input:'query',readOnly:true},
  {id:'todo-scan',name:'TODO点検',icon:'📌',category:'プロジェクト',description:'TODO・FIXME・HACKの位置を確認',readOnly:true},
  {id:'project-tree',name:'構成ツリー',icon:'🌲',category:'プロジェクト',description:'プロジェクトのテキストファイルを一覧表示',readOnly:true},
  {id:'project-preview',name:'概要と設定',icon:'📄',category:'プロジェクト',description:'READMEと主要マニフェストを表示',readOnly:true},
  {id:'dependencies',name:'依存関係',icon:'📦',category:'プロジェクト',description:'package.jsonの依存関係を表示',readOnly:true},
  {id:'project-diagnostics',name:'構成診断',icon:'🩺',category:'プロジェクト',description:'ファイル数と主要設定の状態を確認',readOnly:true},
  {id:'project-test',name:'テスト実行',icon:'🧪',category:'プロジェクト',description:'承認後に npm run test を実行（ファイル変更・外部通信の可能性）',approvalCommand:'npm run test',readOnly:false},
  {id:'project-lint',name:'Lint実行',icon:'🧹',category:'プロジェクト',description:'承認後に npm run lint を実行（ファイル変更・外部通信の可能性）',approvalCommand:'npm run lint',readOnly:false}
];
export async function runProjectTool(id,{workspace,input={},executor,approval,signal}={}){
  const spec=projectToolSpecs.find(x=>x.id===id);if(!spec)throw bad('未対応のローカルアイテムです',404);
  if(typeof workspace!=='string'||!workspace)throw bad('ワークスペースが未設定です');
  if(!input||typeof input!=='object'||Array.isArray(input))throw bad('入力形式が不正です');
  const allowed=spec.input?['query']:spec.approvalCommand?['approvalToken']:[];
  if(Object.keys(input).some(key=>!allowed.includes(key)))throw bad('このアイテムには指定できないパラメータがあります');
  if(activeRuns>=3)throw bad('ローカル処理が混雑しています',429);
  activeRuns++;
  try{
  const started=Date.now();let sections;
  if(id==='code-search')sections=await search(workspace,searchQuery(input),executor||exec);
  else if(id==='todo-scan')sections=result('TODO・FIXME・HACK',(await scan(workspace,line=>/\b(?:TODO|FIXME|HACK)\b/.test(line))).join('\n'));
  else if(id==='project-tree')sections=result('構成ツリー',(await filesIn(workspace)).files.map(x=>x.replace(/\\/g,'/')).join('\n'));
  else if(id==='project-preview')sections=await preview(workspace);
  else if(id==='dependencies')sections=await dependencies(workspace);
  else if(id==='project-diagnostics')sections=await diagnostics(workspace);
  else sections=await script(workspace,id,executor,approval,signal);
  let fileCount=0;
  if(id==='project-tree')fileCount=sections[0].output==='(該当なし)'?0:sections[0].output.split('\n').filter(line=>line&&!line.startsWith('…')).length;
  else if(id==='project-preview')fileCount=sections[0].heading==='README・マニフェスト'?0:sections.length;
  else if(id==='dependencies')fileCount=sections[0].output.includes('dependencies:')||sections[0].output.includes('devDependencies:')?1:0;
  else if(['code-search','todo-scan'].includes(id))fileCount=new Set(sections[0].output.split('\n').map(line=>line.match(/^(.+?):\d+: /)?.[1]).filter(Boolean)).size;
  return {id,name:spec.name,executionKind:'local',codexTurnStarted:false,sections,fileCount,elapsedMs:Date.now()-started};
  }finally{activeRuns--;}
}
