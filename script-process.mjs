import {spawn} from 'node:child_process';

/**
 * Runs an approved npm script with shell:false, bounded output and a deadline.
 * Child processes in the POSIX process group are signalled on timeout/abort.
 * Windows uses taskkill /T /F to stop the npm process tree.
 * Scripts which detach their own daemons can outlive any process-tree cleanup.
 */
export function executeBoundedProcess(command,args,{cwd,env=process.env,timeout=60_000,maxBuffer=1_000_000,signal}={}){
  return new Promise((resolve,reject)=>{
    let child,finished=false,stoppingReason=null,stdout='',stderr='',bytes=0;
    let deadline,escalation,hardStop;
    const windows=process.platform==='win32';
    function stop(reason){
      if(stoppingReason||finished||!child)return;
      stoppingReason=reason;
      if(windows){
        // taskkill is best-effort. Fall back if Windows cannot locate the PID.
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
        killer.on('error',()=>{try{child.kill('SIGKILL');}catch{}});
        killer.on('close',code=>{if(code!==0)try{child.kill('SIGKILL');}catch{}});
      }else{
        try{process.kill(-child.pid,'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}
        escalation=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1200);
        escalation.unref?.();
      }
      // A detached descendant might keep stdio pipes open even after npm
      // exits. Do not let an HTTP request wait indefinitely for "close".
      hardStop=setTimeout(()=>{
        if(finished)return;
        try{child.stdout?.destroy();child.stderr?.destroy();child.kill('SIGKILL');}catch{}
        finished=true;clearTimeout(deadline);clearTimeout(escalation);clearTimeout(hardStop);
        signal?.removeEventListener('abort',onAbort);
        reject(Object.assign(new Error(reason),{code:'EXEC_STOPPED',stdout,stderr}));
      },4000);
    }
    function add(chunk,target){
      const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      bytes+=value.length;
      if(bytes>maxBuffer){stop('コマンド出力が上限を超えたため停止しました');return;}
      if(target==='stdout')stdout+=value.toString('utf8');
      else stderr+=value.toString('utf8');
    }
    const onAbort=()=>stop('実行がキャンセルされました');
    try{
      child=spawn(command,args,{cwd,env,windowsHide:true,shell:false,detached:!windows,stdio:['ignore','pipe','pipe']});
    }catch(error){reject(error);return;}
    child.stdout?.on('data',part=>add(part,'stdout'));
    child.stderr?.on('data',part=>add(part,'stderr'));
    deadline=setTimeout(()=>stop('コマンドがタイムアウトしました'),timeout);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();
    child.once('error',error=>{
      if(finished)return;
      finished=true;clearTimeout(deadline);clearTimeout(escalation);clearTimeout(hardStop);
      signal?.removeEventListener('abort',onAbort);
      reject(error);
    });
    child.once('close',(code,signalName)=>{
      if(finished)return;
      finished=true;clearTimeout(deadline);clearTimeout(escalation);clearTimeout(hardStop);
      signal?.removeEventListener('abort',onAbort);
      if(stoppingReason){
        reject(Object.assign(new Error(stoppingReason),{code:'EXEC_STOPPED',stdout,stderr}));return;
      }
      if(code!==0){
        reject(Object.assign(new Error('npmコマンドが失敗しました'),{code,signal:signalName,stdout,stderr}));return;
      }
      resolve({stdout,stderr});
    });
  });
}
