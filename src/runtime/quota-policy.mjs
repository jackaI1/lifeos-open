export const provisionalPolicy=Object.freeze({telemetryMaxAgeMs:120000,schoolCostPercent:2,safetyPercent:10,optionalJobPercent:2,schoolJobPercent:2,maxJobMs:180000,optionalSpacingMs:60000});
const windows=b=>[b?.primary,b?.secondary].filter(Boolean);
export function discoverBuckets(response){
 const buckets=response?.rateLimitsByLimitId??(response?.rateLimits?.limitId?{[response.rateLimits.limitId]:response.rateLimits}:{});
 const spark=Object.values(buckets).filter(b=>b.limitName?.toLowerCase()==='fast-model');
 const general=response?.rateLimits?.limitId&&buckets[response.rateLimits.limitId];
 return {general:general&&!/spark/i.test(general.limitName??'')?general:null,spark:spark.length===1?spark[0]:null};
}
function valid(b,now){return !!b&&windows(b).length>0&&windows(b).every(w=>Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0&&Number.isFinite(w.resetsAt)&&w.resetsAt*1000>now);}
function exhausted(b){return windows(b).some(w=>w.usedPercent>=100);}
export function quotaDecision({telemetry,models,category,now=Date.now(),workerAvailable=true,policy=provisionalPolicy,scheduledWindows=[],reservations=[],lastOptionalAt=0,model='demo-ai',needsTools=false,needsImages=false,interactive=false}){
 const deny=(mode,reason,resetAt=null)=>({allowed:false,mode,reason,resetAt,model:null});
 if(!workerAvailable)return deny('worker-unavailable','waiting for computer');
 if(!telemetry||telemetry.authentication!=='chatgpt'||!Number.isFinite(telemetry.checkedAt)||telemetry.checkedAt>now+5000||now-telemetry.checkedAt>policy.telemetryMaxAgeMs)return deny('telemetry-unavailable','waiting for a current quota check');
 const {general,spark}=discoverBuckets(telemetry.limits);
 if(!valid(general,now))return deny('telemetry-unavailable','waiting for a current general quota check');
 const essential=['lecture-study','assignment-brief'].includes(category);
 const active=reservations.filter(r=>r.expiresAt>now);
 if(active.length)return deny('busy','waiting for the current LifeOS AI job');
 const resetAt=Math.max(...windows(general).filter(w=>w.usedPercent>=100).map(w=>w.resetsAt*1000),0)||null;
 const supported=id=>models?.some(m=>m.model===id&&m.supportedReasoningEfforts?.some(e=>e.reasoningEffort==='low'));
 if(exhausted(general)){
  if(!essential)return deny('general-exhausted','waiting for general quota reset',resetAt);
  if(!valid(spark,now)||exhausted(spark)||!supported('fast-model'))return deny('both-unavailable','essential interpretation is waiting; manual handoff is available',resetAt);
  if(needsTools||needsImages)return deny('general-exhausted','this job needs tools or images unavailable in the Spark fallback',resetAt);
  return {allowed:true,mode:'spark-emergency',reason:'using Spark emergency fallback',model:'fast-model',effort:'low',maxJobMs:policy.maxJobMs,reserve:[],resetAt};
 }
 if(!supported(model))return deny('model-unavailable','configured general model or effort is unavailable');
 const reserve=windows(general).map(w=>{
  const count=scheduledWindows.filter(at=>at>=now&&at<w.resetsAt*1000).length;
  return {durationMins:w.windowDurationMins,resetsAt:w.resetsAt,remaining:100-w.usedPercent,required:Math.min(100,count*policy.schoolCostPercent+policy.safetyPercent),scheduledUpdates:count};
 });
 const withinReserve=reserve.some(w=>w.remaining-w.required<policy.optionalJobPercent);
 if(!essential&&!interactive&&withinReserve)return {...deny('school-reserve','general allowance reserved for school'),reserve};
 if(!essential&&!interactive&&now-lastOptionalAt<policy.optionalSpacingMs)return deny('normal','optional backlog is being released gradually');
 if(essential&&reserve.some(w=>w.remaining<policy.schoolJobPercent))return {...deny('school-reserve','remaining general allowance is below this bounded school allocation'),reserve};
 return {allowed:true,mode:interactive?'interactive':withinReserve?'school-reserve':'normal',reason:interactive?'owner-started conversation or study request':essential?'essential school update':'optional work above school reserve',model,effort:'low',maxJobMs:policy.maxJobMs,reserve,resetAt:null};
}

/** Quota deltas are observed account-wide movement, not exact per-job attribution. */
export function observedUsage(before,after){
 const a=discoverBuckets(before),b=discoverBuckets(after),out=[];
 for(const key of ['general','spark'])for(const w of windows(a[key])){const match=windows(b[key]).find(v=>v.windowDurationMins===w.windowDurationMins&&v.resetsAt===w.resetsAt);if(match)out.push({bucket:a[key].limitId,durationMins:w.windowDurationMins,resetsAt:w.resetsAt,observedPercentDelta:Math.max(0,match.usedPercent-w.usedPercent),attribution:'account-wide; concurrent sessions and rounding may affect this delta'});}
 return out;
}
