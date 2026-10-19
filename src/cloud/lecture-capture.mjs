import {AppError} from '../shared/errors.mjs';import * as v from '../server/validation.mjs';import {digest} from './store.mjs';
export async function lectureCaptureRoute({store,req,id,json,change}){
 const lecture=await store.get('lecture',v.identifier(id));if(!lecture)throw new AppError('Lecture not found',404);const old=await store.get('lecture-capture',id),now=Date.now(),view=r=>({epochId:r.data.epochId,offsetMs:r.data.baseOffset+Math.max(0,now-r.data.anchorAt),recorderDevice:r.data.recorderDevice??null,recorderState:r.data.recorderState??'idle',seenAt:r.data.seenAt??null,serverAt:now,nextSegment:r.data.nextSegment??1,finishRequestedAt:r.data.finishRequestedAt??null,pauseRequestedAt:r.data.pauseRequestedAt??null});
 if(req.method==='GET')return Response.json(old?view(old):{unlinked:true,serverAt:now});if(req.method!=='POST')throw new AppError('Method not allowed',405);
 const b=await json(req);v.exactFields(b,['operation','deviceId','offsetMs','mutationId','state','nextSegment']);v.identifier(b.deviceId);v.enumValue(b.operation,['connect','claim','heartbeat','release','finish','resume-notes','pause']);const mid=v.mutationId(b.mutationId),fp={capture:id,b};const prior=await store.mutation(mid,await digest(JSON.stringify(fp)));if(prior)return Response.json(prior);
 let data=old?.data,finishedLecture=null;
 if(b.operation==='connect'){
  if(old&&now-data.anchorAt<12*3600000)return Response.json(view(old));v.number(b.offsetMs,0,43200000);
  if(data?.recorderDevice)throw new AppError('Stop and sync the existing recorder before starting a new capture timeline.',409);
  const highest=await store.sql("SELECT MAX(CAST(json_extract(data,'$.lastOffsetMs') AS REAL)) AS high FROM records WHERE kind='lecture-page' AND id>=? AND id<?",id+'-p-',id+'-p-~').first();const clips=await store.sql("SELECT MAX(CAST(json_extract(data,'$.endMs') AS REAL)) AS high FROM records WHERE kind='lecture-clip' AND id>=? AND id<?",id+'-a-',id+'-a-~').first();
  data={baseOffset:Math.max(b.offsetMs,highest?.high??0,clips?.high??0),anchorAt:now,epochId:crypto.randomUUID(),recorderDevice:null,recorderState:'idle'};
 }else if(b.operation==='pause'){
  if(!old)throw new AppError('Capture not found',404);data={...data,pauseRequestedAt:new Date(now).toISOString()};
 }else if(b.operation==='resume-notes'){
  if(!old)throw new AppError('Capture not found',404);data={...data,finishRequestedAt:null};
 }else if(b.operation==='finish'){
  if(!old)throw new AppError('Connect this lecture before finishing',409);
  if(data.finishRequestedAt)return Response.json(view(old));
  if(!data.recorderDevice)return Response.json(view(old));
  data={...data,finishRequestedAt:new Date(now).toISOString()};
 }else{
  if(!old)throw new AppError('Connect this lecture before recording',409);
  if(data.recorderDevice&&data.recorderDevice!==b.deviceId)throw new AppError('Another device owns this lecture recording. Stop and sync it there before switching microphones.',409,'recorder-owned');
  if(b.operation==='claim'){if(data.finishRequestedAt)throw new AppError('This lecture is finishing.',409);const clip=await store.sql("SELECT MAX(CAST(json_extract(data,'$.id') AS INTEGER)) AS n FROM records WHERE kind='lecture-clip' AND id>=? AND id<?",id+'-a-',id+'-a-~').first();data={...data,recorderDevice:b.deviceId,recorderState:'recording',pauseRequestedAt:null,seenAt:now,nextSegment:Math.max(data.nextSegment??1,(clip?.n??0)+1)};}
  else if(b.operation==='heartbeat'){if(data.recorderDevice!==b.deviceId)throw new AppError('This device is not the recorder',409);v.enumValue(b.state,['recording','paused','uploading']);if(now-(data.seenAt??0)<45000&&data.recorderState===b.state)return Response.json(view(old));data={...data,recorderState:b.state,seenAt:now};}
  else{if(data.recorderDevice!==b.deviceId)throw new AppError('This device is not the recorder',409);v.number(b.nextSegment,1,501);if(!Number.isInteger(b.nextSegment))throw new AppError('Invalid audio sequence');const unsaved=await store.sql("SELECT id FROM records WHERE kind='lecture-clip' AND id>=? AND id<? AND json_extract(data,'$.status')!='saved' LIMIT 1",id+'-a-',id+'-a-~').first();if(unsaved)throw new AppError('Sync the remaining audio before releasing this microphone.',409);if(data.finishRequestedAt){const clips=await store.sql("SELECT COUNT(*) AS n,MAX(CAST(json_extract(data,'$.endMs') AS REAL)) AS high FROM records WHERE kind='lecture-clip' AND id>=? AND id<?",id+'-a-',id+'-a-~').first();finishedLecture=change('lecture',id,lecture,{...lecture.data,endedAt:lecture.data.endedAt??data.finishRequestedAt??new Date(now).toISOString(),lastOffsetMs:Math.max(lecture.data.lastOffsetMs??0,clips?.high??0),expectedSegments:clips?.n??0,localRecovery:false,recordingStatus:clips?.n?'available':'notes-only'});}data={...data,recorderDevice:null,recorderState:'idle',seenAt:now,nextSegment:Math.max(data.nextSegment??1,b.nextSegment),finishRequestedAt:null};}
 }
 const c=change('lecture-capture',id,old,data);return Response.json(await store.commit({id:mid,fingerprint:fp,changes:[c,...(finishedLecture?[finishedLecture]:[])],result:view(c.after)}));
}
