import {academicCoverageIssues} from '../academic-coverage.js';
import{mountAssignmentBrief,workloadIndicator}from'../assignment-brief.js';
import {schoolRefresh} from '../school-refresh.js';
import {trashEntryButton} from '../deleted.js';
import {mountLearningNotes} from '../learning-notes.js';
import {openTaskTools,deadlineInbox,editTask} from '../task-tools.js';
import {compactDisclosure,controlIcon,helpControl} from '../quiet-controls.js';
import {assistantButton,mountAssistant} from '../assistant-chat.js';
import { sectionTabs,el, replace, append, button, heading, panel, empty, field, select, status, formatDate, formatTime, getDisplayTimeZone, duration, recordData, safeLink, modal, busy, showResult, errorNotice, toast, download } from '../ui.js';
import {routeQuery} from '../targets.js';
import { mountCoop } from './coop.js';
import {openHandoff} from './handoff.js';
import {mountLectures} from './lectures.js';

export async function mount(root, ctx) {
  if(routeQuery().has('learning'))return mountLearningNotes(root,ctx);
  if(routeQuery().has('work'))return (await import('../coursework-editor.js')).mountCoursework(root,ctx);
  if(routeQuery().has('brief'))return mountAssignmentBrief(root,ctx);
  if(routeQuery().has('assistant')){const task=ctx.records('task').find(t=>t.id===routeQuery().get('help'));return mountAssistant(root,ctx,'academics',task?{initialKey:task.id,initialMessage:'Help me understand and start '+task.data.title+'. Retrieve task '+task.id+' and its instructions. Explain the next useful step, without doing the complete graded work.',sendInitial:true}:{});}
  if(routeQuery().has('lectures'))return mountLectures(root,ctx);
  const tasks = ctx.records('task'); const courses = ctx.records('course'); const materials = ctx.records('material'); const jobNode = el('div'); const watchers = []; let destroyed = false; let draftDirty = false;
  const disclosures=[],taskMenus=[];const keep=d=>{disclosures.push(d);return d.node;};const taskHost = el('div'); const courseHost = el('div'); const workHost = el('div');
  const schoolStates=(ctx.state.bootstrap.integrations||[]).filter(r=>['learn','outlook','careers'].includes(r.id));
  const courseworkCoverage=el('details',{class:'coursework-coverage'},el('summary',{},'Coursework coverage is partial'),el('p',{},'These are the known saved tasks. External quizzes, unreleased materials and unread course pages may contain more work. Check each course before assuming nothing else is due.'),...schoolStates.filter(r=>r.id==='learn').map(r=>el('p',{},'Last automated collection: '+(r.data?.lastCollectionAt?formatDate(r.data.lastCollectionAt)+' at '+formatTime(r.data.lastCollectionAt):'not verified'))));
  const coverageIssues=academicCoverageIssues({courses,integrations:schoolStates});
  const coverageAlert=el('section',{id:'academic-coverage',class:'form-stack',tabindex:-1},...coverageIssues.map(i=>el('article',{class:'today-alert'},el('div',{},el('h2',{},i.title),el('p',{},i.reason)),el('a',{href:i.url,target:'_blank',rel:'noopener noreferrer',class:'text-button'},'Open source'))));
  const freshness=el('details',{},el('summary',{},'Source status'),...schoolStates.map(record=>{const d=record.data;return el('p',{class:'save-meta'},`${d.provider||record.id}: collected ${d.lastCollectionAt?formatDate(d.lastCollectionAt)+' at '+formatTime(d.lastCollectionAt):'not verified'}. Interpreted ${d.lastInterpretationAt?formatDate(d.lastInterpretationAt)+' at '+formatTime(d.lastInterpretationAt):'not verified'}. Coverage: ${d.coverage||d.status||'unknown'}.`);}));append(courseHost,freshness);
  let next,nextData={};const best=panel(null);let heroMenu=null;
  const liveNotes=button('Live Notes',()=>ctx.go('school?lectures'),'quiet compact');
  const refreshControl=schoolRefresh(ctx),refreshSources=refreshControl.node;disclosures.push(refreshControl);
  function renderBest(){heroMenu?.destroy();heroMenu=null;const ranked=ctx.state.bootstrap.today?.academicRanked||ctx.state.bootstrap.today?.school?.ranked||ctx.records('task');next=ctx.state.bootstrap.today?.academicNext||ranked.find(t=>!recordData(t).blocked&&!['complete','completed','submitted','cancelled','archived','blocked'].includes(recordData(t).status));nextData=recordData(next);replace(best, el('div',{class:'row'},el('h2', {}, nextData.title || 'No saved outstanding academic task'),nextData.title?completeTask(next):null),nextData.title?el('p',{class:'save-meta'},courses.find(c=>c.id===nextData.courseId)?.data.code, nextData.dueAt||nextData.dueDate?el('strong',{},' · Due '+formatDate(nextData.dueAt||nextData.dueDate)+(nextData.dueAt?' · '+formatTime(nextData.dueAt):'')):null):null, !nextData.title?el('p',{},'Refresh sources to find released tasks.'):null, nextData.nextStep ? el('p', {}, nextData.nextStep) : null,nextData.title?workloadIndicator(nextData):null,
    nextData.title ? el('div', { class: 'actions' }, button('Open work', () => openWorkspace(next)), taskTools(next,{hero:true})) : null);
best.classList.add('hero-action');}
  renderBest();
  const capacity=ctx.state.bootstrap.today?.capacityWarning;if(capacity?.coverage!=='unavailable'&&capacity?.shortfallMinutes>0)append(best,el('details',{},el('summary',{},'This week needs a decision'),el('p',{},'About '+capacity.requiredMinutes+' minutes of work are due, with '+capacity.availableMinutes+' saved free minutes. '+capacity.unknownTaskIds.length+' tasks still lack an estimate.'),el('p',{},'Review scope, estimates or commitments before accepting more work.')));
  async function inspire(record){ctx.go('school?assistant=new&help='+encodeURIComponent(record.id||record.taskId));}
  function saveTaskProgress(buttonNode, payload, editor, success, unchanged = () => true) {
    const current = () => !destroyed && editor.dialog.open && editor.dialog.contains(editor.body);
    const feedback = (message, error = false) => { editor.notice.textContent = message; editor.notice.hidden = false; editor.notice.setAttribute('role', error ? 'alert' : 'status'); editor.notice.classList.toggle('error', error); };
    return busy(buttonNode, async () => {
      if (!current()) return;
      editor.notice.hidden = true;
      try {
        const result = await ctx.action('task-progress', payload);
        if (!current()) return result;
        if (result.pending) { feedback(result.reason || 'Save is pending. Your progress stays here.'); return result; }
        if (!unchanged()) { feedback('Earlier progress saved. Your newer edits are still here.'); return result; }
        editor.dialog.close(); showResult(result, success);
        await ctx.refresh();
        if (!destroyed) { renderBest(); renderTasks(); }
        return result;
      } catch (error) {
        if (current()) feedback(error?.message || 'Could not save progress. Your edits are still here.', true);
        return null;
      }
    });
  }
  function progress(record) {
    const data = recordData(record); const note = field('What did you complete or discover?', { multiline: true, required: true, maxLength: 6000 }); const minutes = field('Minutes worked', { type: 'number', min: 0, max: 1440, value: 25 }); const remaining = field('Your estimate of minutes remaining', { type: 'number', min: 0, max: 100000, value: data.remainingMinutes ?? '' }); const state = select('Task state', [{ value: 'in-progress', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'complete', label: 'Completed' }], data.status || 'in-progress');
    const editor = { notice: el('p', { class: 'notice', role: 'status', 'aria-live': 'polite', hidden: true }) };
    const snapshot = () => [note.input.value, minutes.input.value, remaining.input.value, state.input.value];
    const save = button('Save progress', event => {
      if (!note.input.value.trim()) return note.input.reportValidity();
      const values = snapshot();
      return saveTaskProgress(event.currentTarget, { taskId: record.id || record.taskId, note: values[0], minutes: Number(values[1]), ...(values[2] !== '' ? { remainingMinutes: Number(values[2]) } : {}), status: values[3] }, editor, 'Progress saved. Remaining work will be reassessed.', () => snapshot().every((value, index) => value === values[index]));
    });
    editor.body = el('div', { class: 'form-stack' }, el('h3', {}, data.title), note.node, el('div', { class: 'field-grid' }, minutes.node, remaining.node), state.node, editor.notice, save);
    editor.dialog = modal('Update your progress', editor.body);
  }
  function completeTask(record) {
    const b = button(controlIcon('check'), () => {
      const editor = { notice: el('p', { class: 'notice', role: 'status', 'aria-live': 'polite', hidden: true }) };
      editor.body = el('div', {}, el('p', {}, recordData(record).title), editor.notice, button('Complete task', event => saveTaskProgress(event.currentTarget, { taskId: record.id || record.taskId, status: 'complete', remainingMinutes: 0, minutes: 0, note: '' }, editor, 'Completed')));
      editor.dialog = modal('Mark complete?', editor.body);
    }, 'quiet icon-button task-done');
    b.setAttribute('aria-label', 'Mark ' + recordData(record).title + ' complete'); return b;
  }
  function taskTools(record,{hero=false}={}){const d=compactDisclosure({label:'Task options',icon:'more',content:()=>el('div',{class:'form-stack'},button('Edit task',()=>editTask(ctx,ctx.records('task').find(t=>t.id===(record.id||record.taskId))),'text-button'),button('Planning, rubric and receipts',()=>openTaskTools(ctx,record.id||record.taskId),'text-button'),button('Help me start',()=>inspire(record),'text-button'),button('Prepare ChatGPT handoff',()=>openHandoff(ctx,record.id||record.taskId),'text-button'),button('Update progress',()=>progress(record),'text-button'),trashEntryButton(ctx,()=>{const r=ctx.records('task').find(r=>r.id===(record.id||record.taskId));return {kind:'task',id:r?.id,version:r?.version,label:r?.data.title};},()=>ctx.refresh({redraw:true})))});if(hero)heroMenu=d;else taskMenus.push(d);return d.node;}
  const taskSort=select('Sort',[{value:'priority',label:'Priority'},{value:'due',label:'Due date'}],(await ctx.store.get('academics:task-sort'))?.value==='due'?'due':'priority');
  taskSort.input.setAttribute('aria-label','Sort academic tasks');
  taskSort.input.onchange=()=>{void ctx.store.put('academics:task-sort',{value:taskSort.input.value});renderTasks();};
  function dueKey(record){const d=record.data;if(d.dueAt&&Number.isFinite(Date.parse(d.dueAt))){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:getDisplayTimeZone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(d.dueAt)),part=k=>parts.find(p=>p.type===k)?.value;return part('year')+'-'+part('month')+'-'+part('day')+'T'+part('hour')+':'+part('minute');}return /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate??'')?d.dueDate+'T99':'9999';}
  function renderTasks() {best.hidden=taskSort.input.value==='due';taskMenus.splice(0).forEach(d=>d.destroy());
    const rankIds = new Map((ctx.state.bootstrap.today?.academicRanked || ctx.state.bootstrap.today?.school?.ranked || []).map((item, index) => [item.id, index]));
    const items = ctx.records('task').filter(record => taskSort.input.value==='due'||record.id!==(next?.id||next?.taskId)).filter(record => !['complete','completed','submitted','cancelled','archived'].includes(record.data.status)).slice().sort((a,b)=>(taskSort.input.value==='due'?dueKey(a).localeCompare(dueKey(b)):0)||((rankIds.get(a.id)??100000)-(rankIds.get(b.id)??100000)));
    replace(taskHost, ...(items.length ? items.map(record => { const data = {...record.data,...(ctx.state.bootstrap.today?.academicRanked??[]).find(t=>t.id===record.id)}; const course = courses.find(course => course.id === data.courseId)?.data;
      return el('article', { class: 'task-card' }, el('div', { class: 'row' }, el('div', {}, course?.code&&!data.title?.includes(course.code)?el('span',{class:'course-label'},course.code):null, el('h3', {}, data.title)), data.blocked?status(data.dependencyIds?.length?'Prerequisite first':'Needs input','unknown'):data.status==='blocked'?status('Needs input','unknown'):null,completeTask(record)),
        el('p', {}, data.dueAt||data.dueDate?el('strong',{},`Due ${formatDate(data.dueAt||data.dueDate)}${data.dueAt?` at ${formatTime(data.dueAt)}`:''}`):el('span',{class:'muted'},'Due date unknown')), data.nextStep ? el('p', {}, data.nextStep) : null,
        workloadIndicator(data),data.latestStartAt?el('p',{class:'save-meta'},'Latest start '+formatDate(data.latestStartAt)+' · '+formatTime(data.latestStartAt)):null,
        data.startAdvice&&!data.startAdvice.startsWith('Plan a work block before')?el('p',{class:'save-meta'},data.startAdvice):null,
        el('div', { class: 'actions' }, button('Open work', () => openWorkspace(record)), taskTools(record)), safeLink(data.sourceUrl || data.source?.sourceUrl || data.sourceUrls?.[0], 'Instructions and source'));
    }) : (nextData.title?[]:[empty('No outstanding tasks are saved.')])));
  }
  for (const course of courses) {
    
    const data = course.data; const linked = materials.filter(material => material.data.courseId === course.id);
    const policy = data.policyEvidence?.text || (typeof data.aiPolicy === 'string' ? data.aiPolicy : data.aiPolicy?.text || data.policyText || data.policy?.text);
    append(courseHost, el('div', { class: 'practice-row' }, el('h3', {}, data.title || data.name || data.code), el('p', { class: 'muted' }, [data.code, data.term, (data.lastFetchedAt || data.source?.retrievedAt) ? `Fetched ${formatDate(data.lastFetchedAt || data.source?.retrievedAt)}` : ctx.state.session?.mode==='demo'?'Local demo materials':'Source has not been refreshed'].filter(Boolean).join(' · ')), el('div',{class:'actions'},el('a',{class:'source-link',href:'#school?lectures='+encodeURIComponent(course.id)},'Lectures'),el('a',{href:'#school?learning='+encodeURIComponent(course.id),class:'source-link'},'Learning map'),safeLink(data.sourceUrl || data.url || data.source?.sourceUrl, 'Open LEARN')), el('details', {}, el('summary', {}, 'Assistance policy and materials'), policy ? el('p', { class: 'detail-body' }, policy) : el('p', { class: 'notice' }, 'The complete AI policy is not yet recorded. Assistance is limited to organization and planning.'), data.policyClarification ? el('p', { class: 'notice info' }, typeof data.policyClarification === 'string' ? data.policyClarification : data.policyClarification.text) : null, linked.length ? linked.map(material => el('div', { class: 'practice-row' }, el('h3', {}, material.data.title), safeLink(material.data.sourceUrl || material.data.url), material.data.fetchedAt ? el('p', { class: 'muted' }, `Read ${formatDate(material.data.fetchedAt)}`) : null)) : empty('No material references have been saved yet.'))));
  }
  const recentReads=materials.filter(record=>record.data.browserRead);
  const portalNotices=materials.filter(record=>record.data.portalRead).sort((a,b)=>(b.data.source?.retrievedAt||'').localeCompare(a.data.source?.retrievedAt||''));
  const portalStates=(ctx.state.bootstrap.integrations||ctx.records('integration')).filter(record=>['outlook','careers'].includes(record.id||record.data?.provider));
  if(portalNotices.length||portalStates.length)append(courseHost,el('details',{},el('summary',{},'School and co-op notices'),el('p',{class:'muted'},'Saved list previews only. Full messages and complete posting requirements have not been read.'),portalStates.map(record=>{const data=recordData(record);return el('div',{class:'practice-row'},el('h3',{},data.title||data.provider||record.id),status(data.status==='preview-refreshed'?'Preview read':data.status||'Unknown',data.status==='preview-refreshed'?'saved':'unknown'),data.authenticatedDashboard&&data.gate==='commitment'?el('p',{class:'muted'},'Dashboard access verified. Recruiting access still needs your review.'):null,data.actionRequired?el('p',{class:'notice'},data.actionRequired):null);}),portalNotices.map(record=>{const data=record.data,source=data.sourceRefresh?.source||data.source,preview=data.sourceRefresh?.text??data.text;return el('details',{class:'practice-row'},el('summary',{},data.title),el('p',{class:'save-meta'},`${data.portalRead.provider==='outlook'?'School Outlook':'careers'} · List preview · ${source?.retrievedAt?`Read ${formatDate(source.retrievedAt)} at ${formatTime(source.retrievedAt)}`:'Read time unavailable'}`),el('div',{class:'detail-body'},preview||'No preview text was visible.'),safeLink(source?.sourceUrl||data.url,'Open original source'));})));
  if(recentReads.length)append(courseHost,el('details',{},el('summary',{},'Recent material reads'),recentReads.map(record=>{const data=record.data,read=data.browserRead;return el('div',{class:'practice-row'},el('h3',{},data.title),safeLink(data.url||data.source?.sourceUrl),el('p',{class:'save-meta'},read.firstPage?`Read pages ${read.firstPage} to ${read.lastPage} of ${read.totalPages}.`:'Page range unavailable.'),data.requiresDownload?el('p',{class:'notice'},'The document text needs a readable preview or an approved download.'):el('p',{class:'muted'},read.coverage==='full-text'?'The complete document was read.':'Only part of this document was read. Other pages remain unverified.'),data.sourceRefresh?.text?el('details',{},el('summary',{},'Read the latest captured pages'),el('div',{class:'detail-body'},data.sourceRefresh.text)):null,data.text?el('details',{},el('summary',{},data.sourceRefresh?'Read the earlier saved source':'Read captured source text'),el('p',{class:'save-meta'},`Saved ${formatDate(data.source?.retrievedAt)}`),el('div',{class:'detail-body'},data.text)):null);})));
  
  if (!courses.length) append(courseHost, empty('No verified courses are loaded. Use Refresh school sources to discover accessible courses.'));
  async function openWorkspace(task,existing){if(task&&!existing){ctx.go('school?brief='+encodeURIComponent(task.id||task.taskId));return;}ctx.go('school?work='+encodeURIComponent(existing?.id||'new')+(task?'&task='+encodeURIComponent(task.id||task.taskId):''));}
  const savedWork = panel('Saved work', workHost, button('New workspace', () => openWorkspace(null), 'quiet'));
  const workspaces = ctx.records('coursework'); append(workHost, ...(workspaces.length ? workspaces.map(record => record.data.downloadUrl?el('div',{class:'practice-row'},safeLink(record.data.downloadUrl,record.data.title||'Open saved file')):button(record.data.title || 'Working notes', () => openWorkspace(tasks.find(task => task.id === record.data.taskId), record), 'list-button')) : [empty('No saved work.')]));
  const coop = panel('Co-op');const coopView=await mountCoop(coop,{...ctx,openTask:task=>openWorkspace(task)});
  const area=el('section',{class:'academic-section',role:'tabpanel'}),parts={tasks:el('div',{},coverageAlert,best,courseworkCoverage,deadlineInbox(ctx),el('div',{class:'actions'},taskSort.node),el('p',{class:'save-meta'},'Priority weighs remaining work, difficulty and days left. Overdue work comes first. Review tasks with unknown deadlines separately.'),taskHost),courses:courseHost,work:savedWork,coop};let selected=routeQuery().get('view')||'tasks';if(!parts[selected])selected='tasks';const tabs=sectionTabs([{id:'tasks',label:'Tasks'},{id:'courses',label:'Courses'},{id:'work',label:'My work'},{id:'coop',label:'Co-op'}],selected,(value,label)=>{replace(area,parts[value]);area.setAttribute('aria-labelledby',label);const q=routeQuery();q.set('view',value);history.replaceState(null,'','#school?'+q);ctx.state.routeHash=location.hash;});area.id=tabs.panelId;area.setAttribute('aria-labelledby',tabs.labelId);replace(area,parts[selected]);replace(root,heading('Academics',null,el('div',{class:'actions'},assistantButton(ctx,'academics'),liveNotes,refreshSources)),tabs.node,jobNode,area);if(routeQuery().get('detail')==='coverage'&&coverageIssues.length){coverageAlert.scrollIntoView?.({block:'start'});coverageAlert.focus?.({preventScroll:true});}
  renderTasks();
  const lastHelp=await ctx.store.get('inspire:last-task');if(lastHelp?.id){try{const savedHelp=(await ctx.request('/api/jobs?taskId='+encodeURIComponent(lastHelp.id))).jobs?.[0];if(savedHelp&&!destroyed)watchers.push(ctx.showJob(jobNode,savedHelp));}catch{}}
  const requestedTask=routeQuery().get('task');
  if(requestedTask){const task=tasks.find(t=>t.id===requestedTask);if(task)await openWorkspace(task);else modal('Task unavailable',el('p',{},'This saved task is no longer available. Choose a task from the current list.'));}
  return {update:()=>{if(!draftDirty&&!coopView.dirty()){renderBest();renderTasks();}}, dirty: () => draftDirty||coopView.dirty(), destroy: () => { destroyed = true;heroMenu?.destroy();[...disclosures,...taskMenus].forEach(d=>d.destroy());coopView.destroy(); watchers.forEach(watcher => watcher.stop()); } };
}
