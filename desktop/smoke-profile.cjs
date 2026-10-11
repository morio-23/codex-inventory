'use strict';
const {lstatSync,mkdirSync,realpathSync}=require('node:fs');
const {resolve,relative,isAbsolute,sep,join}=require('node:path');

function inside(root,target){
  const path=relative(root,target);
  return path!==''&&path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);
}

function isolatedSmokeProfile({env=process.env,argv=process.argv,tempRoot}={}){
  const requested=env.CODEX_INVENTORY_SMOKE_PROFILE;
  if(!requested)return null;
  if(!argv.includes('--inventory-isolated-smoke'))
    throw new Error('隔離スモークは --inventory-isolated-smoke が必要です');
  if(typeof tempRoot!=='string'||!tempRoot)
    throw new Error('隔離スモークの一時ディレクトリが不正です');
  const root=realpathSync(resolve(tempRoot));
  const target=resolve(requested);
  if(!inside(root,target))throw new Error('隔離スモークの保存先が一時ディレクトリの外です');
  // Check each existing component before creating the next one. A symlink in
  // the path must never redirect directory creation into a real user profile.
  const parts=relative(root,target).split(sep);
  let current=root;
  for(const part of parts){
    current=join(current,part);
    try{
      const info=lstatSync(current);
      if(info.isSymbolicLink()||!info.isDirectory())
        throw new Error('隔離スモークの保存先が一時ディレクトリの外です');
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      mkdirSync(current);
    }
  }
  const canonical=realpathSync(target);
  if(!inside(root,canonical))throw new Error('隔離スモークの保存先が一時ディレクトリの外です');
  return canonical;
}
module.exports={isolatedSmokeProfile};
