export const elapsedTime=(s,now=Date.now())=>Math.max(0,s.elapsedMs+(s.state==='running'?Math.max(0,now-s.runningSince):0));
export const timerReading=(s,now=Date.now())=>{const total=elapsedTime(s,now),target=s.durationMs??0;return {total,target,extra:target?Math.max(0,total-target):0,display:target&&total<target?target-total:target?total-target:total,overtime:!!target&&total>=target};};
export function startTime({title='Untitled',category='Other',target=null,durationMs=0,automatic=false},now=Date.now()){
 return {title,category,target,durationMs,automatic,startedAt:now,runningSince:now,elapsedMs:0,state:'running',finishedAt:null,changedAt:now};
}
export function changeTime(s,action,now=Date.now()){
 if(s.state==='finished')return s;
 if(action==='pause'&&s.state==='running')return {...s,elapsedMs:elapsedTime(s,now),runningSince:null,state:'paused',changedAt:Math.max(now,s.changedAt+1)};
 if(action==='resume'&&s.state==='paused')return {...s,runningSince:now,state:'running',changedAt:Math.max(now,s.changedAt+1)};
 if(action==='finish')return {...s,elapsedMs:elapsedTime(s,now),runningSince:null,state:'finished',finishedAt:now,changedAt:Math.max(now,s.changedAt+1)};
 return s;
}
export function formatTimer(ms){const seconds=Math.max(0,Math.floor(ms/1000)),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60);return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(seconds%60).padStart(2,'0');}
export function taskTimingSummary(sessions,tasks=[]){
 const groups=new Map();for(const row of sessions){const s=row.data??row;if(s.state!=='finished'||s.target?.kind!=='task')continue;const task=tasks.find(t=>t.id===s.target.id),d=task?.data??task;if(!d||!['complete','completed','submitted'].includes(d.status))continue;const g=groups.get(task.id)??{taskId:task.id,courseId:d.courseId,totalMs:0,estimateMinutes:d.estimatedMinutes??null};g.totalMs+=s.elapsedMs;groups.set(task.id,g);}
 return [...groups.values()].map(g=>({...g,actualMinutes:Math.round(g.totalMs/60000),estimateRatio:g.estimateMinutes?g.totalMs/60000/g.estimateMinutes:null}));
}
