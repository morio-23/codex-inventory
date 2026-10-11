/**
 * Version-tolerant adapter for the official Codex App Server model/list catalog.
 * Preserve the order that the server advertises: the available effort values
 * (including future levels) are model-specific, not a global fixed enum.
 */
const selectionError=(message,status=400)=>Object.assign(new Error(message),{status});
export function normalizeModelCatalog(response){
  if(!Array.isArray(response?.data))
    throw selectionError('Codex App Serverからモデル一覧を取得できません',503);
  const seen=new Set(),models=[];
  for(const row of response.data){
    if(!row||row.hidden===true)continue;
    const id=typeof row.model==='string'&&row.model.trim()?row.model.trim():
      typeof row.id==='string'?row.id.trim():'';
    if(!id||id.length>128||seen.has(id))continue;
    seen.add(id);
    const efforts=[];
    for(const option of Array.isArray(row.supportedReasoningEfforts)?row.supportedReasoningEfforts:[]){
      const value=typeof option==='string'?option:option?.reasoningEffort;
      if(typeof value!=='string'||!value.trim()||value.length>64||efforts.some(x=>x.id===value))continue;
      efforts.push({
        id:value,
        description:typeof option?.description==='string'?option.description.slice(0,200):''
      });
    }
    const defaultEffort=typeof row.defaultReasoningEffort==='string'?
      row.defaultReasoningEffort:null;
    models.push({
      id,
      label:typeof row.displayName==='string'&&row.displayName.trim()?
        row.displayName.slice(0,100):id,
      default:row.isDefault===true,
      defaultEffort:efforts.some(x=>x.id===defaultEffort)?defaultEffort:null,
      efforts
    });
  }
  const defaultModel=models.find(x=>x.default)?.id||models[0]?.id||null;
  return {models,defaultModel};
}
export function resolveModelSelection(catalog,{model=null,effort=null}={}){
  // Omitting both options respects the current thread's inherited settings.
  const m=model===null||model===''?null:model;
  const e=effort===null||effort===''?null:effort;
  if(m!==null&&(typeof m!=='string'||m.length>128))throw selectionError('モデルの指定が不正です');
  if(e!==null&&(typeof e!=='string'||e.length>64))throw selectionError('推論レベルの指定が不正です');
  if(m===null&&e===null)return {};
  const selected=catalog.models.find(x=>x.id===(m||catalog.defaultModel));
  if(!selected)throw selectionError('このモデルは現在利用できません。モデル一覧を更新してください');
  if(e!==null&&!selected.efforts.some(x=>x.id===e))
    throw selectionError('選択したモデルは推論レベル '+e+' に対応していません。モデルの対応レベルから選んでください');
  // Switching models while inheriting an old thread effort can result in
  // an unsupported (model,effort) pair and stall some Codex versions.
  // An explicitly selected model therefore always carries an advertised
  // default effort when the user has not selected a custom level.
  const chosenEffort=e||(m!==null?(selected.defaultEffort||selected.efforts[0]?.id):null);
  return {model:selected.id,...(chosenEffort?{effort:chosenEffort}:{})};
}
