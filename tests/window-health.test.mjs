import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectUiResources,requiredUiResources} from '../scripts/check-packaged-ui.mjs';

const require=createRequire(import.meta.url);
const {RENDER_PROBE,classifyDocumentHealth,countVisualColorBuckets}=
  require('../desktop/window-health.cjs');
const root=dirname(dirname(fileURLToPath(import.meta.url)));

test('source UI assets match explicit packaged inventory',()=>{
  assert.equal(requiredUiResources.length,12);
  assert.equal(inspectUiResources(root),'PACKAGED_UI_ASSETS_OK');
  assert.equal(inspectUiResources(join(root,'__nonexistent-ui__')),'PACKAGED_UI_ASSET_MISSING');
});

test('packaged Electron includes render guard',()=>{
  const pkg=require('../desktop/package.json');
  assert.ok(pkg.build.files.includes('window-health.cjs'));
  assert.match(RENDER_PROBE,/querySelector\('main\.shell'\)/);
  assert.match(RENDER_PROBE,/getComputedStyle/);
});

test('a missing or invisible app never reports render success',()=>{
  assert.equal(classifyDocumentHealth(null),'UI_DOCUMENT_MISSING');
  assert.equal(classifyDocumentHealth({structure:false,size:true,visible:true,stylesheet:true}),'UI_DOCUMENT_MISSING');
  assert.equal(classifyDocumentHealth({structure:true,size:false,visible:true,stylesheet:true}),'UI_NOT_VISIBLE');
  assert.equal(classifyDocumentHealth({structure:true,size:true,visible:false,stylesheet:true}),'UI_NOT_VISIBLE');
  assert.equal(classifyDocumentHealth({structure:true,size:true,visible:true,stylesheet:false}),'UI_STYLES_MISSING');
  assert.equal(classifyDocumentHealth({structure:true,size:true,visible:true,stylesheet:true}),'UI_READY');
});

test('uniform blank framebuffer is distinguishable from a real multicolor UI',()=>{
  const w=170,h=130;
  const blank=Buffer.alloc(w*h*4,23);
  assert.equal(countVisualColorBuckets(blank,w,h),1);
  const rendered=Buffer.from(blank);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const offset=(y*w+x)*4;
    rendered[offset]=((x*3)>>0)&255;
    rendered[offset+1]=((y*3)>>0)&255;
    rendered[offset+2]=((x+y)*4)&255;
  }
  assert.ok(countVisualColorBuckets(rendered,w,h)>5);
  assert.equal(countVisualColorBuckets(Buffer.alloc(0),w,h),0);
});
