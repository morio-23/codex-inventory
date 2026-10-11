import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=dirname(fileURLToPath(import.meta.url));
export function inventoryFromLocks(sources){
  const entries=[];
  for(const {scope,lock} of sources){
    if(lock.lockfileVersion!==3||!lock.packages||typeof lock.packages!=='object')
      throw new Error(scope+': unsupported or malformed npm lockfile');
    for(const [location,pkg] of Object.entries(lock.packages)){
      if(!location.includes('node_modules/')||!pkg.version)continue;
      const name=location.slice(location.lastIndexOf('node_modules/')+'node_modules/'.length);
      if(!name)continue;
      entries.push({scope,name,version:pkg.version,
        declaredLicense:typeof pkg.license==='string'?pkg.license:'REVIEW_REQUIRED',
        dev:pkg.dev===true,optional:pkg.optional===true,packagePath:location});
    }
  }
  entries.sort((a,b)=>a.scope.localeCompare(b.scope)||a.name.localeCompare(b.name)||
    a.version.localeCompare(b.version)||a.packagePath.localeCompare(b.packagePath));
  return {notice:'Review aid ONLY; lockfile declarations are not license texts or a distribution rights audit.',
    requiresReview:entries.filter(p=>p.declaredLicense==='REVIEW_REQUIRED').length,packages:entries};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=resolve(process.argv[2]||resolve(projectRoot,'dist','THIRD_PARTY_REVIEW.json'));
  const sources=[];
  for(const [scope,file] of [['root','package-lock.json'],['desktop','desktop/package-lock.json']])
    sources.push({scope,lock:JSON.parse(await readFile(resolve(projectRoot,file),'utf8'))});
  const report=inventoryFromLocks(sources);
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  process.stdout.write('License inventory: '+report.packages.length+' package entries, '+
    report.requiresReview+' missing declarations. Manual notice review still required.\n');
}
