import {el,button,field,select,modal,busy,toast} from './ui.js';
import {controlIcon} from './quiet-controls.js';
import {startTime,changeTime,timerReading,formatTimer,taskTimingSummary} from './task-time.js';

export function timerContext(ctx){
 const route=location.hash.slice(1).split('?')[0],q=new URLSearchParams(location.hash.split('?')[1]||'');
 const work=ctx.records('coursework').find(r=>r.id===q.get('work')),id=q.get('brief')||q.get('task')||work?.data.taskId;
 const task=ctx.records('task').find(r=>r.id===id),course=ctx.records('course').find(r=>r.id===task?.data.courseId);
 if(task)return {title:[course?.data.code,task.data.title].filter(Boolean).join(' · '),category:'Academics',target:{kind:'task',id:task.id}};
 if(route==='devotional')return {title:'Devotional',category:'Devotional',target:q.get('entry')?{kind:'devotional',id:q.get('entry')}:null};
 if(route==='exercise')return {title:'Run · '+(q.get('day')||ctx.date()),category:'Exercise',target:null};
 if(route==='prayer')return {title:'Prayer',category:'Prayer',target:{kind:'prayer',id:ctx.date()}};
 return {title:'',category:route==='school'?'Academics':'Other',target:null};
}
export function createTaskTimers(ctx,{now=()=>Date.now()}={}){
 const rows=new Map(),listeners=new Set(),sending=new Map(),storing=new Map(),preserving=new Map(),recoveryFailures=new Map(),ensuring=new Map(),presence=new Map(),resumeOnVisible=new Set();
 let loading,lastRead=0,historyCursor=null,route=globalThis.location?.hash??'',generation=0,visible=!globalThis.document?.hidden,disposed=false;
 const changed=()=>listeners.forEach(f=>f());
 const samePage=r=>presence.get(r.id)?.route===route;
 async function saveRow(row){
  const copy={...row};delete copy.localDurable;const saved=(storing.get(row.id)??Promise.resolve()).catch(()=>{}).then(()=>ctx.store.put('task-time:'+row.id,copy));storing.set(row.id,saved);
  try{row.localDurable=(await saved)!==false;return row.localDurable;}finally{if(storing.get(row.id)===saved)storing.delete(row.id);}
 }
 async function requirePreserved(id){
  // A recovery owns this session until its original is durable. Other sessions stay independent.
  try{for(let pending=preserving.get(id);pending;pending=preserving.get(id)){await pending;if(preserving.get(id)===pending)break;}}catch{throw Error('This device could not preserve the previous timer. Keep this page open and try again.');}
  if(recoveryFailures.get(id)?.failed)throw Error('This device could not preserve the previous timer. Keep this page open and try again.');
 }
 async function persist(id,data,localDone=()=>{}){
  if(preserving.has(id)||recoveryFailures.get(id)?.failed)await requirePreserved(id);
  const row={id,data,pending:true,localDurable:false};rows.set(id,row);await saveRow(row);localDone();changed();
  const delivery=(sending.get(id)??Promise.resolve()).catch(()=>{}).then(()=>ctx.outbox.submit('/api/time-sessions/'+encodeURIComponent(id),{data}));sending.set(id,delivery);
  let result;try{result=await delivery;}finally{if(sending.get(id)===delivery)sending.delete(id);}
  const current=rows.get(id),remote=result.item;
  if(remote&&!(current?.data.state==='finished'&&remote.data.state!=='finished')&&(remote.data.state==='finished'||remote.data.startedAt!==data.startedAt||remote.data.changedAt>=(current?.data.changedAt??0))){
   // Only an exact acknowledgement of this page's current Start/Resume may remain running.
   const ownClock=current?.data.state==='running'&&visible&&!disposed&&samePage(current)&&Object.keys(data).every(k=>JSON.stringify(remote.data[k])===JSON.stringify(data[k])&&JSON.stringify(current.data[k])===JSON.stringify(data[k]));
   if(remote.data.state==='running'&&!ownClock)await restore(remote,{deliver:false});
   else{rows.set(id,remote);await saveRow(remote);changed();}
  }
  if(rows.get(id)===row&&result.durable===true)row.localDurable=true;changed();return rows.get(id);
 }
 async function retainPresence(id,value){presence.set(id,value);await ctx.store.put('timer-presence:'+id,value);}
 function safePause(row,at=now()){
  const seen=presence.get(row.id)?.lastSeenAt;
  // A lost page/sleep interval is not evidence of time spent. Preserve its original snapshot separately.
  const measuredAt=seen!=null&&at-seen<=15000?at:Math.max(row.data.runningSince,seen??row.data.runningSince);
  const paused=changeTime(row.data,'pause',measuredAt);
  return {...paused,changedAt:Math.max(at,row.data.changedAt+1)};
 }
 async function restore(row,{deliver=true}={}){
  if(row.data.state!=='running'){rows.set(row.id,row);return;}
  // Publish the conservative pause before any asynchronous archive read; a later action must win.
  const prior=recoveryFailures.get(row.id),stopped=prior?.failed&&prior.row===row?prior.pausedData:safePause(row,presence.get(row.id)?.lastSeenAt??row.data.runningSince),paused={id:row.id,data:{...stopped,changedAt:Math.max(now(),stopped.changedAt)},pending:true,localDurable:false};if(rows.get(row.id)?.data.state!=='finished'){rows.set(row.id,paused);changed();}
  const snapshot={row:structuredClone(row),recoveredAt:now()},key='recovery:timer:'+row.id;
  const saved=(preserving.get(row.id)??Promise.resolve()).catch(()=>{}).then(async()=>{
   const failed=recoveryFailures.get(row.id);if(failed?.failed&&failed.key){if(await ctx.store.put(failed.key,failed.snapshot)===false)throw Error('Timer preservation failed');recoveryFailures.delete(row.id);if(failed.row===row)return;}
   const attempt={row,snapshot,pausedData:structuredClone(paused.data),key:null,deliver,failed:false};recoveryFailures.set(row.id,attempt);
   try{const original=await ctx.store.get?.(key);attempt.key=original?key+':'+crypto.randomUUID():key;if(await ctx.store.put(attempt.key,snapshot)===false)throw Error('Timer preservation failed');recoveryFailures.delete(row.id);}
   catch(error){attempt.failed=true;throw error;}
  });preserving.set(row.id,saved);
  try{await saved;}catch{paused.localDurable=false;changed();toast('This device could not preserve the previous timer. Keep this page open and try again.');return;}finally{if(preserving.get(row.id)===saved)preserving.delete(row.id);}
  if(rows.get(row.id)!==paused)return;
  // A conflicting ACK is kept paused on device; do not create an unbounded reconciliation loop.
  if(!deliver){await saveRow(paused);changed();return;}
  // Navigation needs the local pause, not a server response. Delivery remains serialized per session.
  await new Promise(resolve=>{void persist(row.id,paused.data,resolve).catch(resolve);});
 }
 const ready=(async()=>{const [items,clocks]=await Promise.all([ctx.store.list('task-time:'),ctx.store.list('timer-presence:')]);for(const {key,value}of clocks)presence.set(key.slice('timer-presence:'.length),value);for(const {value}of items)await restore(value);changed();})();
 async function refresh(force=false){await ready;if(disposed)return;for(const failure of [...recoveryFailures.values()])if(failure.failed)await restore(failure.row,{deliver:failure.deliver});if([...recoveryFailures.values()].some(f=>f.failed)||ctx.state.online===false)return;if(loading)return loading;if(!force&&now()-lastRead<60000)return;
  loading=(async()=>{try{const result=await ctx.request('/api/time-sessions');historyCursor=result.next;for(const row of result.items){const local=rows.get(row.id);if(local?.data.state==='finished'&&row.data.state!=='finished')continue;if(!local||row.data.state==='finished'&&local.data.state!=='finished'||row.data.changedAt>local.data.changedAt){if(row.data.state==='running')await restore(row);else{rows.set(row.id,row);await saveRow(row);}}}lastRead=now();changed();}catch{}finally{loading=null;}})();return loading;
 }
 async function start(options,{retainCreated,canStart,resumeOnVisibility=true}={}){
  const token=generation,scope=route;
  const {title,category,target,durationMs,automatic}=startTime(options,0);
  const captured=structuredClone({title,category,target,durationMs,automatic});
  if(retainCreated!==undefined&&typeof retainCreated!=='function')throw TypeError('Timer association must use a retention callback.');
  if(canStart!==undefined&&typeof canStart!=='function')throw TypeError('Timer start guard must be a function.');
  if(typeof resumeOnVisibility!=='boolean')throw TypeError('Timer visibility policy must be a boolean.');
  const allowed=()=>{
   if(disposed||token!==generation||scope!==route||!visible)return false;
   if(!canStart)return true;
   const verdict=canStart();
   // Intent is synchronous. Observe a refused asynchronous result without ever accepting it later.
   if(verdict&&typeof verdict.then==='function'){Promise.resolve(verdict).catch(()=>{});return false;}
   return verdict===true&&!disposed&&token===generation&&scope===route&&visible;
  };
  await ready;
  if(!allowed())return;
  const id=crypto.randomUUID();
  // A caller may retain its exact recipe/step association before this ID becomes a running clock.
  if(retainCreated){
   const retained=await retainCreated({id,routeHash:scope,options:structuredClone(captured)});
   if(retained!==true)throw Error('This device could not retain the timer association. Keep this page open and try again.');
   if(!allowed())return;
  }
  await retainPresence(id,{route:scope,lastSeenAt:now(),resumeOnVisibility});
  if(!allowed())return;
  return persist(id,startTime(captured,now()));
 }
 function ensure(target,title,category){const key=JSON.stringify([target.kind,target.id,route,generation]);if(ensuring.has(key))return ensuring.get(key);const operation=ensureCurrent(target,title,category).finally(()=>{if(ensuring.get(key)===operation)ensuring.delete(key);});ensuring.set(key,operation);return operation;}
 async function ensureCurrent(target,title,category){const token=generation,scope=route;await refresh();if(disposed||token!==generation||scope!==route||!visible)return;
  let row=[...rows.values()].find(r=>r.data.automatic&&r.data.state!=='finished'&&r.data.target?.kind===target.kind&&r.data.target.id===target.id);
  if(row){if(preserving.has(row.id)||recoveryFailures.get(row.id)?.failed)await requirePreserved(row.id);if(disposed||token!==generation||scope!==route||!visible||rows.get(row.id)!==row)return;const meta=presence.get(row.id);await retainPresence(row.id,{...meta,route:scope,lastSeenAt:now()});if(disposed||token!==generation||scope!==route||!visible||rows.get(row.id)!==row)return;if(meta?.userPaused)return row;return row.data.state==='paused'?persist(row.id,changeTime(row.data,'resume',now())):row;}
  const base='auto-'+target.kind+'-'+target.id,id=rows.has(base)?base+'-'+crypto.randomUUID():base,at=now();await retainPresence(id,{route:scope,lastSeenAt:at});if(disposed||token!==generation||scope!==route||!visible)return;return persist(id,startTime({title,category,target,automatic:true},now()));
 }
 async function update(id,action){const token=generation,scope=route;await ready;const row=rows.get(id);if(!row)return;if(action==='pause'&&row.data.state!=='running')return row;if(action==='resume'&&(disposed||token!==generation||scope!==route||!visible||!samePage(row)))return row;
  const next=action==='pause'?safePause(row):changeTime(action==='finish'&&row.data.state==='running'?safePause(row):row.data,action,now());if(next===row.data)return row;
  if(preserving.has(id)||recoveryFailures.get(id)?.failed)await requirePreserved(id);
  const current=rows.get(id);if(current?.data.state==='finished')return current;if(action==='resume'&&(current!==row||disposed||token!==generation||scope!==route||!visible||!samePage(current)))return current;
  resumeOnVisible.delete(id);const retained=retainPresence(id,{...presence.get(id),route:scope,lastSeenAt:now(),userPaused:action==='pause'});
  if(action!=='resume'){const delivery=persist(id,next);await Promise.all([retained,delivery]);return rows.get(id);}
  await retained;if(rows.get(id)!==row||disposed||token!==generation||scope!==route||!visible)return rows.get(id);
  return persist(id,next);
 }
 // Only an intentional project action may carry its paused session to that project's current URL.
 async function resumeProject(id,projectId){
  const token=generation,scope=route;await ready;
  const [page,query='']=scope.replace(/^#/,'').split('?'),selectedId=new URLSearchParams(query).get('project');
  const selected=ctx.records('project').find(r=>r.id===selectedId),row=rows.get(id);
  if(page!=='tickets'||!(selectedId===projectId||selected?.data.canonicalProjectId===projectId)||row?.data.target?.kind!=='project'||row.data.target.id!==projectId||row.data.automatic||row.data.state!=='paused'||disposed||!visible||token!==generation||scope!==route)return row;
  if(preserving.has(id)||recoveryFailures.get(id)?.failed)await requirePreserved(id);
  if(rows.get(id)!==row||disposed||!visible||token!==generation||scope!==route)return rows.get(id);
  await retainPresence(id,{...presence.get(id),route:scope,lastSeenAt:now(),userPaused:false});
  if(rows.get(id)!==row||disposed||!visible||token!==generation||scope!==route)return rows.get(id);
  return update(id,'resume');
 }
 async function suspend(){const pending=[];for(const r of rows.values())if(r.data.state==='running'){pending.push(new Promise(resolve=>{void persist(r.id,safePause(r),resolve).catch(resolve);}));}changed();return Promise.all(pending);}
 async function leaveRoute(){generation++;resumeOnVisible.clear();await ready;return suspend();}
 async function enterRoute(value){route=value;generation++;await ready;changed();}
 async function setVisible(value){if(visible===value)return;visible=value;const token=++generation,scope=route;await ready;
  if(!value){for(const r of rows.values())if(r.data.state==='running'&&samePage(r)&&presence.get(r.id)?.resumeOnVisibility!==false)resumeOnVisible.add(r.id);await suspend();}
  else{if(disposed||token!==generation||scope!==route||!visible)return;const ids=[...resumeOnVisible];resumeOnVisible.clear();for(const id of ids){const r=rows.get(id);if(r?.data.state==='paused'&&samePage(r)&&!presence.get(id)?.userPaused){if(preserving.has(id)||recoveryFailures.get(id)?.failed)await requirePreserved(id);if(disposed||token!==generation||scope!==route||!visible||rows.get(id)!==r)continue;await retainPresence(id,{...presence.get(id),lastSeenAt:now()});if(disposed||token!==generation||scope!==route||!visible||rows.get(id)!==r)continue;await persist(id,changeTime(r.data,'resume',now()));}}changed();}
 }
 async function checkpoint(){await ready;if(disposed||!visible)return;for(const r of rows.values())if(r.data.state==='running'){
  const meta=presence.get(r.id);if(!samePage(r)||now()-(meta?.lastSeenAt??r.data.runningSince)>15000){await persist(r.id,safePause(r));continue;}
  const at=now(),data={...r.data,elapsedMs:timerReading(r.data,at).total,runningSince:at,changedAt:Math.max(at,r.data.changedAt+1)};const row={...r,data};rows.set(r.id,row);await saveRow(row);if(rows.get(r.id)===row)await retainPresence(r.id,{...meta,lastSeenAt:at});
 }changed();}
 async function finishTarget(target){await ready;for(const r of rows.values())if(r.data.state!=='finished'&&r.data.target?.kind===target.kind&&r.data.target.id===target.id)await update(r.id,'finish');}
 const visibility=()=>void setVisible(!document.hidden),pagehide=()=>{visible=false;generation++;resumeOnVisible.clear();void suspend();};
 globalThis.document?.addEventListener('visibilitychange',visibility);globalThis.window?.addEventListener('pagehide',pagehide);
 const heartbeat=setInterval(()=>void checkpoint(),5000);heartbeat.unref?.();
 function control(){const value=el('span',{class:'task-clock-reading'}),node=button([controlIcon('clock'),value],()=>void open(),'quiet icon-button task-clock');node.title='Timers';
  const paint=()=>{const current=[...rows.values()].filter(r=>r.data.state!=='finished'&&samePage(r)).sort((a,b)=>b.data.startedAt-a.data.startedAt),running=current.filter(r=>r.data.state==='running'),r=running[0]??current[0];value.hidden=!r;value.textContent=r?formatTimer(timerReading(r.data,now()).total):'';node.classList.toggle('active',running.length>0);node.setAttribute('aria-label',r?`Timers and time history, ${r.data.title}, ${value.textContent}${running.length?' running':' paused'}`:'Timers and time history');};
  listeners.add(paint);paint();const interval=setInterval(paint,1000);interval.unref?.();return {node,destroy:()=>{listeners.delete(paint);clearInterval(interval);}};
 }
 function practiceControl(target,{current:check=()=>true,title='Devotional',category='Devotional'}={}){
  target=structuredClone(target);let ended=false,pending=false,tick;
  const current=()=>!ended&&check()===true;
  const selected=()=>[...rows.values()].filter(r=>r.data.state!=='finished'&&r.data.target?.kind===target.kind&&r.data.target.id===target.id).sort((a,b)=>b.data.changedAt-a.data.changedAt)[0];
  const node=button([],async()=>{if(!current()||pending)return;pending=true;node.disabled=true;
   try{await ready;if(!current())return;const row=selected();if(row)await update(row.id,row.data.state==='running'?'pause':'resume');else await start({title,category,target},{canStart:current,resumeOnVisibility:false});}
   catch(error){if(current())toast(error.message);}finally{pending=false;if(current()){node.disabled=false;paint();}}
  },'quiet practice-clock');
  function paint(){clearTimeout(tick);if(!current())return;const row=selected(),running=row?.data.state==='running';node.replaceChildren(controlIcon(running?'pause':'play'),el('output',{},row?formatTimer(timerReading(row.data,now()).total):'0:00'));node.setAttribute('aria-label',running?'Pause devotional timer':row?'Resume devotional timer':'Start devotional timer');node.setAttribute('aria-pressed',String(running));if(running){tick=setTimeout(paint,1000);tick.unref?.();}}
  listeners.add(paint);paint();void ready.then(()=>{if(current())paint();}).catch(()=>{});
  return {node,destroy(){ended=true;clearTimeout(tick);listeners.delete(paint);}};
 }
 async function open(){await ready;const defaults=timerContext(ctx),title=field('Title',{value:defaults.title,placeholder:'Optional'}),category=field('Category',{value:defaults.category,placeholder:'Optional'}),mode=select('Mode',[{value:'stopwatch',label:'Stopwatch'},{value:'timer',label:'Timer'}],'stopwatch'),minutes=field('Minutes',{type:'number',min:1,max:10080,value:25});minutes.node.hidden=true;mode.input.onchange=()=>minutes.node.hidden=mode.input.value!=='timer';
  const active=el('div',{class:'timer-list'}),history=el('div',{class:'timer-history'}),body=el('div',{class:'task-timers'},active,el('details',{},el('summary',{},'New timer'),el('div',{class:'timer-setup'},mode.node,minutes.node,title.node,category.node,button('Start',e=>busy(e.currentTarget,async()=>{const n=Number(minutes.input.value);if(mode.input.value==='timer'&&(!Number.isFinite(n)||n<1||n>10080))throw Error('Choose 1 to 10080 minutes.');await start({title:title.input.value.trim()||defaults.title||'Untitled',category:category.input.value.trim()||'Other',target:defaults.target,durationMs:mode.input.value==='timer'?n*60000:0});})))),el('details',{},el('summary',{},'History'),history));
  const displays=new Map(),empty=el('p',{},'No running timers.');let visible=100,historySignature='';const tick=()=>{for(const [id,{value}]of displays){const row=rows.get(id);if(!row)continue;const t=timerReading(row.data,now());value.textContent=(t.overtime?'+':'')+formatTimer(t.display);value.classList.toggle('overtime',t.overtime);}};
  const paint=()=>{const current=[...rows.values()].filter(r=>r.data.state!=='finished'&&samePage(r)).sort((a,b)=>a.data.startedAt-b.data.startedAt),ids=new Set(current.map(r=>r.id));for(const [id,item]of displays)if(!ids.has(id)){item.node.remove();displays.delete(id);}
   for(const row of current){let item=displays.get(row.id);if(!item){const value=el('output',{class:'timer-value'}),title=el('strong'),detail=el('small'),toggle=button(controlIcon('pause'),e=>busy(e.currentTarget,()=>update(row.id,rows.get(row.id)?.data.state==='running'?'pause':'resume')),'quiet icon-button'),finish=button(controlIcon('check'),e=>busy(e.currentTarget,()=>update(row.id,'finish')),'quiet icon-button'),node=el('article',{class:'timer-row'},el('div',{},title,detail),value,el('div',{class:'actions'},toggle,finish));item={node,value,title,detail,toggle,finish,state:null};displays.set(row.id,item);active.append(node);}
    item.title.textContent=row.data.title;item.detail.textContent=row.data.category+(row.pending?(row.localDurable===false?' · Not yet saved':' · Saved on device'):'');item.toggle.setAttribute('aria-label',(row.data.state==='running'?'Pause ':'Resume ')+row.data.title);item.finish.setAttribute('aria-label','Finish '+row.data.title);if(item.state!==row.data.state){item.toggle.replaceChildren(controlIcon(row.data.state==='running'?'pause':'play'));item.state=row.data.state;}}
   if(current.length)empty.remove();else if(!active.contains(empty))active.append(empty);
   tick();const done=[...rows.values()].filter(r=>r.data.state==='finished'||!samePage(r)).sort((a,b)=>(b.data.finishedAt??b.data.changedAt)-(a.data.finishedAt??a.data.changedAt)),signature=JSON.stringify([visible,historyCursor,done.map(r=>[r.id,r.data,r.pending])]);if(signature===historySignature)return;historySignature=signature;history.replaceChildren(...done.slice(0,visible).map(r=>{const t=timerReading(r.data);return el('article',{class:'timer-history-row'},el('strong',{},r.data.title),el('span',{},r.data.category+' · '+(r.data.state==='paused'?'Paused · ':'')+new Date(r.data.finishedAt??r.data.startedAt).toLocaleDateString()),el('span',{},'Total '+formatTimer(t.total)+(t.target?' · Target '+formatTimer(t.target)+' · Extra '+formatTimer(t.extra):'')));}));
   if(done.length>visible)history.append(button('Show more',()=>{visible+=100;paint();},'text-button'));
   else if(historyCursor)history.append(button('Older sessions',e=>busy(e.currentTarget,async()=>{const result=await ctx.request('/api/time-sessions?before='+encodeURIComponent(JSON.stringify(historyCursor)));historyCursor=result.next;for(const row of result.items)if(!rows.has(row.id)){rows.set(row.id,row);await saveRow(row);}visible+=100;paint();}),'text-button'));
   const evidence=taskTimingSummary([...rows.values()],ctx.records('task'));if(evidence.length)history.append(el('details',{},el('summary',{},'Academic estimates and actual time'),...evidence.map(e=>el('p',{},(ctx.records('task').find(t=>t.id===e.taskId)?.data.title??'Task')+' · '+e.actualMinutes+' min measured'+(e.estimateMinutes?' / '+e.estimateMinutes+' min estimated':'')))));
   tick();};
  let interval;modal('Timers',body,{onclose:()=>{listeners.delete(paint);clearInterval(interval);}});body.querySelector('details').open=true;listeners.add(paint);paint();interval=setInterval(()=>{if(!document.hidden)tick();},1000);interval.unref?.();void refresh(true);
 }
 return {control,practiceControl,open,start,ensure,update,resumeProject,finishTarget,refresh,rows,enterRoute,leaveRoute,setVisible,checkpoint,destroy(){disposed=true;generation++;clearInterval(heartbeat);globalThis.document?.removeEventListener('visibilitychange',visibility);globalThis.window?.removeEventListener('pagehide',pagehide);listeners.clear();}};
}
