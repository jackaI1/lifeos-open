// A failed connection cannot turn Finish into a lost or forgotten request.
export function lectureFinisher({store,id,work,changed=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 const key='finish-intent:'+id;let intent=null,running=null,timer=null,failures=0,dead=false;
 async function retry(){if(dead||!intent)return;if(running)return running;clearTimer(timer);timer=null;changed('saving');
  running=(async()=>{try{const current=intent;await store.put(key,current);await work(current);if(intent===current){await store.remove(key);intent=null;failures=0;changed('saved');}}catch(error){changed('waiting',error);if(!dead)timer=setTimer(()=>retry(),Math.min(300000,15000*2**Math.min(failures++,5)));}finally{running=null;if(intent&&!timer&&!dead)timer=setTimer(()=>retry(),0);}})();return running;
 }
 return {settled:()=>running,get pending(){return !!intent;},async request(){intent={at:new Date().toISOString()};return retry();},reopen(){intent={at:null};if(running)void store.put(key,intent).catch(e=>changed('waiting',e));return retry();},async resume(){const saved=await store.get(key);intent??=saved;if(intent)return retry();},retry,destroy(){dead=true;clearTimer(timer);}};
}
