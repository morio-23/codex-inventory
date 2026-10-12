// Backend activity snapshots may contain extra fields. Keep warning state
// limited to thread IDs so paths and workspaces cannot reach the display.
export function conflictCandidates(state){
  if(!Array.isArray(state?.workspaceConflicts))return [];
  return state.workspaceConflicts.flatMap(group=>{
    if(group?.reason!=='parallel-edits'||!Array.isArray(group.threadIds))return [];
    const ids=[...new Set(group.threadIds.filter(id=>typeof id==='string'&&id))];
    return ids.length>1?[ids]:[];
  });
}
