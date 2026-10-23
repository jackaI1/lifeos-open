import { DEFAULT_TIME_ZONE, instant, localDate, weekday, addDays, zonedDateTime, mergeIntervals, availableIntervals } from './time.mjs';
import {latestStart} from './planning-insights.mjs';

const ADMIN_ACTIONS = new Set(['ingest', 'schedule', 'deadlines', 'estimate', 'organize', 'next-step']);
const LEARNING_ACTIONS = new Set(['explain-topic', 'unmarked-practice', 'guided-example', 'critique']);

/** Original policies remain evidence; the owner's September 17 interpretation governs permitted assistance. */
export function checkAcademicPolicy({policy={},action,marked=null}){
 const blocked=['submit','send-message','fabricate-results','fabricate-citations','complete-graded-work'];
 if(blocked.includes(action))return {allowed:false,reason:'LifeOS cannot produce complete graded work, submit, send messages or fabricate evidence.'};
 if(ADMIN_ACTIONS.has(action))return {allowed:true,scope:'administrative',reason:'Reading, explaining and organizing requirements is permitted by the owner clarification.'};
 if(LEARNING_ACTIONS.has(action)||['parse-instructions','explain-instructions','research','ideate','summarize','task-initiation'].includes(action))return {allowed:true,scope:'learning',reason:'Teaching and assistance are permitted; do not produce a complete graded deliverable.',disclosure:policy.requiredDisclosure??null};
 if(action==='generate-work')return {allowed:marked===false,scope:marked===false?'learning':'administrative',reason:marked===false?'Unmarked examples are permitted.':'Do not produce complete graded work. Offer explanation, research or a starting framework instead.'};
 return {allowed:false,reason:'Unknown assistance action.'};
}

export function reassessTaskProgress({ task, evidence }) {
  if (!task?.id || !evidence?.id || !['saved-draft', 'file-upload', 'work-session', 'progress-note'].includes(evidence.type)) throw new Error('A task and recognized progress evidence are required');
  const prior = task.progressEvidence ?? [];
  const duplicate = prior.find(item => item.id === evidence.id);
  if (duplicate) return { ...task, reassessmentNeeded: task.reassessmentNeeded ?? true };
  if (evidence.remainingMinutes != null && (!Number.isFinite(evidence.remainingMinutes) || evidence.remainingMinutes < 0)) throw new Error('Remaining effort must be a nonnegative estimate');
  if (evidence.progress != null && (!Number.isFinite(evidence.progress) || evidence.progress < 0 || evidence.progress > 1)) throw new Error('Progress must be between zero and one');
  const updated = { ...task, progressEvidence: [...prior, { ...evidence }], reassessmentNeeded: true };
  // Time on a calendar, text length and uploaded files alone never mean completion.
  if (evidence.remainingMinutes != null) { updated.remainingMinutes = evidence.remainingMinutes; updated.estimateSource = evidence.id; updated.estimateConfidence = evidence.confidence ?? 'self-reported'; updated.reassessmentNeeded = false; }
  if (evidence.progress != null) updated.progress = evidence.progress;
  if (evidence.explicitlyCompleted === true && evidence.type === 'progress-note') { updated.status = 'complete'; updated.completionEvidence = evidence.id; }
  return updated;
}

export function rankSchoolTasks({ tasks = [], now, capacity = [], activeTaskId = null, settings = {}, energy = 'normal', respectSchoolDay = true }) {
  const timeZone = settings.timeZone ?? DEFAULT_TIME_ZONE;
  const date = localDate(now, timeZone), current = instant(now);
  if (respectSchoolDay && weekday(date) === 0) return { ranked: [], next: null, alternatives: [], academicAllowed: false, reason: 'Sunday has no school work or planning.', interruptFocus: false };
  const all = new Map(tasks.map(task => [task.id, task]));
  const futureCapacity = [];
  // Union first so duplicate calendar-derived windows cannot create extra capacity.
  for (const slot of mergeIntervals(capacity).filter(slot => instant(slot.end) > current)) {
    let cursor = Math.max(current, instant(slot.start));
    while (cursor < instant(slot.end)) {
      const slotDate = localDate(cursor, timeZone);
      const dayEnd = instant(zonedDateTime(addDays(slotDate, 1), '00:00', { timeZone }));
      const end = Math.min(dayEnd, instant(slot.end));
      if (weekday(slotDate) !== 0) futureCapacity.push(...availableIntervals({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() }));
      cursor = end;
    }
  }
  const currentBlock = futureCapacity.find(slot => instant(slot.start) <= current && instant(slot.end) > current);
  const latestCapacity=futureCapacity.map(s=>({start:instant(s.start),end:instant(s.end)}));
  const deadlineTime = new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const ready = [], waiting = [], priorities = new Map();
  const comparePriority = (a, b) => {
    const left = priorities.get(a.id), right = priorities.get(b.id);
    return left.group - right.group || b.score - a.score || left.deadline.localeCompare(right.deadline) || String(a.id).localeCompare(String(b.id));
  };
  for (const task of tasks) {
    if (['complete','completed','submitted','cancelled','archived'].includes(task.status)) continue;
    const dependencyIds = (task.dependencies ?? []).filter(id => !['complete','completed','submitted'].includes(all.get(id)?.status));
    const min = task.effortRange?.minMinutes ?? task.estimatedMinutes ?? null, max = task.effortRange?.maxMinutes ?? task.estimatedMinutes ?? null;
    const remaining = Number.isFinite(task.remainingMinutes) ? Math.max(0, task.remainingMinutes) : Number.isFinite(max) ? Math.max(0, max) : null;
    let due = null;
    if (task.dueAt) { try { due = instant(task.dueAt); } catch { /* Preserve invalid source dates as unknown for review. */ } }
    const beforeDueMinutes = due === null ? null : futureCapacity.reduce((sum, slot) => sum + Math.max(0, (Math.min(instant(slot.end), due) - instant(slot.start)) / 60_000), 0);
    const dateOnly=typeof task.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)&&Number.isFinite(Date.parse(task.dueDate+'T12:00:00Z'))&&new Date(task.dueDate+'T12:00:00Z').toISOString().slice(0,10)===task.dueDate?task.dueDate:null;
    const dueDay=due===null?dateOnly:localDate(due,timeZone);
    const overdue = due !== null ? due < current : dueDay!==null&&dueDay<date;
    const horizon=Math.max(current,...futureCapacity.map(s=>instant(s.end)));
    const capacityKnown=due!==null&&futureCapacity.length>0&&localDate(due,timeZone)<=localDate(horizon,timeZone);
    const riskMinutes = remaining === null || beforeDueMinutes === null || !capacityKnown ? null : Math.max(0, remaining - beforeDueMinutes);
    const ageDays = task.lastWorkedAt ? Math.max(0, (current - instant(task.lastWorkedAt)) / 86_400_000) : task.createdAt ? Math.max(0, (current - instant(task.createdAt)) / 86_400_000) : 0;
    const hoursToDue = due === null ? null : (due - current) / 3_600_000;
    const dueToday=dueDay===date;
    const imminent = hoursToDue !== null ? hoursToDue >= 0 && hoursToDue <= 48 : dueDay!==null&&dueDay>=date&&dueDay<=addDays(date,2);
    const reviewCategory = ['review', 'practice', 'coop', 'preparation'].includes(task.category);
    const reviewDue = reviewCategory && (task.reviewDueAt ? instant(task.reviewDueAt) <= current : ageDays >= 3);
    // Date-only sources supply a calendar day, never an invented cutoff time.
    const daysRemaining = due !== null ? (due - current) / 86_400_000 : dueDay !== null ? (Date.parse(dueDay) - Date.parse(date)) / 86_400_000 : null;
    const difficulty = Number.isFinite(task.difficulty) ? Math.max(1, Math.min(5, task.difficulty)) : 3;
    // Difficulty adjusts effort by 0.75–1.25, so it cannot overwhelm workload.
    const difficultyWeight = 0.625 + difficulty * 0.125;
    const score = daysRemaining === null || remaining === null ? 0 : remaining * difficultyWeight / Math.max(0.25, daysRemaining);
    const availableMinutes = currentBlock?.minutes ?? 0;
    const firstStepMinutes = task.nextStepMinutes ?? (availableMinutes<15&&remaining!==null?remaining:10);
    const reason = dueToday&&due===null?'This task is due today. Confirm the cutoff time in its source.':overdue ? 'The recorded due date has passed.' : riskMinutes ? 'Remaining effort exceeds available time before the deadline.' : imminent ? 'The deadline is within two days.' : reviewDue ? 'This review or co-op work is due for attention.' : dueDay === null ? 'The due date is unknown; start with the linked instructions.' : 'Starting now protects time before the deadline.';
    const entry = { ...task, score, dueToday, dueKnown: dueDay !== null,dueTimeKnown:due!==null, overdue, imminent, riskMinutes, capacityBeforeDueMinutes: capacityKnown?beforeDueMinutes:null, capacityKnown, startAdvice:overdue||imminent||riskMinutes?'Start in your next available academic block.':dueDay===null?'Check the deadline before committing a work block.':'Plan a work block before '+dueDay+'.', remainingMinutes: remaining, effortRange: { minMinutes: min, maxMinutes: max }, dependencyIds, blocked: task.status === 'blocked' || dependencyIds.length > 0, availableMinutes, fitsFirstStep: availableMinutes >= firstStepMinutes, nextStep: task.nextStep ?? 'Open the source instructions and identify the first required action.', reason, reviewDue, policyGate: checkAcademicPolicy({ policy: task.policy, action: 'next-step', marked: task.marked }), energyMatch: energy !== 'low' || task.energy !== 'high' };
    const latest=capacityKnown?latestStart({dueAt:task.dueAt,remainingMinutes:remaining,capacity:futureCapacity,preparedCapacity:latestCapacity,now,timeZone}):{at:null,shortfallMinutes:null};entry.latestStartAt=latest.at;entry.latestStartShortfall=latest.shortfallMinutes;
    priorities.set(entry.id, {group:overdue?0:dueDay!==null?1:2,deadline:due!==null?localDate(due,timeZone)+'T'+deadlineTime.format(due):dueDay!==null?dueDay+'T99':'9999'});
    // A course's AI restriction never hides a saved obligation from deterministic planning.
    if (entry.blocked) waiting.push(entry); else ready.push(entry);
  }
  // A prerequisite inherits urgency without making the blocked dependent runnable.
  for(const blocked of waiting){const seen=new Set();const inherit=id=>{if(seen.has(id))return;seen.add(id);const entry=[...ready,...waiting].find(t=>t.id===id);if(!entry)return;if(comparePriority(entry,blocked)>0){entry.score=blocked.score;priorities.set(entry.id,{...priorities.get(blocked.id)});entry.reason='Needed before '+blocked.title;entry.requiredFor=blocked.id;}for(const dep of entry.dependencyIds)inherit(dep);};blocked.dependencyIds.forEach(inherit);}
  ready.sort(comparePriority);
  waiting.sort(comparePriority);
  const runnable = ready.filter(task => task.fitsFirstStep && task.energyMatch);
  let next = currentBlock ? runnable[0] ?? null : null;
  const lastCategories = settings.recentDispatchCategories ?? [];
  if (next && lastCategories.length >= 3 && lastCategories.slice(-3).every(category => !['review', 'practice', 'coop', 'preparation'].includes(category))) {
    const reserved = runnable.find(task => task.reviewDue && (task.nextStepMinutes ?? 10) <= 15);
    const deadlineDuringReview = reserved && ready.some(task => task.dueAt && instant(task.dueAt) >= current && instant(task.dueAt) < current + (reserved.nextStepMinutes ?? 10) * 60_000);
    if (reserved && !deadlineDuringReview) next = { ...reserved, reason: 'Protect a short review or co-op block after repeated urgent work. Deadline obligations remain visible.' };
  }
  const active = ready.find(task => task.id === activeTaskId);
  const urgentChange = Boolean(next && active && next.id !== active.id && (next.overdue || next.riskMinutes > 0) && comparePriority(next,active)<0 && (priorities.get(next.id).group<priorities.get(active.id).group || next.score>active.score*1.5));
  if (active && active.fitsFirstStep && active.energyMatch && currentBlock && !urgentChange) next = { ...active, reason: 'Continue the current focused task. The background order can wait.' };
  return { ranked: [...ready, ...waiting], next, alternatives: runnable.filter(task => task.id !== next?.id).slice(0, 3), academicAllowed: true, availableBlock: currentBlock ?? null, interruptFocus: urgentChange, reason: currentBlock ? next ? next.reason : 'No ready task fits the available block. Review blocked work or protect a break.' : 'There is no current unoccupied school block.', capacityInsufficient: ready.some(task => task.riskMinutes > 0) };
}
