import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot=dirname(dirname(fileURLToPath(import.meta.url)));
const expectedVersion='0.7.0-beta.1';
const expectedSetup='CodexInventory-Setup-${version}-${arch}.${ext}';
const expectedPortable='CodexInventory-Portable-${version}-${arch}.${ext}';

export function validateLocalBuildVersion({root,rootLock,desktop,desktopLock,appServerSource,htmlSource,serverSource}){
  const versions=[root?.version,rootLock?.version,rootLock?.packages?.['']?.version,
    desktop?.version,desktopLock?.version,desktopLock?.packages?.['']?.version];
  if(!versions.every(version=>version===expectedVersion)){
    throw new Error('BUILD_VERSION_MISMATCH: root, desktop and both npm lockfiles must agree');
  }
  if(root.name!=='codex-inventory'||desktop.name!=='codex-inventory-desktop'||
      rootLock.packages[''].name!==root.name||desktopLock.packages[''].name!==desktop.name){
    throw new Error('BUILD_PACKAGE_NAME_MISMATCH');
  }
  if(!Array.isArray(desktop?.build?.win?.target)||
    !['nsis','portable'].every(t=>desktop.build.win.target.includes(t))||
    desktop.build.win.target.length!==2||
    desktop.build.nsis?.artifactName!==expectedSetup||
    desktop.build.portable?.artifactName!==expectedPortable){
    throw new Error('BUILD_TARGET_MISMATCH: both Setup and Portable must be configured');
  }
  // The desktop bundles this source via extraResources but not root package.json.
  // Keep its wire client version aligned without relying on file lookup at runtime.
  if(!appServerSource.includes("version:'"+expectedVersion+"'")){
    throw new Error('BUILD_RPC_CLIENT_VERSION_MISMATCH');
  }
  // A stale hardcoded v0.6 UI banner hid whether a newly built EXE was being
  // tested. Guard the visible version and the server's startup banner too.
  if(typeof htmlSource!=='string' ||
    !htmlSource.includes('LOCAL CODEX CONTROLLER / V'+expectedVersion.toUpperCase()) ||
    typeof serverSource!=='string' ||
    !serverSource.includes('Codex Inventory v'+expectedVersion+': http://')){
    throw new Error('BUILD_VISIBLE_VERSION_MISMATCH');
  }
  return expectedVersion;
}

function loadInputs(rootPath=repoRoot){
  const json=p=>JSON.parse(readFileSync(join(rootPath,p),'utf8'));
  return {
    root:json('package.json'),
    rootLock:json('package-lock.json'),
    desktop:json('desktop/package.json'),
    desktopLock:json('desktop/package-lock.json'),
    appServerSource:readFileSync(join(rootPath,'app-server-client.mjs'),'utf8'),
    htmlSource:readFileSync(join(rootPath,'public/index.html'),'utf8'),
    serverSource:readFileSync(join(rootPath,'server.mjs'),'utf8')
  };
}

export function verifyLocalBuildVersion(rootPath=repoRoot){
  return validateLocalBuildVersion(loadInputs(rootPath));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const version=verifyLocalBuildVersion();
    console.log('BUILD_VERSION_OK: '+version+' (Setup + Portable)');
  }catch(error){
    console.error(error.message.startsWith('BUILD_')?error.message:'BUILD_VERSION_PREFLIGHT_FAILED');
    process.exitCode=2;
  }
}
