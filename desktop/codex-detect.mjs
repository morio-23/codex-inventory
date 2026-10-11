import {stat,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,dirname,delimiter,extname,normalize,win32} from 'node:path';

const allowedExtensions=new Set(['.exe','.cmd','.bat']);
const MAX_PROBE_MS=6500;

const dirsFromPath=(value='')=>value.split(delimiter).filter(Boolean).map(s=>s.replace(/^"|"$/g,''));
// Keep the path supplied by the user/native picker intact. In particular,
// path.resolve('\\tmp\\tool.exe') would prepend the current Windows drive.
// Normalize only for deduplication, not to change the chosen executable path.
const unique=(values)=>{
  const seen=new Set(),output=[];
  for(const value of values){
    if(typeof value!=='string'||!value)continue;
    const normalized=normalize(value);
    const key=win32.isAbsolute(normalized)?win32.normalize(normalized).toLowerCase():normalized;
    if(seen.has(key))continue;
    seen.add(key);output.push(normalized);
  }
  return output;
};

export function codexCandidates({env=process.env,platform=process.platform,preferred=null}={}){
  if(platform!=='win32')return [];
  const home=env.USERPROFILE||env.HOME||'';
  const appdata=env.APPDATA||'';
  const local=env.LOCALAPPDATA||'';
  const scoop=env.SCOOP||join(home,'scoop');
  const npmPrefix=env.npm_config_prefix||'';
  const cliDirs=[
    ...dirsFromPath(env.Path||env.PATH||''),
    home&&join(home,'.local','bin'),
    home&&join(home,'.codex','bin'),
    appdata&&join(appdata,'npm'),
    local&&join(local,'npm'),
    local&&join(local,'Microsoft','WinGet','Links'),
    home&&join(scoop,'shims'),
    home&&join(scoop,'apps','nodejs-lts','current','bin'),
    home&&join(scoop,'apps','nodejs','current','bin'),
    npmPrefix,
  ];
  const fixed=[preferred,env.CODEX_BIN].filter(p=>typeof p==='string'&&allowedExtensions.has(extname(p).toLowerCase()));
  return unique([...fixed,...cliDirs.filter(x=>x&&x!=='.').flatMap(dir=>[
    join(dir,'codex.exe'),join(dir,'codex.cmd'),join(dir,'codex.bat')
  ])]).filter(x=>allowedExtensions.has(extname(x).toLowerCase()));
}

export async function probeExecutable(command,args,{
  env=process.env,timeoutMs=MAX_PROBE_MS,spawnProcess=spawn
}={}){
  return new Promise((resolve)=>{
    let child,output='',settled=false;
    const done=(result)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      resolve(result);
    };
    try{
      child=spawnProcess(command,args,{
        env,stdio:['ignore','pipe','pipe'],windowsHide:true,
        shell:process.platform==='win32'&&/^codex\.(cmd|bat)$/i.test(command)
      });
    }catch(error){resolve({ok:false,error:error.message});return;}
    const timer=setTimeout(()=>{
      try{child.kill();}catch{}
      done({ok:false,error:'起動確認がタイムアウトしました'});
    },timeoutMs);
    child.stdout?.on('data',chunk=>{output=(output+chunk.toString()).slice(0,2048);});
    child.stderr?.on('data',chunk=>{output=(output+chunk.toString()).slice(0,2048);});
    child.once('error',error=>done({ok:false,error:error.message}));
    child.once('close',code=>done({
      ok:code===0&&/(?:codex-cli|codex)\s+(?:v)?\d+\.\d+/i.test(output),
      version:output.trim().slice(0,160),code
    }));
  });
}
export function commandForCandidate(path,{env=process.env,platform=process.platform}={}){
  const ext=extname(path).toLowerCase();
  if(!allowedExtensions.has(ext))throw new Error('Codex CLI以外のファイル形式は選択できません');
  if(platform!=='win32'||ext==='.exe')return {command:path,env};
  // npm and Scoop wrappers are Windows .cmd/.bat files. Run a fixed
  // command basename through the Windows shell, with a controlled PATH.
  // Never build a shell command using the complete user-selectable path.
  const basename=ext==='.bat'?'codex.bat':'codex.cmd';
  if(!path.toLowerCase().endsWith('\\'+basename)&&!path.toLowerCase().endsWith('/'+basename))
    throw new Error('codex.cmd / codex.bat のみ指定できます');
  return {command:basename,env:{
    ...env,Path:dirname(path)+delimiter+(env.Path||env.PATH||''),
    PATH:dirname(path)+delimiter+(env.Path||env.PATH||'')
  }};
}
/** Best-effort only: some Codex Desktop builds contain a compatible sidecar.
 * Never invoke Codex.exe (the graphical app) as if it were a CLI.
 * Traversal is bounded and skips symlinks to avoid walking arbitrary drives.
 */
export async function findDesktopCodexBinaries({
  env=process.env,platform=process.platform,maxVisited=1400
}={}){
  if(platform!=='win32')return [];
  const local=env.LOCALAPPDATA||'';
  // Store installations often keep an executable local runtime outside
  // Program Files/WindowsApps, where direct process execution may be denied.
  // The package suffix may change, so inspect only the direct Packages entries.
  const packageRoots=[];
  if(local){
    try{
      const packages=await readdir(join(local,'Packages'),{withFileTypes:true});
      for(const entry of packages){
        if(entry.isDirectory()&&/^OpenAI\.Codex_[a-z0-9._-]+$/i.test(entry.name)){
          const localCodex=join(local,'Packages',entry.name,'LocalCache','Local','OpenAI','Codex');
          packageRoots.push(join(localCodex,'bin'),join(localCodex,'resources'));
        }
      }
    }catch{}
  }
  const roots=[
    local&&join(local,'OpenAI','Codex','bin'),
    local&&join(local,'Programs','Codex','resources'),
    local&&join(local,'Codex','resources'),
    local&&join(local,'OpenAI','Codex','resources'),
    ...packageRoots,
    env.ProgramFiles&&join(env.ProgramFiles,'Codex','resources'),
    env.PROGRAMFILES&&join(env.PROGRAMFILES,'Codex','resources')
  ].filter(Boolean);
  const result=[];
  let visited=0;
  for(const root of unique(roots)){
    const queue=[{dir:root,depth:0}];
    while(queue.length&&visited<maxVisited){
      const current=queue.shift();
      let entries;
      try{entries=await readdir(current.dir,{withFileTypes:true});}
      catch{continue;}
      visited+=entries.length;
      for(const entry of entries){
        // Codex.exe at a resources root is the GUI, not the App Server CLI.
        // Only the lowercase codex.exe binary is a CLI candidate. A root
        // cache bin directory can legitimately contain it directly.
        const binRoot=/[\\/]bin$/i.test(root);
        if(entry.isFile()&&entry.name==='codex.exe'&&(current.depth>0||binRoot))
          result.push(join(current.dir,entry.name));
        if(entry.isDirectory()&&current.depth<6&&
          !['cache','logs','locales','temp','chrome','chromeextensions'].includes(entry.name.toLowerCase()))
          queue.push({dir:join(current.dir,entry.name),depth:current.depth+1});
      }
    }
  }
  return unique(result);
}

export async function detectCodex({
  env=process.env,platform=process.platform,preferred=null,excluded=[],
  exists=async p=>{try{return (await stat(p)).isFile();}catch{return false;}},
  probe=probeExecutable,
}={}){
  const candidates=codexCandidates({env,platform,preferred});
  const failures=[];
  let pending=[...candidates],scannedSidecars=false;
  while(pending.length||!scannedSidecars){
    if(!pending.length){
      scannedSidecars=true;
      pending=(await findDesktopCodexBinaries({env,platform})).filter(p=>!candidates.includes(p));
      continue;
    }
    const candidate=pending.shift();
    if(excluded.some(value=>typeof value==='string'&&value.toLowerCase()===candidate.toLowerCase()))continue;
    if(!await exists(candidate))continue;
    const invocation=commandForCandidate(candidate,{env,platform});
    const result=await probe(invocation.command,['--version'],{env:invocation.env});
    if(result.ok)return {path:candidate,version:result.version,...invocation};
    failures.push({path:candidate,reason:result.error||result.version||'CLI起動失敗'});
  }
  return {path:null,failures};
}
