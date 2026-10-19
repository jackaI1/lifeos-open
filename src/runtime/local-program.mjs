import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {LocalInferenceSettledFailure} from './local-inference-gate.mjs';

const failed=()=>new LocalInferenceSettledFailure('local_recognition_failed');
const uncertain=()=>Object.assign(Error('local_inference_uncertain'),{code:'local_inference_uncertain'});
function localEnvironment(){
 const env={PYTHONIOENCODING:'utf-8'};
 for(const [key,value] of Object.entries(process.env))if(['systemroot','windir','path','temp','tmp','home','userprofile'].includes(key.toLowerCase()))env[key]=value;
 return env;
}

/** Run one owned child. Never return diagnostics, args or raw errors on failure.
 * A signal sent to a process is not evidence that it stopped: retain the caller's
 * inference slot until observed close, or return uncertainty for quarantine.
 */
export async function runLocalProgram(executable,args,{timeoutMs=600_000,maxOutput=2_000_000,termGraceMs=1000,killGraceMs=3000,spawnImpl=spawn}={}){
 if(typeof executable!=='string'||!isAbsolute(executable)||!Array.isArray(args)||args.length>1000||args.some(a=>typeof a!=='string'||a.includes('\0'))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>3_600_000||!Number.isInteger(maxOutput)||maxOutput<1||maxOutput>8_000_000||!Number.isInteger(termGraceMs)||termGraceMs<1||termGraceMs>10_000||!Number.isInteger(killGraceMs)||killGraceMs<1||killGraceMs>10_000||typeof spawnImpl!=='function')throw failed();
 let child;
 try{child=spawnImpl(executable,args,{windowsHide:true,shell:false,env:localEnvironment(),stdio:['ignore','pipe','pipe']});}catch{throw failed();}
 return new Promise((resolve,reject)=>{
  let settled=false,started=Number.isInteger(child.pid),terminating=false,exited=false,bytes=0;
  const output=[];let timeout,termTimer,killTimer,closeTimer;
  const finish=(error)=>{
   if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(termTimer);clearTimeout(killTimer);clearTimeout(closeTimer);
   if(error){output.length=0;reject(error);}else{
    try{resolve(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(output)));}
    catch{output.length=0;reject(failed());}
   }
  };
  const signal=name=>{if(exited)return;try{child.kill(name);}catch{ /* Keep waiting for real close. */ }};
  const terminate=()=>{
   if(terminating||settled)return;terminating=true;output.length=0;if(exited)return;
   termTimer=setTimeout(()=>{
    if(settled)return;
    killTimer=setTimeout(()=>finish(uncertain()),killGraceMs);
    signal('SIGKILL');
   },termGraceMs);
   signal('SIGTERM');
  };
  child.once('spawn',()=>{started=true;});
  child.on('error',error=>{
   if(!started&&!child.pid&&['ENOENT','EACCES','ENOEXEC','ENOTDIR','EINVAL'].includes(error.code)){finish(failed());return;}
   terminate();
  });
  child.once('exit',()=>{
   if(settled)return;exited=true;clearTimeout(timeout);clearTimeout(termTimer);clearTimeout(killTimer);
   closeTimer=setTimeout(()=>finish(uncertain()),killGraceMs);
  });
  child.once('close',(code,exitSignal)=>finish(code===0&&!exitSignal&&!terminating?null:failed()));
  for(const [stream,capture] of [[child.stdout,true],[child.stderr,false]]){stream.on('error',terminate);stream.on('data',chunk=>{
   if(settled||terminating)return;
   bytes=Math.min(maxOutput+1,bytes+chunk.length);
   if(bytes>maxOutput){terminate();return;}
   if(capture)output.push(Buffer.from(chunk));
  });}
  timeout=setTimeout(terminate,timeoutMs);
 });
}
