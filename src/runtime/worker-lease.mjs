export function startWorkerLease({renew,controller,setTimer=setInterval,clearTimer=clearInterval}){
 let stopped=false;const pending=new Set();
 const timer=setTimer(()=>{if(stopped)return;const renewal=Promise.resolve().then(renew).catch(()=>{if(!stopped)controller.abort();}).finally(()=>pending.delete(renewal));pending.add(renewal);},20000);
 return ()=>{if(!stopped){stopped=true;clearTimer(timer);}return Promise.all([...pending]);};
}
