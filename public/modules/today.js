import {notificationWidgets} from '../notification-widgets.js';
import {currentScheduleDetails,selectScheduleRow} from '../schedule-presentation.js';
import {friendWidget} from '../friend-widget.js';
import {openApplication} from '../application-detail.js';
import {scheduleLocation} from '../schedule-location.js';
import {correctedSteps} from '../spiritual-tools.js';
import {moveConsequences} from '../planning-actions.js';
import {assistantButton,mountAssistant} from '../assistant-chat.js';
import {controlIcon,compactDisclosure,helpControl} from '../quiet-controls.js';
import {timeValue,replaceTime,localDateTimeValue,replaceDateTime,reorderedValue,lineIcon,dragSchedule} from '../schedule-edit.js';

import {fitApplicationLines} from '../compact-application.js';
import {smallSteps} from '../devotional-accountability.js';

import {shiftDay,chronologicalCards,swipeDays} from '../day-navigation.js';

import {el,replace,append,button,panel,formatTime,compactTime,formatDate,getDisplayTimeZone,deadlineUrgency,busy,showResult,field,modal,safeLink,toast} from '../ui.js';

import {targetHash,targetLabel,routeQuery} from '../targets.js';



export async function mount(root,ctx){
 if(routeQuery().has('assistant'))return mountAssistant(root,ctx,'today');

 const friendReminders=friendWidget(ctx),dayOptionsHost=el('div',{class:'today-day-options'});let notifications=null,selectedCard=null,scrollSelection=false;
 let disposed=false,timer,countdown,displayTimer,displayUpdate=()=>{},view=ctx.state.bootstrap.today||{},schedule=view,selectedDay=view.date||ctx.date(),scheduleToken=0,selectionEpoch=0,scheduleLoading=false,scheduleError=false,cardOffset=0,scheduleEditing=false;const scheduleHost=el('div',{class:'today-schedule-column'});const scheduleDetails=[];const cardDetails=[];let releaseApplicationFit=()=>{},releaseReminderFit=()=>{};

 const date=()=>view.date||ctx.date();
 const canOpen=target=>target&&(target.route==='today'||!ctx.capabilities?.targetRoutes||ctx.capabilities.targetRoutes.includes(target.route));

 const range=item=>item.allDay?'All day':`${formatTime(item.start)}${item.end?'–'+formatTime(item.end):''}`;

 function editEvent(record=null){
  const data=record?.data??{},title=field('Event title',{value:data.title??data.summary??'',required:true}),day=field('Event date',{type:'date',value:data.start?localDateTimeValue(data.start.dateTime??data.start).slice(0,10):selectedDay}),start=field('Start time',{type:'time',value:data.start?timeValue(data.start.dateTime??data.start):'16:00'}),end=field('End time',{type:'time',value:data.end?timeValue(data.end.dateTime??data.end):'17:00'}),location=field('Location',{value:data.location??''});
  const save=async deleted=>{if(!title.input.reportValidity()||!day.input.reportValidity()||!start.input.reportValidity()||!end.input.reportValidity())return;const date=day.input.value,body={id:record?.id??crypto.randomUUID(),version:record?.version??0,title:title.input.value,location:location.input.value,start:replaceDateTime(new Date().toISOString(),date+'T'+start.input.value),end:replaceDateTime(new Date().toISOString(),date+'T'+end.input.value),deleted};const result=await ctx.action('local-calendar',body);if(!result.pending){document.querySelector('#dialog').close();await ctx.refresh({redraw:true});}};
  modal(record?'Edit event':'Add event',el('div',{class:'form-stack'},title.node,day.node,start.node,end.node,location.node,button('Save event',e=>busy(e.currentTarget,()=>save(false)))));
 }
 function deleteEvent(record){modal('Delete event?',el('div',{},el('p',{},record.data.title??record.data.summary),button('Confirm delete',e=>busy(e.currentTarget,async()=>{await ctx.action('local-calendar',{id:record.id,version:record.version,title:record.data.title??record.data.summary,location:record.data.location??'',start:record.data.start.dateTime??record.data.start,end:record.data.end.dateTime??record.data.end,deleted:true});document.querySelector('#dialog').close();await ctx.refresh({redraw:true});}))));}
 function eventDetails(id){

  const event=schedule.calendar?.events?.find(e=>e.id===id)||view.calendar?.events?.find(e=>e.id===id);

  if(!event)return modal('Commitment unavailable',el('p',{},'This event is no longer in the saved calendar window. Refresh Today to check it.'));

  modal(event.title||'Calendar commitment',el('div',{class:'form-stack'},el('p',{},`${formatDate(event.start)}, ${range(event)}`),event.location?el('p',{},event.location):null,event.dayNotice?el('p',{},'This is a date-only school notice. It does not supply a class time or cancel the normal routine.'):null,el('p',{class:'muted'},[...new Set(event.sources?.map(s=>sourceName(s.calendarId))||[])].join(', ')),safeLink(event.htmlLink,'Open original event'),ctx.state.session?.mode?button('Edit event',()=>editEvent((()=>{const record=ctx.records('calendar-event').find(r=>r.id===id);return {...record,data:{...record.data,start:event.start,end:event.end}};})()),'quiet'):null,ctx.state.session?.mode?button('Delete event',()=>deleteEvent(ctx.records('calendar-event').find(r=>r.id===id)),'quiet'):null));

 }

 function sourceName(id){const sources=view.calendar?.events?.filter(e=>e.sources?.some(s=>s.calendarId===id));return sources?.some(e=>e.isSchool)?`School feed ${[...new Set(view.calendar.events.filter(e=>e.isSchool).flatMap(e=>e.sources.map(s=>s.calendarId)))].indexOf(id)+1}`:id?.endsWith('@group.calendar.google.com')?'Personal calendar':'Primary calendar';}

 function conflicts(){

  const items=[...(view.calendarConflicts||[]),...(view.sourceConflicts||[])];

  modal('Review commitments',el('div',{class:'form-stack'},...items.map(c=>el('section',{},el('h3',{},c.kind==='source-disagreement'?'School feed disagreement':'Overlapping commitments'),el('p',{},c.reason),...c.events.map(e=>el('article',{class:'practice-row'},el('h3',{},e.title||'Untitled event'),el('p',{},`${formatDate(e.start)}, ${range(e)}`),e.location?el('p',{},e.location):null,el('p',{class:'muted'},`${[...new Set(e.sources?.map(s=>sourceName(s.calendarId))||[])].join(', ')}${e.status==='cancelled'?', Cancelled':''}`),safeLink(e.htmlLink,'Open original event'))),el('p',{class:'muted'},c.kind==='source-disagreement'?'Compare both versions with the course timetable. Confirm the correct time in the source or report the discrepancy in Support. LifeOS keeps both versions reserved.':'Review the original events and decide which commitment to attend. LifeOS will not change these calendars.'))),...(view.calendar?.errors||[]).map(e=>el('p',{},`Calendar time could not be read: ${e.reason}`)),...(!items.length&&!view.calendar?.errors?.length?[el('p',{},'No overlapping commitments or school feed disagreements remain in this day.')]:[])));

 }

 function open(target){if(target.route==='today'){if(target.eventId)eventDetails(target.eventId);else if(target.detail==='conflicts')conflicts();return;}const route=targetHash(target);if(route)ctx.go(route);}

 function currentSchedule(context){return !disposed&&!scheduleLoading&&!scheduleError&&context.token===scheduleToken&&context.selection===selectionEpoch&&context.day===selectedDay&&context.day===schedule.date&&context.schedule===schedule;}
 function correctionFor(day,id){return ctx.records('schedule-correction').find(r=>r.data.day===day&&r.data.entryId===id);}
 function entryIntent(item,context,hidden=false){const correction=correctionFor(context.day,item.id);return{item,context,hidden,correctionId:correction?.id??null,version:correction?.version??0,original:correction?.data.original?{...correction.data.original}:null};}
 function currentIntent(intent){const correction=correctionFor(intent.context.day,intent.item.id);return currentSchedule(intent.context)&&(correction?.id??null)===intent.correctionId&&(correction?.version??0)===intent.version&&(intent.hidden?correction?.data.hidden===true&&!correction.data.undone:intent.context.schedule.timeline?.includes(intent.item));}
 function requireIntent(intent){if(currentIntent(intent))return true;showResult({pending:true,reason:'This schedule changed. Your values are still here; reopen the entry before saving.'});return false;}
 // A successful POST may refresh bootstrap before action() resolves. Navigation
 // identity, rather than the old response/version, governs its later publication.
 function sameSelection(context){return !disposed&&context.selection===selectionEpoch&&context.day===selectedDay;}
 // Date selection survives an ordinary acknowledged bootstrap refresh. A popup
 // replacement or a newer feedback message transfers presentation ownership.
 function publication(){const dialog=document.querySelector('#dialog');return{dialog,open:!!dialog?.open,content:dialog?.querySelector('.dialog-content'),feedback:toast.timer};}
 function ownsPublication(context,witness){const dialog=document.querySelector('#dialog');return sameSelection(context)&&dialog===witness.dialog&&!!dialog?.open===witness.open&&dialog?.querySelector('.dialog-content')===witness.content&&toast.timer===witness.feedback;}
 function ownsControl(control){return !control||root.contains(control)||!!document.querySelector('#dialog')?.open&&document.querySelector('#dialog').querySelector('.dialog-content')?.contains(control);}
 function closeOwnedDialog(control){const dialog=document.querySelector('#dialog');if(control&&dialog?.open&&dialog.querySelector('.dialog-content')?.contains(control))dialog.close();}
 async function ownedResult(context,witness,operation){try{return await operation();}catch(error){if(ownsPublication(context,witness))throw error;return null;}}
 async function refreshSaved(context){const witness=publication();if(!ownsPublication(context,witness))return;const token=scheduleToken;await ownedResult(context,witness,()=>ctx.refresh());if(ownsPublication(context,witness)&&token===scheduleToken)await loadDay(context.day,false);}
 async function loadDay(day,intentional=true){if(disposed)return;if(intentional)selectionEpoch++;const token=++scheduleToken;selectedDay=day;scheduleLoading=true;scheduleError=false;renderSchedule();try{const result=day===view.date?{today:view}:await ctx.request('/api/schedule?day='+day);if(token!==scheduleToken||disposed)return;if(result?.today?.date!==day)throw Error('The schedule response does not match the selected day.');schedule=result.today;scheduleLoading=false;renderSchedule();}catch{if(token===scheduleToken&&!disposed){scheduleLoading=false;scheduleError=true;renderSchedule();}}}
 async function changeDay(delta){if(!disposed)await loadDay(shiftDay(selectedDay,delta));}

 async function saveCorrection(intent,values,reviewed=false,control=null){if(!ownsControl(control)||!requireIntent(intent))return;const displaced=values.hidden?[]:moveConsequences(intent.item,values,intent.context.schedule.timeline??[]);if(!reviewed&&displaced.length&&(values.start||values.end)){modal('Review changed timing',el('div',{},el('p',{},'This overlaps '+displaced.map(d=>d.title).join(', ')+'. These entries will not be moved.'),button('Keep this timing',e=>busy(e.currentTarget,()=>saveCorrection(intent,values,true,e.currentTarget)),'quiet')));return;}const witness=publication(),result=await ownedResult(intent.context,witness,()=>ctx.action('schedule-entry',{day:intent.context.day,entryId:intent.item.id,version:intent.version,...values}));if(!ownsPublication(intent.context,witness)||!result)return;showResult(result,'Schedule saved. Source content is preserved.');if(!result.pending){closeOwnedDialog(control);await refreshSaved(intent.context);}}

 async function markPastPrayerComplete(context,control){if(!ownsControl(control))return;if(!currentSchedule(context))throw Error('This schedule changed. Reopen the day before marking prayer complete.');const day=context.day,witness=publication(),result=await ownedResult(context,witness,()=>ctx.action('spiritual-complete',{date:day,practice:'prayer',complete:true}));if(!ownsPublication(context,witness)||!result)return;showResult(result,'Prayer marked complete for '+formatDate(day,true)+'. Time not recorded.');if(!result.pending)await refreshSaved(context);}

 function editEntry(intent){if(!requireIntent(intent))return;const item=intent.item,start=field('Start',{type:'datetime-local',value:localDateTimeValue(item.start)}),end=item.end?field('End',{type:'datetime-local',value:localDateTimeValue(item.end)}):null,values=()=>({start:replaceDateTime(item.start,start.input.value),...(end?{end:replaceDateTime(item.end,end.input.value)}:{}),hidden:false});

 modal('Edit Entry',el('div',{class:'form-stack'},el('h3',{},item.title),el('p',{class:'muted'},item.source?'Changing the time corrects the LifeOS observation or completion record. Writing and recordings are preserved.':'Changes apply to this LifeOS schedule only. The original calendar or source is unchanged.'),start.node,end?.node,button('Save time',e=>busy(e.currentTarget,()=>saveCorrection(intent,values(),false,e.currentTarget))),button('Remove from this schedule',e=>busy(e.currentTarget,()=>saveCorrection(intent,{...values(),hidden:true},false,e.currentTarget)),'quiet'),intent.original?button('Undo schedule edit',e=>busy(e.currentTarget,()=>saveCorrection(intent,{...intent.original,hidden:false},false,e.currentTarget)),'quiet'):null));}

 async function moveEntry(intent,index,control){if(!ownsControl(control)||!requireIntent(intent))return;const item=intent.item,rows=intent.context.schedule.timeline??[],neighbor=rows[index];if(!neighbor||neighbor.id===item.id)return;modal('Move schedule entry',el('div',{},el('p',{},item.title+' will appear '+(index<rows.indexOf(item)?'before ':'after ')+neighbor.title+'. Times and other entries stay unchanged.'),button('Move entry',e=>busy(e.currentTarget,()=>saveCorrection(intent,{hidden:false,order:reorderedValue(rows,item.id,index)},false,e.currentTarget)),'quiet')));}

 function removeEntry(intent,control){if(!ownsControl(control)||!requireIntent(intent))return;modal('Remove from schedule?',el('div',{},el('p',{},intent.item.title),el('p',{class:'muted'},'Only this schedule entry is hidden. Its original content and calendar event stay saved.'),el('div',{class:'actions'},button('Remove',e=>busy(e.currentTarget,()=>saveCorrection(intent,{hidden:true},false,e.currentTarget)),'quiet'),button('Cancel',e=>closeOwnedDialog(e.currentTarget),'text-button'))));}

 function replaceSchedule(...children){const focused=document.activeElement,key=scheduleHost.contains(focused)?focused?.getAttribute('data-schedule-focus'):null;replace(scheduleHost,...children);if(!key||document.activeElement&&document.activeElement!==focused&&document.activeElement!==document.body)return;const candidates=[...scheduleHost.querySelectorAll('button'),...scheduleHost.querySelectorAll('strong')],target=candidates.find(n=>n.getAttribute('data-schedule-focus')===key)||candidates.find(n=>n.getAttribute('data-schedule-focus')==='date');target?.focus({preventScroll:true});}

 function renderSchedule(){scheduleDetails.splice(0).forEach(d=>d.destroy());const prev=button(controlIcon('left'),()=>changeDay(-1),'quiet icon-button'),next=button(controlIcon('right'),()=>changeDay(1),'quiet icon-button');prev.setAttribute('aria-label','Previous schedule day');next.setAttribute('aria-label','Next schedule day');
 prev.setAttribute('data-schedule-focus','previous');next.setAttribute('data-schedule-focus','next');

 const returnToday=selectedDay!==view.date?button('Today',()=>loadDay(view.date),'text-button compact'):null;if(returnToday){returnToday.setAttribute('aria-label','Return schedule to today');returnToday.setAttribute('data-schedule-focus','today');}
 const navigation=el('div',{class:'day-navigation'},prev,el('div',{class:'today-schedule-date'},el('strong',{'data-schedule-focus':'date',tabindex:'-1'},formatDate(selectedDay,true)),returnToday),next);
 if(scheduleLoading||scheduleError){const retry=button('Retry',()=>changeDay(0),'quiet');retry.setAttribute('data-schedule-focus','retry');replaceSchedule(el('section',{class:'today-review panel','aria-labelledby':'day-review-title','aria-busy':String(scheduleLoading)},el('div',{class:'panel-heading'},el('h2',{id:'day-review-title'},'Full Schedule')),navigation,scheduleLoading?el('p',{role:'status'},'Loading schedule…'):el('div',{role:'alert'},el('p',{},'Schedule unavailable for '+formatDate(selectedDay,true)+'.'),retry)));return;}
 const context={day:schedule.date,schedule,token:scheduleToken,selection:selectionEpoch};

 const toggle=ctx.capabilities?.scheduleEditing===false?null:button(scheduleEditing?'Done':'Edit',()=>{scheduleEditing=!scheduleEditing;renderSchedule();},'quiet compact');toggle?.setAttribute('aria-pressed',String(scheduleEditing));

 const timeline=el('ol',{class:'day-story'+(scheduleEditing?' editing':'')});let period=0;

 for(const [index,item] of (schedule.timeline??[]).entries()){

  const hour=Number.isFinite(Date.parse(item.start))?Number(timeValue(item.start).split(':')[0]):NaN,nextPeriod=item.allDay?0:hour>=17?2:hour>=12?1:0;if(nextPeriod>period){period=nextPeriod;timeline.append(el('li',{class:'schedule-period','aria-hidden':'true'},period===1?'Afternoon':'Evening'));}
  const intent=entryIntent(item,context);

  const clock=el('div',{class:'schedule-clock'});

  if(scheduleEditing){for(const key of ['start','end'].filter(k=>item[k])){const input=el('input',{type:'time',value:timeValue(item[key]),'aria-label':(key==='start'?'Start':'End')+' time for '+item.title,class:'schedule-time'});input.onchange=()=>busy(input,async()=>{const changed=replaceTime(item[key],input.value),values={[key]:changed};if(key==='start'&&item.end)values.end=new Date(Date.parse(item.end)+Date.parse(changed)-Date.parse(item.start)).toISOString();await saveCorrection(intent,values,false,input);});clock.append(input);}}

  else{const detail=compactDisclosure({label:range(item),content:range(item)});detail.trigger.replaceChildren(el('time',{datetime:item.start},formatTime(item.start)));detail.trigger.classList.add('schedule-clock-button');detail.node.classList.add('popover-from-start');scheduleDetails.push(detail);clock.append(detail.node);}

  const extra=item.detail&&item.kind!=='calendar'?helpControl(item.detail,'Details for '+item.title):null;if(extra)scheduleDetails.push(extra);
  const title=!scheduleEditing&&canOpen(item.target)?button(item.title,()=>{if(currentSchedule(context))open(item.target);},'text-button schedule-title'):item.title;
  const calendarEvent=item.target?.eventId?(schedule.calendar?.events??[]).find(e=>e.id===item.target.eventId):null;
  const location=scheduleLocation(calendarEvent,schedule.timeline);
  const row=el('li',{class:'story-item story-'+item.state+(item.kind==='presence'?' story-presence':''),'aria-current':item.state==='current'?'time':null,'data-schedule-id':item.id,'data-schedule-start':item.start,'data-schedule-kind':item.kind},clock,el('div',{class:'schedule-body'},el('div',{class:'schedule-title-row'},el('h3',{},title),item.state==='current'?null:extra?.node),currentScheduleDetails(item,view,ctx),el('span',{class:'sr-only'},item.state==='past-plan'?'Planned, not confirmed':item.state==='planned'?'Planned':item.state)),location);


  if(scheduleEditing){const handle=button(lineIcon('drag'),()=>{},'quiet icon-button schedule-drag'),trash=button(lineIcon('trash'),e=>removeEntry(intent,e.currentTarget),'text-button icon-button schedule-trash');handle.setAttribute('aria-label','Drag to reorder '+item.title+'. Arrow keys move it.');trash.setAttribute('aria-label','Remove '+item.title);handle.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();void moveEntry(intent,index+(e.key==='ArrowUp'?-1:1),handle);}};row.append(handle,trash);dragSchedule(handle,row,timeline,to=>{void moveEntry(intent,to,handle);});swipeDays(row,d=>{if(d>0)removeEntry(intent,row);});}timeline.append(row);

 }

 const hidden=ctx.records('schedule-correction').filter(r=>r.data.day===selectedDay&&r.data.hidden&&!r.data.undone);

 const pastPrayer=schedule.spiritualPracticesEnabled===true&&ctx.capabilities?.spiritualCompletion!==false&&selectedDay<view.date&&schedule.spiritual?.prayer?.complete!==true;
 const undatedPrayer=selectedDay<view.date&&schedule.spiritual?.prayer?.complete===true&&!schedule.spiritual.prayer.completedAt;
 const prayerStatus=pastPrayer?button('Mark prayer completed',e=>busy(e.currentTarget,()=>markPastPrayerComplete(context,e.currentTarget)),'text-button'):undatedPrayer?el('p',{class:'save-meta'},'Prayer completed, Time not recorded'):null;
 replaceSchedule(el('section',{class:'today-review panel','aria-labelledby':'day-review-title'},el('div',{class:'panel-heading'},el('h2',{id:'day-review-title'},'Schedule'),ctx.state.session?.mode?button('Add event',()=>editEvent(),'quiet compact'):null,toggle),navigation,prayerStatus,timeline,hidden.length?el('details',{open:scheduleEditing},el('summary',{},'Hidden entries'),hidden.map(r=>{const intent=entryIntent({id:r.data.entryId},context,true);return button('Restore '+(r.data.source?.kind||'entry'),e=>busy(e.currentTarget,()=>saveCorrection(intent,{...intent.original,hidden:false},false,e.currentTarget)),'quiet compact');})):null));if(!scheduleEditing)swipeDays(scheduleHost.querySelector('.today-review'),changeDay);
 replace(dayOptionsHost,selectedDay===view.date&&ctx.capabilities?.replan!==false?dayOptions(context):null);

 }

 function dayOptions(context){
  const replan=button('Replan remaining time',async e=>{if(!ownsControl(e.currentTarget)||!currentSchedule(context))return;const witness=publication();try{const preview=await ctx.request('/api/replan');if(!currentSchedule(context)||!ownsPublication(context,witness))return;modal('Replan remaining time',el('div',{},...preview.changes.map(c=>el('p',{},c.title+' · '+formatTime(c.from)+' → '+formatTime(c.start))),preview.changes.length?button('Apply these changes',e=>busy(e.currentTarget,async()=>{if(!ownsControl(e.currentTarget))return;if(!currentSchedule(context))throw Error('This schedule changed. Review a new replan before applying it.');const applying=publication();await ownedResult(context,applying,()=>ctx.request('/api/replan',{method:'POST',body:{...preview,changes:undefined,mutationId:crypto.randomUUID()}}));if(ownsPublication(context,applying)){closeOwnedDialog(e.currentTarget);await refreshSaved(context);}})):el('p',{},'No safe flexible moves are needed. Fixed commitments and recorded completions stay unchanged.')));}catch(error){if(currentSchedule(context)&&ownsPublication(context,witness))modal('Plan unavailable',el('p',{},error.message));}},'text-button');
  return el('details',{},el('summary',{},'Day options'),replan,view.carryForward?.length?el('details',{},el('summary',{},'Unfinished tasks carried forward'),...view.carryForward.map(t=>button(t.title+' · Original due '+formatDate(t.originalDeadline),()=>ctx.go('school?task='+encodeURIComponent(t.id)),'text-button'))):null);
 }



 function render(){notifications?.destroy();clearInterval(countdown);cardDetails.splice(0).forEach(d=>d.destroy());

  if(disposed)return;view=ctx.state.bootstrap.today||{};

  const action=view.nowAction;

  if(!action){replace(root,panel('Today needs a refresh',el('p',{},'The current recommendation is unavailable.'),button('Refresh Today',()=>ctx.refresh({redraw:true}))));return;}

  const cards=chronologicalCards({...view,now:view.now||ctx.state.bootstrap.now}),index=Math.max(0,Math.min(cards.items.length-1,cards.current+cardOffset)),shown=cards.items[index];cardOffset=index-cards.current;

  const prev=button(controlIcon('left'),()=>{cardOffset--;scrollSelection=true;render();},'quiet icon-button'),next=button(controlIcon('right'),()=>{cardOffset++;scrollSelection=true;render();},'quiet icon-button');prev.setAttribute('aria-label','Previous schedule item');next.setAttribute('aria-label','Next schedule item');prev.disabled=index===0;next.disabled=index===cards.items.length-1;

  const nowDate=new Date(view.now||ctx.state.bootstrap.now||Date.now()),clockText=formatTime(nowDate),start=Date.parse(shown.start),end=Date.parse(shown.end),lit=Number.isFinite(start)&&end>start?Math.max(0,Math.min(12,Math.ceil((nowDate.valueOf()-start)/(end-start)*12))):0;
  const displayMeta=[shown.position!=='Now'?shown.position:null,shown.target?.day&&shown.target.day!==view.date?formatDate(shown.target.day):null,shown.start&&shown.position!=='Now'?formatTime(shown.start):null,shown.end?'Until '+formatTime(shown.end):shown.suggestedMinutes?shown.suggestedMinutes+' min':null].filter(Boolean).join(', ');
  const hero=el('section',{class:'panel today-now instrument-display now-'+shown.position.toLowerCase(),'aria-label':'Now'},
   el('time',{class:'display-clock num',datetime:nowDate.toISOString()},clockText),
   el('div',{class:'display-date'},new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'}).format(new Date(date()+'T12:00:00Z'))),
   el('div',{class:'display-current'},el('h2',{},el('span',{class:'led'+(shown.position==='Now'?' live':'')}),canOpen(shown.target)?button(shown.title,()=>open({...shown.target,day:shown.target.day||view.date}),'text-button now-start'):shown.title),el('p',{class:'now-duration'},displayMeta),!cardOffset&&view.upcoming?el('p',{class:'display-next'},'Next: '+view.upcoming.title+' '+formatTime(view.upcoming.start)):null),
   el('div',{class:'display-segments','aria-label':lit+' of 12 progress segments'},...Array.from({length:12},(_,i)=>el('i',{class:i<lit?'on':''}))),
  );
  clearTimeout(displayTimer);
  displayUpdate=function refreshDisplay(){
   clearTimeout(displayTimer);if(disposed||document.hidden)return;
   const received=ctx.state.bootstrap.receivedAt??Date.now(),elapsed=Math.max(0,Date.now()-received),currentTime=new Date(nowDate.valueOf()+elapsed);
   const clock=hero.querySelector('.display-clock');clock.textContent=formatTime(currentTime);clock.setAttribute('datetime',currentTime.toISOString());
   const count=Number.isFinite(start)&&end>start?Math.max(0,Math.min(12,Math.ceil((currentTime.valueOf()-start)/(end-start)*12))):0;
   const segments=hero.querySelector('.display-segments');segments.setAttribute('aria-label',count+' of 12 progress segments');[...segments.children].forEach((segment,i)=>segment.classList.toggle('on',i<count));
   displayTimer=setTimeout(displayUpdate,60000-currentTime.valueOf()%60000);displayTimer.unref?.();
  };
  displayUpdate();
  const back=button('Now',()=>{cardOffset=0;render();},'quiet compact now-return');back.setAttribute('aria-label','Back to now');back.disabled=!cardOffset;
  const nowKeys=el('div',{class:'now-navigation'},prev,back,next);const segments=hero.querySelector('.display-segments');hero.append(el('div',{class:'display-footer'},segments,nowKeys));const countdownNode=el('output',{class:'now-countdown','aria-label':'Time remaining'});hero.querySelector('.now-duration').append(countdownNode);const tick=()=>{const now=Date.parse(ctx.state.bootstrap.now)+Date.now()-(ctx.state.bootstrap.receivedAt??Date.now()),seconds=Math.max(0,Math.ceil((Date.parse(shown.end)-now)/1000));countdownNode.textContent=' · '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' left';};tick();countdown=setInterval(tick,1000);swipeDays(hero,d=>{cardOffset+=d;scrollSelection=true;render();});

  notifications=notificationWidgets((view.alerts||[]).map(a=>({title:a.title,body:a.reason||a.detail||a.events?.map(e=>`${e.title||'Untitled event'}, ${range(e)}`).join(' / '),severity:a.severity||(/blocked|unverified|overdue|failed/i.test(a.title)?'blocked':'warning'),activate:()=>open(a.target)})),{className:'today-warnings'});
  selectedCard=cardOffset?shown:null;

  if(!scheduleLoading&&!scheduleError&&selectedDay===view.date)schedule=view;renderSchedule();

  const notices=view.dayNotices?.length?el('details',{class:'day-notices'},el('summary',{},'School calendar notices'),view.dayNotices.map(e=>button(`${e.title}, ${formatDate(e.start)}`,()=>eventDetails(e.id),'list-button'))):null;

  const updates=panel(null);updates.setAttribute('aria-label','Updates');updates.hidden=true;

  function paintUpdates(){const unread=ctx.records('notification').filter(r=>r.data.status==='unread'&&!(ctx.state.session?.environment==='beta'&&r.data.url?.startsWith('https://example.invalid/')));updates.hidden=!unread.length;replace(updates,...unread.map(r=>el('article',{class:'practice-row'},el('p',{},r.data.message),safeLink(r.data.url,'Open beta'),button('Dismiss',event=>busy(event.currentTarget,async()=>{const result=await ctx.action('notification-read',{id:r.id,version:r.version});showResult(result,'Update dismissed.');if(!result.pending){r.data={...r.data,status:'read'};paintUpdates();}}),'quiet compact'))));}

  paintUpdates();

  const application=ctx.state.bootstrap.applications?.[0],steps=correctedSteps({id:application?.id,points:[null,null,null,null,application?.answer,application?.peopleAnswer]},ctx.records('devotional-step')).map(s=>s.text).slice(0,2);const applicationButton=steps.length?button(el('span',{},...steps.map(s=>el('span',{class:'application-line'},s))),()=>openApplication(application,()=>ctx.go('devotional?day='+view.date+'&entry='+encodeURIComponent(application.id))),'text-button today-applications'):null;

  const checkins=friendReminders.node;
  const photoButton=ctx.capabilities?.dailyPhotos===false?null:button(controlIcon('camera'),()=>ctx.go('photos'),'quiet icon-button today-photo-button');photoButton?.setAttribute('aria-label','Daily photos');
  const dueRows=(view.academicRanked||view.school?.ranked||ctx.records('task')).filter(t=>!['complete','completed','submitted','cancelled','archived'].includes(t.data?.status??t.status)).slice(0,4);
  const due=el('section',{},el('h2',{},'Due'),dueRows.length?dueRows.map(t=>{const d=t.data||t,urgency=deadlineUrgency(d,view.date||ctx.date(),Date.parse(ctx.state.bootstrap.now||view.now)||Date.now());return button(el('span',{class:'today-list-row'},el('span',{},d.title),el('small',{class:urgency},d.dueAt||d.dueDate?formatDate(d.dueAt||d.dueDate):'Date unknown')),()=>ctx.go('school?brief='+encodeURIComponent(t.id||t.taskId)),'text-button today-due');}):el('p',{class:'empty'},'No saved due work.'));
  const reminders=el('section',{},el('h2',{},'Reminders'),...(view.dueReminders||[]).map(r=>button(el('span',{class:'today-list-row'},el('span',{},r.title)),()=>open(r.target),'text-button now-reminder')),button('Add reminder',()=>ctx.go('reminders?create=1'),'section-spacer'));
  reminders.classList.add('now-reminders');reminders.setAttribute('aria-label','Due reminders');
  replace(root,el('div',{class:'today-dispatcher'},
   el('div',{class:'today-layout'},el('div',{class:'today-now-column'},hero),
    el('div',{class:'page-heading'},el('div',{},el('div',{class:'today-title-row'},el('h1',{},'Today'))),el('div',{class:'actions workspace-tools'},notifications.bell,photoButton,ctx.capabilities?.personalAssistant===false?null:assistantButton(ctx,'today'))),
    applicationButton,scheduleHost,el('aside',{class:'today-rail'},el('div',{class:'today-lists'},due,canOpen({route:'reminders'})?reminders:null),el('div',{class:'today-rail-content'},notifications.node,checkins,dayOptionsHost,updates))),notices));

  selectScheduleRow(scheduleHost,selectedCard,{scroll:scrollSelection});scrollSelection=false;
  releaseApplicationFit();if(applicationButton)releaseApplicationFit=fitApplicationLines(applicationButton,steps);releaseReminderFit();
  ctx.renderWorkspaceStatus?.();
  clearTimeout(timer);

  if(!document.hidden&&view.nextRecomputeAt){const serverNow=Date.parse(view.now||ctx.state.bootstrap.now),delay=Math.max(250,Date.parse(view.nextRecomputeAt)-(Number.isFinite(serverNow)?serverNow:Date.now())-Math.max(0,Date.now()-(ctx.state.bootstrap.receivedAt??Date.now()))+100);timer=setTimeout(()=>{if(document.hidden)return;void ctx.refresh().catch(()=>{if(!disposed){replace(hero,el('h1',{},'Today could not refresh'),el('p',{},'Check your commitments before starting. Your saved records are unchanged.'),button('Retry',()=>ctx.refresh()));}});},Math.min(delay,2147483647));timer.unref?.();}

 }

 render();

 const query=routeQuery();if(query.get('day')&&query.get('day')!==view.date){selectedDay=query.get('day');await changeDay(0);}if(query.get('event'))eventDetails(query.get('event'));else if(query.get('detail')==='conflicts')conflicts();

 const visibility=()=>{if(document.hidden){clearTimeout(timer);clearTimeout(displayTimer);}else displayUpdate();};document.addEventListener('visibilitychange',visibility);

 return {update(){if(disposed)return;void friendReminders.load();render();if(selectedDay!==view.date)void loadDay(selectedDay,false);},destroy(){notifications?.destroy();friendReminders.destroy();scheduleDetails.splice(0).forEach(d=>d.destroy());cardDetails.splice(0).forEach(d=>d.destroy());disposed=true;clearInterval(countdown);releaseApplicationFit();releaseReminderFit();clearTimeout(timer);clearTimeout(displayTimer);document.removeEventListener('visibilitychange',visibility);}};

}
