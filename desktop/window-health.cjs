'use strict';

// The renderer probe returns only fixed booleans/numbers. Never return DOM
// text, project names, URLs, paths, or raw console output from real profiles.
const RENDER_PROBE = `(() => {
  const shell=document.querySelector('main.shell');
  const topbar=document.querySelector('header.topbar');
  const threads=document.getElementById('thread-list');
  const quest=document.getElementById('primary-pane');
  const bounds=shell?.getBoundingClientRect();
  const css=getComputedStyle(document.body);
  return {
    structure: Boolean(shell && topbar && threads && quest),
    size: Boolean(bounds && bounds.width >= 200 && bounds.height >= 100),
    visible: Boolean(shell && getComputedStyle(shell).display !== 'none' &&
      getComputedStyle(shell).visibility !== 'hidden'),
    stylesheet: document.styleSheets.length > 0 &&
      css.backgroundImage !== 'none',
    startup: document.documentElement.dataset.inventoryBoot || 'pending'
  };
})()`;

function classifyDocumentHealth(result) {
  if (!result || typeof result !== 'object' || result.structure !== true)
    return 'UI_DOCUMENT_MISSING';
  if (result.size !== true || result.visible !== true)
    return 'UI_NOT_VISIBLE';
  if (result.stylesheet !== true)
    return 'UI_STYLES_MISSING';
  if (result.startup === 'failed')
    return 'UI_RENDERER_INIT_FAILED';
  if (result.startup !== 'ready')
    return 'UI_RENDERER_NOT_READY';
  return 'UI_READY';
}

// NativeImage.toBitmap() is a 4-byte-per-pixel bitmap. Sample its pixels and
// count coarse color buckets; a truly empty uniform window has one bucket.
// This is a smoke-only check, not a screenshot file or an image export.
function countVisualColorBuckets(bitmap, width, height) {
  if (!Buffer.isBuffer(bitmap) || !Number.isInteger(width) ||
    !Number.isInteger(height) || width < 60 || height < 60 ||
    bitmap.length < width*height*4) return 0;
  const buckets=new Set();
  for (let y=1;y<13;y++) {
    for (let x=1;x<17;x++) {
      const ix=Math.floor(width*x/17),iy=Math.floor(height*y/13);
      const offset=(iy*width+ix)*4;
      const b=bitmap[offset]>>5,g=bitmap[offset+1]>>5,r=bitmap[offset+2]>>5;
      buckets.add(`${r}:${g}:${b}`);
    }
  }
  return buckets.size;
}

module.exports={RENDER_PROBE,classifyDocumentHealth,countVisualColorBuckets};
