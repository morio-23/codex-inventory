import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {projectToolSpecs,runProjectTool} from './project-tools.mjs';

const execFileAsync=promisify(execFile);
const maxOutput=32_000;
const actionSpecs=[
  {id:'git-status',name:'差分確認の巻物',icon:'📜',category:'Git',description:'変更状況・ステージ済みと未ステージの差分量を確認',steps:[
    ['変更状況',['status','--porcelain=v1','--untracked-files=normal']],
    ['未ステージの変更量',['diff','--no-ext-diff','--stat']],
    ['ステージ済みの変更量',['diff','--no-ext-diff','--cached','--stat']]
  ]},
  {id:'git-changes',name:'変更ファイルの地図',icon:'🗺️',category:'Git',description:'ステージ済み・未ステージのファイル変更を一覧表示',steps:[
    ['未ステージのファイル',['diff','--no-ext-diff','--name-status']],
    ['ステージ済みのファイル',['diff','--no-ext-diff','--cached','--name-status']]
  ]},
  {id:'git-history',name:'コミット履歴の書',icon:'📖',category:'Git',description:'直近25コミットを表示',steps:[
    ['直近のコミット',['log','-n','25','--date=short','--format=%h %ad %s']]
  ]},
  {id:'git-branches',name:'ブランチの羅針盤',icon:'🧭',category:'Git',description:'現在のブランチと追跡先を表示',steps:[
    ['ローカルブランチ',['branch','-vv','--no-color']]
  ]},
  {id:'git-untracked',name:'未追跡ファイル探知機',icon:'🔍',category:'Git',description:'Gitで未追跡のファイル名を表示',steps:[
    ['未追跡のファイル',['ls-files','--others','--exclude-standard']]
  ]},
  {id:'git-conflicts',name:'競合の探知棒',icon:'⚔️',category:'Git',description:'マージ競合のあるファイル名を表示',steps:[
    ['競合ファイル',['diff','--no-ext-diff','--name-only','--diff-filter=U']]
  ]},
  {id:'git-staged',name:'ステージの鏡',icon:'🪞',category:'Git',description:'次のコミットに含まれる変更量とファイルを確認',steps:[
    ['ステージ済み変更量',['diff','--no-ext-diff','--cached','--stat']],
    ['ステージ済みファイル',['diff','--no-ext-diff','--cached','--name-status']]
  ]},
  {id:'tracked-files',name:'ファイルツリーの地図',icon:'🌳',category:'プロジェクト',description:'Git追跡下のファイル名を一覧表示',steps:[
    ['追跡ファイル',['ls-files']]
  ]}
];
const byId=new Map(actionSpecs.map(item=>[item.id,item]));
let inProgress=0;

export function listLocalTools(){
  return [
    ...actionSpecs.map(({id,name,icon,category,description})=>({id,name,icon,category,description,readOnly:true})),
    ...projectToolSpecs.map(({id,name,icon,category,description,input,readOnly,approvalCommand})=>({id,name,icon,category,description,input,readOnly,approvalCommand}))
  ].map(item=>({...item,executionKind:'local',costLabel:item.approvalCommand?'Codex利用枠は消費しませんが、npm実行時に外部API課金・ファイル変更・外部通信の可能性があります':'この操作ではCodex利用枠の消費なし'}));
}

export async function runLocalTool(id,{workspace,executor,input={},approval,signal}={}){
  if(projectToolSpecs.some(item=>item.id===id))return runProjectTool(id,{workspace,executor,input,approval,signal});
  const spec=byId.get(id);
  if(!spec)throw Object.assign(new Error('未対応のローカルアイテムです'),{status:404});
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw Object.assign(new Error('このアイテムにはパラメータを渡せません'),{status:400});
  if(typeof workspace!=='string'||!workspace)throw Object.assign(new Error('ワークスペースが未設定です'),{status:400});
  if(inProgress>=3)throw Object.assign(new Error('ローカル処理が混雑しています'),{status:429});
  inProgress++;
  const started=Date.now();
  const sections=[];
  const env={...process.env,GIT_PAGER:'cat',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_NOSYSTEM:'1'};
  try{
    for(const [heading,args] of spec.steps){
      try{
        const result=await (executor||execFileAsync)('git',['-c','core.quotePath=false',...args],{
          cwd:resolve(workspace),env,timeout:8000,maxBuffer:1_000_000,
          windowsHide:true,encoding:'utf8',shell:false
        });
        const stdout=typeof result==='string'?result:result.stdout||'';
        sections.push({heading,output:stdout.length>maxOutput?stdout.slice(0,maxOutput)+'\n…表示上限に達したため省略しました':stdout||'(該当なし)'});
      }catch(error){
        const message=error.code==='ENOENT'?'Gitがインストールされていません':error.killed?'処理がタイムアウトしました':(error.stderr||error.message||'実行に失敗しました');
        throw Object.assign(new Error(String(message).slice(0,1000)),{status:400});
      }
    }
    const fileSections=sections.filter(section=>/ファイル|変更状況/.test(section.heading));
    const fileCount=new Set(fileSections.flatMap(section=>section.output==='(該当なし)'?[]:section.output.split(/\r?\n/).filter(line=>line&&!line.startsWith('…')))).size;
    return {id,name:spec.name,executionKind:'local',codexTurnStarted:false,sections,fileCount,elapsedMs:Date.now()-started};
  }finally{inProgress--;}
}
