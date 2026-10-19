import {LectureClock} from './lecture-core.js';
/** Midpoint clock sampling avoids dependence on either device's wall clock. */
export function alignedLectureClock(snapshot,{sent,received,now=()=>performance.now()}={}){
 const uncertaintyMs=Math.max(0,(received-sent)/2),base=snapshot.offsetMs+uncertaintyMs;
 const clock=new LectureClock({base,epochId:snapshot.epochId,now,eventTimestamps:true});clock.shared=true;clock.uncertaintyMs=uncertaintyMs;return clock;
}
export async function connectLectureClock({request,store,id,high}){
 let device=await store.get('lecture-device');if(!device){device={id:crypto.randomUUID()};await store.put('lecture-device',device);}
 const sent=performance.now(),snapshot=await request('/api/lectures/'+id+'/capture',{method:'POST',body:{operation:'connect',deviceId:device.id,offsetMs:high,mutationId:crypto.randomUUID()}}),received=performance.now();
 if(received-sent>4000)throw Error('The connection was too slow to align both devices. Reopen the lecture when the connection is stable.');const clock=alignedLectureClock(snapshot,{sent,received});return {clock,deviceId:device.id,snapshot};
}

export function ownsLectureCapture(capture){return Boolean(capture?.deviceId&&capture?.snapshot?.recorderDevice===capture.deviceId);}
