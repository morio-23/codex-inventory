'use strict';

// Keep the menu restricted to native editing roles: never execute page text,
// clipboard content, shell commands, links, or application actions.
function contextMenuItems(params,locale='ja'){
  const editable=params?.isEditable===true;
  const selected=typeof params?.selectionText==='string'&&params.selectionText.length>0;
  if(!editable&&!selected)return [];
  const en=locale==='en';
  const item=(role,jaLabel,enLabel)=>({role,label:en?enLabel:jaLabel});
  if(!editable)return [
    item('copy','コピー','Copy'),
    {type:'separator'},
    item('selectAll','すべて選択','Select All')
  ];
  return [
    item('undo','元に戻す','Undo'),
    item('redo','やり直す','Redo'),
    {type:'separator'},
    item('cut','切り取り','Cut'),
    item('copy','コピー','Copy'),
    item('paste','貼り付け','Paste'),
    {type:'separator'},
    item('selectAll','すべて選択','Select All')
  ];
}
module.exports={contextMenuItems};
