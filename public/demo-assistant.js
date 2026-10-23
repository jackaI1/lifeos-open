// Authored examples only. No model, network request or private account is used.
const catalogue={
 today:[['move','Move a study block','Move my next study block 30 minutes later.'],['add','Add a walk','Add a 20-minute walk to my schedule.'],['fit','Would studying fit?','Would a 30-minute study session fit tomorrow?'],['time','Find some free time','When do I have time for a 20-minute break?']],
 academics:[['priority','Choose what to work on','What should I work on first, and why?'],['lab','Prepare for the lab','What should I bring to my next lab?'],['start','Make the first step smaller','Break my next assignment into three small steps.']],
 finances:[['budget','Check the dining budget','How much of my dining budget is left this week?'],['purchase','Check a possible purchase','Would a $15 lunch fit my dining budget?'],['review','Review spending','What should I check before planning more spending?']],
 lecture:[['explain','Explain feedback','Explain negative and positive feedback with an example.'],['quiz','Quiz me','Ask me a practice question about feedback.'],['compare','Compare two concepts','How are an input and an output different?']],
 project:[['step','Find a small first step','What is one small next step for this project?'],['checklist','Make a starting checklist','Make a short checklist to help me start this project.'],['review','Check what is missing','What should I check before working on this project?']],
 support:[['notes','Find my notes','How do I take and find lecture notes?'],['privacy','Understand demo saving','Where are my demo edits saved?'],['export','Keep a copy','How do I download a copy of my records?']]
};
export function demoAssistantOptions(scope){return (catalogue[scope]??[]).map(([id,label,message])=>({id:scope+'-'+id,label,message}));}
export const isDemoAssistant=session=>session?.mode==='demo'&&session?.services?.ai==='mock';
export function demoAssistantAnswer(scope,message,context={}){
 const option=demoAssistantOptions(scope).find(o=>o.message===message);if(!option)return null;
 const answer=(reply,proposals=[])=>({reply,proposals}),tz=context.timeZone??'America/Toronto';
 const when=value=>new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const tomorrow=context.lifeosDay?new Date(Date.parse(context.lifeosDay+'T12:00Z')+86400000).toISOString().slice(0,10):null;
 const interval=minutes=>(context.freeSlots??[]).filter(s=>option.id!=='today-fit'||!tomorrow||s.day===tomorrow).find(s=>Date.parse(s.end)-Date.parse(s.start)>=minutes*60000);
 const proposal=(operation,recordId,expectedVersion,fields,reason)=>({operation,recordId,expectedVersion,fields:Object.entries(fields).map(([name,value])=>({name,value})),reason});
 if(scope==='today'){
  const minutes=option.id==='today-fit'?30:20,slot=interval(minutes);
  if(option.id==='today-move'){
   for(const day of context.schedule??[])for(const entry of day.entries){
    if(entry.source||['completed','observed'].includes(entry.state)||!entry.end||!/study|pre-lab|feedback|watershed|academic/i.test(entry.title??'')||Date.parse(entry.start)<Date.parse(context.asOf??new Date().toISOString()))continue;
    const start=new Date(Date.parse(entry.start)+1800000).toISOString(),end=new Date(Date.parse(entry.end)+1800000).toISOString();
    if(!(context.freeSlots??[]).some(s=>Date.parse(s.start)<=Date.parse(start)&&Date.parse(s.end)>=Date.parse(end)))continue;
    return answer(`I can move “${entry.title}” to ${when(start)}. Review the times below and choose Apply change. Nothing has moved yet.`,[proposal('schedule-adjust',entry.id,entry.correctionVersion??0,{day:day.day,start,end},'Move this fictional study block 30 minutes later, keeping its duration.')]);
   }
   return answer('I could not find a future study block with enough room 30 minutes later. Nothing was changed. Try “Find some free time” to see an available window.');
  }
  if(!slot)return answer('I could not find an open window long enough in the next two days. Nothing was changed. Review Today to shorten a flexible task or choose another day.');
  const end=new Date(Date.parse(slot.start)+minutes*60000).toISOString();
  if(option.id==='today-add')return answer(`There is room for a 20-minute walk at ${when(slot.start)}. Choose Apply change to add it to this demo’s local schedule. Nothing has been added yet.`,[proposal('calendar-create',null,0,{title:'Walk',start:slot.start,end},'Use an available 20-minute window without moving existing commitments.')]);
  return answer(`${option.id==='today-fit'?'Yes. A 30-minute session fits':'There is time for a 20-minute break'} at ${when(slot.start)} until ${new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit'}).format(new Date(end))}. This is an available window, not a booking; your schedule is unchanged.`);
 }
 if(scope==='academics'){
  const next=context.tasks?.find(t=>!['complete','completed','submitted','cancelled','blocked','waiting','archived'].includes(t.status)&&t.rank!==null&&!t.blocked);
  if(option.id==='academics-lab')return null; // Existing local lab answer includes its actual room and checklist.
  if(!next)return answer('There are no ready assignments in this demo work list. Review blocked tasks or add an assignment in Academics to try planning it.');
  return answer(option.id==='academics-priority'?`Start with “${next.title}”. Priority weighs the work remaining, its difficulty and the time left before its deadline. ${next.remainingMinutes?`It has about ${next.remainingMinutes} minutes remaining. `:''}${next.nextStep??'Open its instructions and choose one small step.'}`:`For “${next.title}”: 1. Open the saved instructions and identify the deliverable. 2. ${next.nextStep??'Write down the smallest useful first action.'} 3. Save your progress and adjust the remaining-time estimate. This helps you start; it does not complete your assignment.`);
 }
 if(scope==='lecture')return answer(option.id==='lecture-quiz'?'Practice question: a thermostat measures a room below the target temperature and switches on the heater. What is the input, what is the output, and how does the feedback reduce the difference? Try explaining it before checking your notes.':option.id==='lecture-compare'?'An input enters a system; an output leaves it. For a heater, electricity is an input and heat is an output. Feedback returns information about that output, such as the room temperature, to influence the next input.':'Negative feedback reduces a difference: a thermostat turns the heater off when the room reaches its target temperature. Positive feedback reinforces a change, such as a microphone picking up its own amplified sound. These are examples from the fictional feedback lesson.');
 if(scope==='finances'){
  const remaining=context.diningCard?.remaining==null?null:context.diningCard.remaining/100;
  if(remaining===null)return answer('Set a dining budget and record your spending in Finances first; this demo cannot infer an allowance that has not been saved.');
  const amount=new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(remaining);
  return answer(option.id==='finances-review'?'Check that your latest expenses are recorded, review the category balances, then compare any planned purchase with the amount remaining. The demo does not connect to a bank or make purchases.':option.id==='finances-purchase'?`${remaining>=15?'Yes, based on the expenses currently recorded':'Not within the amount currently left'}: dining has ${amount} remaining this week. A $15 lunch would leave ${new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(remaining-15)}. Unrecorded spending can change this; nothing was purchased or logged.`:`Your saved dining budget has ${amount} remaining this week, based on the expenses recorded in this demo. Check for missing expenses before relying on that balance.`);
 }
 if(scope==='project'){const project=context.project??{},title=project.title??'this project',next=String(project.nextStep??'').trim()||'define one small result you can check today';return answer(option.id==='project-step'?`For ${title}, ${next}. Keep the first session small enough to finish and review.`:option.id==='project-checklist'?`Starting checklist for ${title}: 1. Define the result for this session. 2. ${next}. 3. Gather the notes or materials it needs. 4. Check the result before choosing another step.`:`Before starting ${title}, check the intended result, the information or materials still missing, the time available, and how you will tell whether the first step worked. No project records have changed.`);}
 if(scope==='support')return answer(option.id==='support-notes'?'Open Academics → Live Notes, choose the course, then open a saved lecture or create a new one. Pen is selected when you enter. Your drawings stay with that lecture. Recording starts only when you press Record.':option.id==='support-privacy'?'Demo edits and files are saved in this browser on this device. They are not uploaded to the LifeOS website and do not appear on another device. Clearing the browser’s site data removes its local copy; download an export if you want to keep one.':'Open Settings → Backups & export → Download my records. Save the downloaded file somewhere you can find it. This creates a copy; it does not publish or send your records.');
 return null;
}
