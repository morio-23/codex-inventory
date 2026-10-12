// Local-only, no network calls, no printing of matched sensitive content.
// Scans proposed changes against an explicit base branch and uncommitted changes.
import {execFileSync} from 'node:child_process';

const base=process.argv[2]||'main';
const run=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']});
function comparisonBase(){
  run(['rev-parse','--verify',base]);
  try{run(['merge-base',base,'HEAD']);return base;}
  catch(error){
    if(base!=='main')throw error;
    run(['rev-parse','--verify','origin/main']);
    run(['merge-base','origin/main','HEAD']);
    console.log('Local main has no common ancestor; comparing against origin/main.');
    return 'origin/main';
  }
}
const checks=[
  ['API key / secret',/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{18,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Windows profile path',/[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9_.-]{2,}/i],
  ['Unix home path',/(?:\/home\/|\/Users\/)[a-z][a-z0-9_.-]{2,}\//i],
  ['Personal email',/[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)|test\.invalid)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i],
  ['Credential-bearing URL',/https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/i],
  ['Private key / bearer token',/\b(?:Bearer\s+[A-Za-z0-9._-]{24,}|password\s*[:=]\s*['"][^'"]{8,})/i]
];
function scan(label,patch){
  let path='unknown',hunks=0,findings=[];
  for(const line of patch.split(/\r?\n/)){
    if(line.startsWith('+++ b/')){path=line.slice(6);hunks=0;continue;}
    if(line.startsWith('@@')){hunks++;continue;}
    if(!line.startsWith('+')||line.startsWith('+++'))continue;
    const value=line.slice(1);
    for(const [category,pattern] of checks){
      if(pattern.test(value))findings.push({file:path,hunk:hunks,category,section:label});
    }
  }
  return findings;
}
let findings=[];
try{
  const resolvedBase=comparisonBase();
  findings.push(...scan('commits',run(['diff','--no-ext-diff','--unified=0',resolvedBase+'...HEAD','--'])));
  findings.push(...scan('staged',run(['diff','--cached','--no-ext-diff','--unified=0','--'])));
  findings.push(...scan('working',run(['diff','--no-ext-diff','--unified=0','--'])));
}catch(error){
  console.error('Unable to audit Git diff. Check repository and base branch before publishing.');
  process.exitCode=2;
}
const byLocation=new Map();
for(const f of findings){
  const key=[f.section,f.file,f.hunk,f.category].join(' / ');
  byLocation.set(key,f);
}
if(byLocation.size){
  console.error('Potential private content in changed lines (values intentionally suppressed):');
  for(const f of byLocation.values())console.error([f.section,f.file,'hunk '+f.hunk,f.category].join(' | '));
  console.error('Review privately. Do not publish without removing or confirming each match.');
  process.exitCode=1;
}else if(!process.exitCode)console.log('PASS: no configured PII/credential signatures in the proposed diff (manual review still required).');
