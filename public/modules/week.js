import {routeQuery} from '../targets.js';
import {mountProjectWorkspace} from '../project-workspace.js';
import { el, replace, append, button, heading, panel, empty, field, select, status, formatDate, formatTime, duration, recordData, modal, busy, showResult, toast } from '../ui.js';

export async function mount(root, ctx, route) {
  if (route === 'meals') return mountMeals(root, ctx);
  if(ctx.state.session?.environment==='beta'&&!routeQuery().has('classic')&&!routeQuery().has('ticket'))return mountProjectWorkspace(root,ctx,routeQuery());
  const ledger = ctx.state.bootstrap.today?.tickets || {}; const ticketHost = el('div', { class: 'ticket-grid' }); const projectHost = el('div'); const historyHost = el('div');
  async function spend(ticket) {
    const minutes = field('Minutes used', { type: 'number', min: 1, max: ticket.remainingMinutes, value: Math.min(60, ticket.remainingMinutes), required: true });
    const start = field('When did you start?', { type: 'datetime-local', required: true }); const note = field('What did you do?', { value: '', maxLength: 2000 }); const category = field('Activity category', { value: ticket.category === '*' ? 'wildcard' : ticket.category, maxLength: 100 });
    modal(`Use ${ticket.label}`, el('div', { class: 'form-stack' }, el('p', { class: 'muted' }, `${duration(ticket.remainingMinutes)} remains this week. The same time cannot count toward two tickets.`), minutes.node, start.node, ticket.category === '*' ? category.node : null, note.node, button('Record time', event => busy(event.currentTarget, async () => {
      if (!minutes.input.reportValidity() || !start.input.reportValidity()) return; const startDate = new Date(start.input.value); const end = new Date(startDate.valueOf() + Number(minutes.input.value) * 60000);
      const result = await ctx.action('ticket-spend', { ticketId: ticket.id, category: category.input.value, minutes: Number(minutes.input.value), start: startDate.toISOString(), end: end.toISOString(), note: note.input.value }); showResult(result, 'Time recorded.'); if (!result.pending) { document.querySelector('#dialog').close(); await ctx.refresh(); paint(); }
    }))));
  }
  async function paint() {
    let audit = []; try { audit = (await ctx.request('/api/audit')).items || []; } catch {}
    const current = ctx.state.bootstrap.today?.tickets || {};
    replace(ticketHost, ...(current.tickets?.length ? current.tickets.map(ticket => el('article', { class: 'ticket' }, el('h3', {}, ticket.label), el('div', { class: 'metric' }, duration(ticket.remainingMinutes)), ticket.spentMinutes>0?el('small',{class:'muted'},duration(ticket.spentMinutes)+' used'):null, button(ticket.remainingMinutes > 0 ? 'Record time' : 'Used this week', () => spend(ticket), 'quiet compact'))) : [empty('Your weekly ticket ledger is not available yet.')]));
    for (const node of ticketHost.querySelectorAll('button')) if (node.textContent === 'Used this week') node.disabled = true;
    const all = ctx.records('ticket-spend'); const undone = new Set(all.filter(record => record.data.type === 'undo').map(record => record.data.spendId)); const records = all.filter(record => record.data.type !== 'undo');
    replace(historyHost, ...(records.length ? records.slice().reverse().slice(0, 15).map(record => { const data = { ...record.data, undone: undone.has(record.id), auditId: record.data.auditId || audit.find(item => item.kind === 'ticket-spend' && item.recordId === record.id && !item.undoOf)?.id }; return el('div', { class: 'practice-row row' }, el('div', {}, el('h3', {}, data.note || data.category), el('p', { class: 'muted' }, `${formatDate(data.start || data.date)}, ${duration(data.minutes)}${data.undone ? ', Undone' : ''}`)), data.auditId && !data.undone ? button('Undo', event => busy(event.currentTarget, async () => { showResult(await ctx.action('undo', { auditId: data.auditId })); await ctx.refresh(); paint(); }), 'text-button') : null); }) : [empty('No ticket time has been recorded yet.')]));
  }
  function editProject(record) {
    const title = field('Project name', { value: record?.data.title || '', required: true, maxLength: 300 }); const category = select('Ticket category', [{ value: 'school-project', label: 'School-related project' }, { value: 'personal-project', label: 'Personal-use project' }, { value: 'wildcard', label: 'Wildcard' }], record?.data.category || 'personal-project'); const notes = field('Next step and notes', { multiline: true, value: record?.data.notes || '', maxLength: 10000 }); const state = select('Project state', [{value:'active',label:'Active'},{value:'later',label:'Later'},{value:'completed',label:'Completed'},{value:'archived',label:'Archived'}], record?.data.status || 'active');
    modal(record ? 'Edit project' : 'Add a project', el('div', { class: 'form-stack' }, title.node, category.node, notes.node, state.node, button('Save project', event => busy(event.currentTarget, async () => { if (!title.input.reportValidity()) return; const result = await ctx.save('project', record, { ...(record?.data.githubUrl?{githubUrl:record.data.githubUrl}:{}),title: title.input.value, category: category.input.value, notes: notes.input.value, status: state.input.value }); showResult(result); if (!result.pending) { document.querySelector('#dialog').close(); renderProjects(); } }))));
  }
  function renderProjects() { const projects=ctx.records('project').filter(record=>record.data.status!=='archived'&&!record.data.archived);replace(projectHost, ...(projects.length ? projects.map(record => el('div', { class: 'practice-row row' }, el('div', {}, el('h3', {}, record.data.title), record.data.notes?el('p',{class:'muted'},record.data.notes):null), button('Edit', () => editProject(record), 'text-button'))) : [empty('No active projects.')])); }
  replace(root, heading('Tickets & projects', null, null, duration(ledger.remainingMinutes)+' remaining'), el('div', { class: 'grid wide' }, el('div', { class: 'stack' }, panel('This week', el('p', { class: 'muted' }, ledger.weekStart ? `Week of ${formatDate(ledger.weekStart)}` : ''), ticketHost), panel('Recorded time', historyHost)), panel('Projects', projectHost, button('Add project', () => editProject(null), 'quiet'))));
  await paint(); renderProjects();
  const query=routeQuery(),projectId=query.get('project'),ticketId=query.get('ticket');
  if(projectId){let project=ctx.records('project').find(p=>p.id===projectId);if(project?.data.canonicalProjectId)project=ctx.records('project').find(p=>p.id===project.data.canonicalProjectId);if(project)editProject(project);else modal('Project unavailable',el('p',{},'This project is no longer available.'));}
  else if(ticketId){const ticket=ledger.tickets?.find(t=>t.id===ticketId);if(ticket)modal(ticket.label,el('div',{},el('p',{},`${duration(ticket.remainingMinutes)} remains this week.`),el('p',{},'Record time after the activity.'),button('Record time',()=>spend(ticket))));}
  return {};
}

function mountMeals(root, ctx) {
  const groceries = el('div'); const meals = el('div'); const week = ctx.state.bootstrap.week || ctx.state.bootstrap.today?.week || [];
  function editMeal(record) {
    const title = field('Meal or recipe', { value: record?.data.title || '', required: true, maxLength: 300 }); const slot = select('Meal', ['breakfast', 'lunch', 'dinner', 'recipe'], record?.data.slot || 'recipe'); const recipe = field('Ingredients and method', { multiline: true, value: record?.data.recipe || '', maxLength: 20000 }); const notes = field('Notes and next steps', { multiline: true, value: record?.data.notes || '', maxLength: 5000 });
    modal(record ? 'Edit meal' : 'Add meal', el('div', { class: 'form-stack' }, title.node, slot.node, recipe.node, notes.node, button('Save meal', event => busy(event.currentTarget, async () => { if (!title.input.reportValidity()) return; showResult(await ctx.save('meal', record, { ...record?.data, title: title.input.value, slot: slot.input.value, recipe: recipe.input.value, notes: notes.input.value })); renderMeals(); document.querySelector('#dialog').close(); }))));
  }
  function renderMeals() { replace(meals, ...(ctx.records('meal').length ? ctx.records('meal').map(record => el('div', { class: 'practice-row' }, el('div', { class: 'row' }, el('div', {},  el('h3', {}, record.data.title)), button('Open', () => editMeal(record), 'text-button')), record.data.notes ? el('p', { class: 'muted' }, record.data.notes) : null)) : [empty('Saved breakfast, lunch and dinner ideas will appear here.')])); }
  function renderGroceries() { replace(groceries, ...(ctx.records('grocery').length ? ctx.records('grocery').map(record => { const input = el('input', { type: 'checkbox', checked: record.data.checked }); input.onchange = async () => { const result = await ctx.save('grocery', record, { ...record.data, checked: input.checked }); showResult(result); if (result.item) record = result.item; }; return el('label', { class: 'check' }, input, record.data.title); }) : [empty('Your grocery list is empty.')])); }
  const grocery = field('Add grocery item', { placeholder: 'Item and quantity', maxLength: 300 }); const add = button('Add', event => busy(event.currentTarget, async () => { if (!grocery.input.value.trim()) return; const result = await ctx.save('grocery', null, { title: grocery.input.value.trim(), checked: false }); showResult(result); if (!result.pending) { grocery.input.value = ''; renderGroceries(); } }));
  const weekPanel = panel('Week at a glance');
  if (Array.isArray(week) && week.length) append(weekPanel, el('ol', { class: 'timeline' }, week.map(day => el('li', {}, el('time', {}, formatDate(day.date)), el('div', {}, el('h3', {}, day.title || day.label), el('p', {}, day.description || ''), ...(day.blocks || []).map(block => el('p', {}, `${formatTime(block.start)} ${block.title}`)))))));
  else append(weekPanel, el('p', { class: 'muted' }, 'Today uses your current calendar and routine settings. Fixed meals and recovery take priority over optional time.'), button('Open today', () => ctx.go('today'), 'quiet'));
  replace(root, heading('Meals & week', null), el('div', { class: 'grid wide' }, el('div', { class: 'stack' }, panel('Meals & recipes', meals, button('Add meal or recipe', () => editMeal(null), 'quiet')), weekPanel), panel('Groceries', groceries, el('div', { class: 'inline-form section-spacer' }, grocery.node, add))));
  renderMeals(); renderGroceries(); return {};
}
