import {readFileSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=dirname(dirname(fileURLToPath(import.meta.url)));
export const requiredUiResources=Object.freeze([
  'public/index.html','public/styles.css','public/app.js',
  'public/markdown.js','public/split-pane.js','public/activity-feed-state.js',
  'public/display-labels.js','public/conflict-warning-state.js',
  'public/inventory-state.js','public/i18n.js','public/strings.en.js',
  'public/templates.en.js'
]);

export function inspectUiResources(root){
  for(const name of requiredUiResources){
    try{
      const file=join(root,name);
      if(!statSync(file).isFile()||statSync(file).size<64)return 'PACKAGED_UI_ASSET_MISSING';
    }catch{return 'PACKAGED_UI_ASSET_MISSING';}
  }
  try{
    const html=readFileSync(join(root,'public/index.html'),'utf8');
    const css=readFileSync(join(root,'public/styles.css'),'utf8');
    if(!html.includes('<main class="shell">')||
      !html.includes('src="/app.js"')||
      !html.includes('href="/styles.css"')||
      !css.includes('.shell')||!css.includes('.topbar'))
      return 'PACKAGED_UI_CONTENT_INVALID';
  }catch{return 'PACKAGED_UI_CONTENT_INVALID';}
  return 'PACKAGED_UI_ASSETS_OK';
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const base=process.argv[2]||join(repository,'dist','win-unpacked','resources','inventory');
  const result=inspectUiResources(base);
  if(result==='PACKAGED_UI_ASSETS_OK')console.log(result+': 12 HTML/CSS/JS resources present');
  else{
    console.error(result);
    process.exitCode=2;
  }
}
