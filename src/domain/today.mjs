import {academicCoverageIssues} from '../../public/academic-coverage.js';
import {ROUTINE_DEFAULTS} from './routine.mjs';
import {dueReminders} from './reminders.mjs';
import {instant,localDate,zonedDateTime,addDays,overlap,availableIntervals} from './time.mjs';
import {nextLifeosDayAt,lifeosDay} from '../../public/lifeos-day.js';
import {suggestTicketSessions} from './tickets.mjs';

const rows = list => (list??[]).map(r=>({...r.data??r,id:r.id}));
const inside = (item,now) => item?.start && item?.end && instant(item.start)<=now && now<instant(item.end);
const label = kind => kind==='prayer'?'Prayer':'Devotional';
const iso = value => new Date(value).toISOString();
const routeTarget = (route,extra={}) => ({route,...extra});
const protectedKinds = new Set(['sleep','breakfast','lunch','dinner','commute','travel','fellowship','getting-ready','shower','groceries']);

/** Pure interpretation. Raw plans and evidence remain available to their owning pages. */
export function interpretToday({now,date,plan,calendar,school,tickets,records={},presence={},settings={},jobs=[]}) {
 const current=instant(now),tz=plan.timeZone,day={start:zonedDateTime(date,'05:00',{timeZone:tz}),end:zonedDateTime(addDays(date,1),'05:00',{timeZone:tz})};
 const events=calendar.busy.filter(e=>overlap(e,day));
 const calendarConflicts=calendar.calendarConflicts.filter(c=>c.events.every(e=>overlap(e,day)));
 const sourceConflicts=calendar.sourceConflicts.filter(c=>c.events.some(e=>overlap(e,day)));
 const planConstraints=[...plan.conflicts.filter(c=>c.kind!=='calendar-overlap'),...plan.unscheduled.filter(c=>!plan.conflicts.some(p=>p.kind===c.kind&&p.requestedStart===c.requestedStart))];
 const completed=kind=>plan.spiritual[kind]?.complete===true;
 // A collision can prevent the planner from reserving a whole sleep window.
 // Its free remainder is still protected after the calendar event ends.
 const recoveredSleep=plan.unscheduled.filter(b=>b.kind==='sleep'&&b.requestedStart&&b.requestedEnd).flatMap(b=>availableIntervals({start:b.requestedStart,end:b.requestedEnd,busy:calendar.busy}).map(slot=>({...slot,kind:'sleep',title:'Sleep opportunity',protected:true})));
 const blocks=[...plan.blocks,...recoveredSleep].map(b=>{const entryId=`plan:${b.providerKind??b.kind}:${b.id??iso(Math.max(instant(b.start),instant(day.start)))}`,c=rows(records['schedule-correction']).find(c=>c.day===date&&c.entryId===entryId&&!c.undone&&c.reason==='Owner accepted remaining-day preview');return c&&!c.hidden?{...b,start:c.start,end:c.end,scheduleEntryId:entryId}:b;}).filter(b=>b.kind!=='calendar'&&overlap(b,day)&&!(['prayer','devotional'].includes(b.kind)&&completed(b.kind)));
 const currentEvents=events.filter(e=>inside(e,current));
 const currentBlocks=blocks.filter(b=>inside(b,current));
 const fixed=currentBlocks.find(b=>b.protected||protectedKinds.has(b.kind));
 const schoolTransitions=plan.dayType==='sunday'?[]:plan.academicBlocks.filter(b=>instant(b.start)>current).flatMap(b=>{
  const task=school.ranked.find(t=>!t.blocked&&t.energyMatch&&(t.nextStepMinutes??10)<=b.minutes);
  return task?[{...b,kind:'school',title:task.title||'School work',target:routeTarget('school',{taskId:task.id})}]:[];
 });
 const nextBlocks=[...events,...blocks,...schoolTransitions].filter(b=>instant(b.start)>current).sort((a,b)=>instant(a.start)-instant(b.start));
 const nextBlock=nextBlocks[0]??null;
 const beforeNext=nextBlock?instant(nextBlock.start):instant(day.end);
 const sleepEnd=block=>{
  if(instant(block.end)!==instant(day.end))return block.end;
  const wake=zonedDateTime(addDays(date,1),plan.dayType==='friday'?(settings.saturdayWakeTime??'07:00'):(settings.wakeTime??'06:30'),{timeZone:tz});
  const nextEvent=calendar.busy.filter(e=>instant(e.start)>=instant(day.end)&&instant(e.start)<instant(wake)).sort((a,b)=>instant(a.start)-instant(b.start))[0];
  return nextEvent?.start??wake;
 };
 const limit=(end=day.end)=>iso(Math.min(instant(end),beforeNext));
 const timed=(kind,title,block,extra={})=>({kind,title,start:block?.start??now,end:limit(block?.end??day.end),...extra});
 const practice=(kind,block)=>timed(kind,label(kind),block,{reason:`Plan ${plan.spiritual[kind].plan}. ${plan.spiritual[kind].suggestion}`,plan:plan.spiritual[kind].plan,suggestedMinutes:Math.min(kind==='prayer'?15:30,Math.max(1,Math.floor((instant(limit(block?.end??day.end))-current)/60000))),target:routeTarget(kind),buttonLabel:kind==='prayer'?'Begin prayer':'Open devotional'});
 const projectRows=rows(records.project).filter(p=>p.status==='active'&&!p.archived);
 const courseRows=rows(records.course);
 const schoolAction=(task,end,urgent=false)=>{
  const course=courseRows.find(c=>c.id===task.courseId),context=course?.code||task.courseCode||'';
  return timed('school',context&&!task.title?.includes(context)?`${context} · ${task.title||'School task'}`:task.title||'School task',{start:now,end},{detail:task.nextStep,reason:urgent?(task.dueTimeKnown===false?'This task is due today. Its cutoff time is not confirmed.':'This task is due today.'):plan.academicOptional?'Optional school time before lunch.':task.reason,suggestedMinutes:Math.max(1,Math.floor(Math.min((instant(end)-current)/60000,task.remainingMinutes??45,45))),target:routeTarget('school',{taskId:task.id}),buttonLabel:'Open task',taskId:task.id,urgent});
 };
 let nowAction;
 if(currentEvents.length>1){
  const sourceOnly=currentEvents.every((e,i)=>currentEvents.slice(i+1).every(other=>sourceConflicts.some(c=>c.events.includes(e)&&c.events.includes(other))));
  nowAction=timed('conflict',sourceOnly?'Confirm this commitment':'Two commitments overlap',{start:now,end:iso(Math.min(...currentEvents.map(e=>instant(e.end))))},{detail:currentEvents.map(e=>e.title||'Untitled calendar event').join(' / '),reason:sourceOnly?'The school feeds disagree. Both versions remain visible.':'Both commitments are happening now. Review their times and locations.',target:{route:'today',detail:'conflicts'},buttonLabel:'Review commitments'});
 } else if(currentEvents.length){
  const e=currentEvents[0];nowAction=timed('calendar',e.title||'Untitled calendar event',e,{detail:e.location||null,target:routeTarget('today',{eventId:e.id}),buttonLabel:'View commitment'});
 } else if(plan.spiritualPracticesEnabled&&fixed?.kind==='sleep'&&instant(fixed.start)>instant(day.start)&&['devotional','prayer'].some(kind=>!completed(kind))){
  const kind=['devotional','prayer'].find(kind=>!completed(kind));
  nowAction=practice(kind,null);
  nowAction.reason='Finish this daily practice before going to sleep.';
  nowAction.suggestedMinutes=Math.max(1,Math.min(kind==='prayer'?15:30,Math.floor((instant(day.end)-current)/60000)));
  nowAction.end=iso(Math.min(current+(kind==='prayer'?15:30)*60000,instant(day.end)));
 } else if(fixed){
  nowAction=timed(fixed.kind==='sleep'?'rest':fixed.kind,fixed.kind==='sleep'?'Protect your sleep':fixed.title,fixed,{reason:fixed.kind==='sleep'?'Unfinished work can wait until the morning.':null});
  if(fixed.kind==='sleep')nowAction.end=sleepEnd(fixed);

  // Prayer A/C belongs to the commute; it does not replace the commute itself.
  if(fixed.kind==='commute'&&fixed.prayerPlan&&!completed('prayer')){nowAction.detail='Pray during the walk when safe, or finish somewhere safe.';nowAction.target=routeTarget('prayer');nowAction.buttonLabel='Begin prayer';}
 } else {
  const practiceBlock=currentBlocks.find(b=>['devotional','prayer'].includes(b.kind));
  const recovery=plan.spiritualPracticesEnabled&&['devotional','prayer'].find(kind=>!completed(kind)&&(plan.spiritual[kind].plan==='D'||plan.spiritual[kind].slot?.end&&current>=instant(plan.spiritual[kind].slot.end)||plan.spiritual[kind].plan==='C'&&plan.releaseAt&&current>=instant(plan.releaseAt)));
  if(practiceBlock)nowAction=practice(practiceBlock.kind,practiceBlock);
  else if(recovery)nowAction=practice(recovery,null);
  else if(plan.dayType!=='sunday'){
   const academic=plan.academicBlocks.find(b=>inside(b,current));
   if(academic&&school.next)nowAction=schoolAction(school.next,limit(academic.end));
   // A cached forecast is not permission to fill an evening with maintenance.
   // Only a verified future deadline on this civil day can make an exception.
   const urgent=school.ranked.find(t=>!t.blocked&&t.dueToday);
   if(urgent&&(!academic||!nowAction&&urgent.fitsFirstStep))nowAction=schoolAction(urgent,limit(urgent.dueAt&&instant(urgent.dueAt)>current?urgent.dueAt:undefined),true);
   const exercise=currentBlocks.find(b=>b.kind==='exercise');
   if(!nowAction&&exercise)nowAction=timed('exercise','Exercise',exercise,{detail:'Open the current exercise plan before starting.',target:routeTarget('exercise'),buttonLabel:'Open exercise'});
   const available=plan.discretionaryBlocks.find(b=>inside(b,current));
   const reminders=dueReminders({records:records.reminder??[],lists:records['reminder-list']??[],now,timeZone:tz});
   if(!nowAction&&available&&reminders.length){const reminder=reminders[0];nowAction=timed('reminder',reminder.title,{start:now,end:limit(available.end)},{detail:reminder.notes?.slice(0,300)||null,reason:'This reminder is due. Use this free block.',target:routeTarget('reminders',{reminderId:reminder.id,listId:reminder.listId}),buttonLabel:'Open reminder'});}
   if(!nowAction&&available){
    const intervals=[{start:now,end:limit(available.end)}];
    const suggestions=suggestTicketSessions({date,ledger:rows(records['ticket-spend']),intervals,timeZone:tz});
    const suggestion=suggestions.find(s=>s.suggestedMinutes>=5&&s.category!=='*'&&(!['personal-project','school-project'].includes(s.category)||projectRows.some(p=>(p.category===s.category||p.eligibleCategories?.includes(s.category)))));
    if(suggestion){
     const project=projectRows.find(p=>p.id===settings.activeProjectId&&(p.category===suggestion.category||p.eligibleCategories?.includes(suggestion.category)))||projectRows.find(p=>(p.category===suggestion.category||p.eligibleCategories?.includes(suggestion.category)));
     const end=iso(Math.min(instant(intervals[0].end),current+suggestion.suggestedMinutes*60000));
     nowAction=timed(project?'project':suggestion.category,project?.title||suggestion.label,{start:now,end},{detail:project?.notes||null,reason:`Use the remaining ${suggestion.label.toLowerCase()} ticket in this free block.`,suggestedMinutes:suggestion.suggestedMinutes,projectId:project?.id,ticketId:suggestion.ticketId,target:routeTarget('tickets',project?{projectId:project.id}:{ticketId:suggestion.ticketId}),buttonLabel:project?'Open project':'Open ticket'});
    }
   }
  }
 }
 if(!nowAction)nowAction=timed('rest','Rest',{start:now,end:nextBlock?.start??day.end},{reason:plan.dayType==='sunday'?'Keep this time for Sabbath rest, family and church.':calendar.incomplete?'Some calendar times could not be read. Check the calendar details before committing this time.':'Nothing else is currently owed in this free block.'});
 nowAction.evidence={rule:nowAction.reason??(currentEvents.length?'Fixed calendar commitment':'Current routine block'),availableMinutes:Math.max(0,Math.floor((instant(nowAction.end)-current)/60000)),taskId:nowAction.taskId??null,deadline:school.ranked.find(t=>t.id===nowAction.taskId)?.dueAt??null};
 nowAction.until=nowAction.end; // legacy consumers
 let upcoming=nextBlock?{kind:nextBlock.kind??'calendar',title:nextBlock.title||'Untitled calendar event',start:nextBlock.start,end:nextBlock.end,location:nextBlock.location||null,target:nextBlock.target??(nextBlock.kind==='calendar'||!nextBlock.kind?routeTarget('today',{eventId:nextBlock.id}):null)}:null;
 if(fixed?.kind==='sleep'&&['devotional','prayer'].includes(nowAction.kind))upcoming=nowAction.kind==='devotional'&&!completed('prayer')?{kind:'prayer',title:'Prayer',start:nowAction.end,end:iso(instant(nowAction.end)+15*60000),target:routeTarget('prayer',{day:date})}:{kind:'sleep',title:'Sleep',start:nowAction.end,end:sleepEnd(fixed)};
 if(upcoming?.location&&upcoming.kind==='calendar'){const commute=blocks.filter(b=>['commute','travel'].includes(b.kind)&&instant(b.start)>=current&&instant(b.end)<=instant(upcoming.start)).at(-1);if(commute)upcoming.leaveBy=commute.start;else if((presence.observations??[]).filter(o=>!o.uncertain&&instant(o.occurredAt)<=current).sort((a,b)=>instant(a.occurredAt)-instant(b.occurredAt)).at(-1)?.zone==='home'&&(presence.observations??[]).filter(o=>!o.uncertain&&instant(o.occurredAt)<=current).sort((a,b)=>instant(a.occurredAt)-instant(b.occurredAt)).at(-1)?.type==='arrival')upcoming.leaveBy=iso(instant(upcoming.start)-(settings.morningCommuteMinutes??settings.commuteMinutes??ROUTINE_DEFAULTS.commuteMinutes)*60000);}
 if(!upcoming&&fixed?.kind==='sleep'&&nowAction.kind==='rest')upcoming={kind:'wake',title:'Wake up',start:sleepEnd(fixed),end:null,target:null};
 const timeline=[];
 const add=item=>{if(item.start&&instant(item.start)>=instant(day.start)&&instant(item.start)<instant(day.end))timeline.push(item);};
 const bedtimePractices=fixed?.kind==='sleep'&&['devotional','prayer'].includes(nowAction.kind)?[nowAction,...(upcoming?.kind==='prayer'?[upcoming]:[])]:[];
 const sleepResumesAt=bedtimePractices.at(-1)?.end;
 for(const b of [...events,...blocks]){
  if(['getting-ready'].includes(b.kind)||b.kind==='sleep'&&instant(b.start)<=instant(day.start))continue;
  const originalStart=iso(Math.max(instant(b.start),instant(day.start))),start=b===fixed&&sleepResumesAt?iso(Math.max(instant(originalStart),instant(sleepResumesAt))):originalStart,end=b.kind==='sleep'?sleepEnd(b):iso(Math.min(instant(b.end),instant(day.end))),kind=b.kind??'calendar';
  if(instant(start)>=instant(end))continue;
  const past=instant(end)<=current;if(past&&['devotional','prayer'].includes(kind)&&!completed(kind))continue;
  add({id:b.scheduleEntryId??`plan:${b.providerKind??kind}:${b.id??originalStart}`,kind,title:kind==='sleep'?'Sleep':b.title,start,end,estimated:b.estimated,mode:b.mode,state:inside({start,end},current)?'current':past?'past-plan':'planned',detail:b.location||null,target:kind==='commute'&&b.prayerPlan?routeTarget('prayer',{day:date}):kind==='calendar'?routeTarget('today',{eventId:b.id}):['prayer','devotional','exercise'].includes(kind)?routeTarget(kind,{day:date}):null});
 }
 // These are proposed fallback slots, never completion evidence. Keep the
 // original sleep identity so existing schedule corrections still resolve.
 for(const action of bedtimePractices)add({id:`fallback:${action.kind}:${date}`,kind:action.kind,title:action.title,start:action.start??now,end:action.end,state:action===nowAction?'current':'planned',target:routeTarget(action.kind,{day:date}),buttonLabel:action.kind==='prayer'?'Begin prayer':'Open devotional'});
 for(const record of rows(records.spiritual).filter(r=>r.complete&&r.completedAt&&lifeosDay(r.completedAt,tz)===date)){const kind=record.practice??record.kind;if(!['devotional','prayer'].includes(kind))continue;add({id:'completed:'+record.id,kind,title:label(kind)+' completed',start:record.completedAt,state:'completed',source:{kind:'spiritual',id:record.id},target:routeTarget(kind,{day:date,entryId:kind==='devotional'?record.entryId??record.date:undefined})});}
 const undone=new Set(rows(records['ticket-spend']).filter(r=>r.type==='undo').map(r=>r.spendId));
 for(const spend of rows(records['ticket-spend']).filter(r=>r.type==='spend'&&!undone.has(r.id)))add({id:`ticket:${spend.id}`,kind:'ticket',title:projectRows.find(p=>p.id===spend.projectId)?.title||spend.note||tickets.tickets.find(t=>t.id===spend.ticketId)?.label||'Recorded activity',start:spend.start,end:spend.end,state:instant(spend.end)<=current?'completed':'observed',target:routeTarget('tickets',spend.projectId?{projectId:spend.projectId}:{ticketId:spend.ticketId})});
 for(const work of rows(records['work-session']))if(work.observedAt){const task=rows(records.task).find(t=>t.id===work.taskId);add({id:`work:${work.id}`,kind:'school',title:task?.title?`Progress recorded · ${task.title}`:'School progress recorded',start:work.observedAt,state:'observed',source:{kind:'work-session',id:work.id},detail:work.minutes?`${work.minutes} min reported`:null,target:task?routeTarget('school',{taskId:task.id}):null});}
 for(const run of rows(records.run))if(run.completedAt||run.start)add({id:`run:${run.id}`,kind:'exercise',title:'Exercise recorded',start:run.completedAt??run.start,state:'completed',source:{kind:'run',id:run.id},target:routeTarget('exercise',{day:date})});
 if(settings.observedWakeAt&&lifeosDay(settings.observedWakeAt,tz)===date)add({id:'wake',kind:'presence',title:'Woke up',start:settings.observedWakeAt,state:'observed'});
 const observations=(presence.observations??[]).filter(o=>!o.uncertain&&!(o.zone==='campus'&&o.type==='arrival'));
 for(const o of observations)add({id:`presence:${o.id}`,kind:'presence',title:`${o.type==='arrival'?'Arrived':'Left'} ${o.zone==='home'?'home':'campus'}`,start:o.occurredAt,state:'observed',source:{kind:'presence',id:o.id}});
 if(presence.arrivalAt)add({id:'campus-arrival',source:{kind:'presence-arrival'},kind:'presence',title:'Arrived on campus',start:presence.arrivalAt,state:'observed',detail:presence.roundedMinutes>0&&presence.status!=='excepted'?`${presence.roundedMinutes} min late · Provisional charity: $${presence.amount}`:null});
 for(const item of timeline)if(item.target)item.target={...item.target,day:date};
 for(const correction of rows(records['schedule-correction']).filter(c=>c.day===date&&!c.undone)){const i=timeline.findIndex(t=>t.id===correction.entryId);if(i<0)continue;if(correction.hidden)timeline.splice(i,1);else {const entry=timeline[i];entry.start=correction.start??entry.start;entry.end=correction.end??entry.end;entry.order=correction.order??null;entry.corrected=true;entry.state=entry.source?'observed':inside(entry,current)?'current':instant(entry.end??entry.start)<=current?'past-plan':'planned';}}
 timeline.sort((a,b)=>(a.order??instant(a.start))-(b.order??instant(b.start))||a.id.localeCompare(b.id));
 const urgentTask=plan.dayType==='sunday'?null:school.ranked.find(t=>!t.blocked&&t.dueToday);
 const urgentAction=urgentTask&&nowAction.taskId!==urgentTask.id?schoolAction(urgentTask,urgentTask.dueAt&&instant(urgentTask.dueAt)>current?urgentTask.dueAt:limit(),true):null;
 const alerts=[...calendarConflicts.map((c,i)=>({...c,id:`overlap:${i}`,title:'Schedule conflict',target:{route:'today',detail:'conflicts'}})),...sourceConflicts.map((c,i)=>({...c,id:`source:${i}`,title:'School calendar disagreement',target:{route:'today',detail:'conflicts'}}))];
 if(calendar.incomplete)alerts.push({id:'calendar-incomplete',kind:'calendar-data',title:'Some calendar times need review',reason:'Invalid event times are excluded. Open the original calendar to confirm your commitments.',target:{route:'today',detail:'conflicts'}});
 const jobLabels={'prayer-process':['Prayer recording needs your input','prayer'],'school-collect':['School sources need attention','school'],'school-interpretation':['A school task needs your input','school'],'source-sync':['School sources need attention','school'],inspire:['Your task request needs input','school'],support:['Your request needs input','support']};
 for(const job of jobs){
  const info=jobLabels[job.type];if(!info||!['queued','running','needs-input'].includes(job.status))continue;
  const signIn=job.progress==='needs sign-in';
  if(job.status==='needs-input'||signIn){const title=signIn?'School sources need sign-in':info[0];if(!alerts.some(a=>a.title===title))alerts.push({id:`input:${job.id}`,kind:'input',title,reason:signIn?'Sign in on the computer used for school collection.':'Open the request to review what it needs.',target:routeTarget(info[1])});}
 }
 for(const issue of academicCoverageIssues({courses:records.course,integrations:records.integration,now:current}))alerts.push({...issue,kind:'school-coverage',target:routeTarget('school',{detail:'coverage'})});
 const boundaries=[zonedDateTime(addDays(localDate(now,tz),1),'00:00',{timeZone:tz}),...(records.reminder??[]).filter(r=>!r.data.completed&&!r.data.archived&&r.data.dueAt).map(r=>r.data.dueAt),nextLifeosDayAt(now,tz),...blocks.flatMap(b=>[instant(b.start),instant(b.end)]),...events.flatMap(e=>[instant(e.start),instant(e.end)]),...plan.academicBlocks.flatMap(b=>[instant(b.start),instant(b.end)]),...plan.discretionaryBlocks.flatMap(b=>[instant(b.start),instant(b.end)]),instant(nowAction.end),zonedDateTime(date,settings.recoveryTime??'20:30',{timeZone:tz}),plan.releaseAt].filter(Boolean).map(instant).filter(t=>t>current);
 const activeLists=new Set(rows(records['reminder-list']).filter(r=>!r.archived).map(r=>r.id));
 const datedReminders=rows(records.reminder).filter(r=>activeLists.has(r.listId)&&!r.archived&&!r.completed&&r.dueDate&&r.dueDate<=date).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||(b.priority??0)-(a.priority??0)).map(r=>({id:r.id,title:r.title,dueDate:r.dueDate,target:routeTarget('reminders',{reminderId:r.id,listId:r.listId})}));
 return {date,nowAction,urgentAction,dueReminders:datedReminders,upcoming,timeline,alerts,calendarConflicts,sourceConflicts,planConstraints,dayNotices:calendar.events.filter(e=>e.dayNotice&&e.status!=='cancelled'&&overlap(e,day)),nextRecomputeAt:iso(Math.min(...boundaries))};
}
