import {applyTheme,cachedTheme} from './themes.js';
applyTheme(cachedTheme());
import {configureAssistantPresets} from './assistant-presets.js';
import {configureExternalLinks} from './ui.js';
import {createTaskTimers} from './task-timers.js';
import {routesFor,routeModule} from './routes.js';
import {restoreLiveNoteDock} from './lecture-session.js';
import {settleRouteTop} from './route-scroll.js';
import {applyWorkspacePreferences} from './workspace-preferences.js';
import {openActionFinder} from './action-finder.js';
import {updateBlockReason,editingElement} from './update-safety.js';
import {controlIcon} from './quiet-controls.js';
import {compactDisclosure} from './quiet-controls.js';
import {nextLifeosDayAt} from './lifeos-day.js';
import { PrivateStore, MutationOutbox } from './storage.js';
import { FileUploads } from './uploads.js';
import { PrayerRecovery } from './prayer-recovery.js';
import { $, el, replace, append, button, heading, arrangePageControls, panel, empty, status, modal, toast, icon, dateToday, errorNotice, showResult, field, busy, download, getDisplayTimeZone, setDisplayTimeZone } from './ui.js';


const editableFields = {
 course:'title code term notes archived policyText',
 task:'title courseId dueDate dueAt remainingMinutes estimatedMinutes difficulty status nextStep nextStepMinutes userNotes notes archived sourceUrl source',
 'prayer-list':'sections',
 'accountability-draft':'entryId entryVersion previousEntryId prayerSessionId prayed repentance followThrough applications text status approvedAt',
  settings: 'notificationDeviceId theme customTheme textSize controlDensity handedness hourlyPrayerReminder accountabilityDiscordUrl timezone wakeTime lightsOut prayerWakeLock quietStart quietEnd lateRounding schoolStart schoolEnd morningCommuteMinutes eveningCommuteMinutes breakfastMinutes lunchPrepMinutes dinnerMinutes fridayTravelMinutes fridayBedtime saturdayWakeTime prayerCampusLocation devotionalCampusLocation locationLabels readingPlan exceptions',
  'prayer-note': 'section title text archived rotation people notes weekday weekdays nodes', project: 'title category notes status archived nextStep steps timeBlocks githubUrl', meal: 'title notes recipe day slot ingredients steps', grocery: 'title checked quantity notes archived', coursework: 'title taskId text language document attachmentIds notes archived', training: 'weeklyKm longestKm pain injury recovery guidance raceDate goalMinutes sundayExceptionConfirmed baselineDate notes', run: 'date distanceKm durationMinutes effort pain fatigue notes workoutId', 'support-thread': 'title archived model effort', 'coop-role':'title employer sourceUrl deadlineDate deadlineTime deadlineEvidence status location industry description notes draftText archived'
};
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const state = { session: null, bootstrap: { records: {}, jobs: [], integrations: [], today: {} }, online: false, route: null };
const store = new PrivateStore(); let active = null; let routeToken = 0; let refreshPromise = null; let rolloverTimer;
const loadedVersion=import.meta.url.match(/\/__assets\/([a-f0-9]{40})\//)?.[1];
// An attempted navigation does not retire the page that is still on screen.
// Each committed page keeps its own supplied root and cleanup resources.
function pageOwner(root,route=null,hash=null){return{root,route,hash,view:null,retired:false,disposedHandle:false,observer:null,toolsHeading:null,stopScroll:null,clock:null,update:null,workspace:null};}
let presentation=pageOwner($('#main'));
const livePage=owner=>owner===presentation&&!owner.retired&&owner.root.isConnected;
function removeControl(owner,key){const control=owner[key];owner[key]=null;try{control?.destroy();}catch{}try{control?.node.remove();}catch{}}
function disposeView(owner){if(!owner.view||owner.disposedHandle)return;owner.disposedHandle=true;try{owner.view.destroy?.();}catch{}}
function retirePage(owner){owner.retired=true;owner.observer?.disconnect();owner.stopScroll?.();owner.stopScroll=null;for(const key of ['clock','update','workspace'])removeControl(owner,key);disposeView(owner);}
function observePage(owner){
 owner.observer=new MutationObserver(()=>{
  if(!livePage(owner))return;
  if(owner.toolsHeading&&owner.root.contains(owner.toolsHeading))return;
  const next=owner.root.querySelector('.page-heading, .lecture-top, .assistant-header');
  if(!next&&owner.root.querySelector('.task-clock-corner'))return;
  owner.toolsHeading=next;renderWorkspaceStatus(owner);renderAppTools(owner);
 });
 owner.observer.observe(owner.root,{childList:true,subtree:true});
}
function renderAppTools(owner=presentation){if(!context.timers)return;
 if(!livePage(owner))return;
 const host=owner.root.querySelector('.page-heading, .lecture-top, .assistant-header');owner.toolsHeading=host;
 if(!host){removeControl(owner,'clock');owner.clock=context.timers.control();owner.clock.node.classList.add('task-clock-corner');owner.root.append(owner.clock.node);return;}
 if(host.classList.contains('lecture-top')||host.classList.contains('assistant-header')){removeControl(owner,'clock');owner.clock=context.timers.control();host.append(owner.clock.node);return;}
 let tools=host.querySelector(':scope > .actions, :scope > .workspace-tools');if(!tools){tools=el('div',{class:'actions workspace-tools'});host.append(tools);}for(const node of host.querySelectorAll(':scope > .icon-button, :scope > .workspace-status'))tools.append(node);
 if(!host.querySelector('.action-finder')){const find=button(controlIcon('zoom'),()=>openActionFinder(context,routesFor(state.session?.environment)),'quiet icon-button action-finder');find.setAttribute('aria-label','Find a record or page');find.title='Find, Ctrl+K';tools.append(find);}
 removeControl(owner,'clock');owner.clock=state.route==='devotional'?null:context.timers.control();if(owner.clock)tools.append(owner.clock.node);
 removeControl(owner,'update');
 if(loadedVersion&&state.session?.version!==loadedVersion){owner.update=compactDisclosure({label:'App update available',icon:'retry',content:()=>el('div',{},el('p',{},'An app update is available.'),button('Update when saved',async()=>{const pending=(await store.list('outbox:')).length;if(!livePage(owner))return;const reason=updateBlockReason({dirty:active?.dirty?.(),pending,editing:editingElement(document.activeElement)});if(reason){toast(reason);return;}location.reload();},'text-button'))});tools.append(owner.update.node);}
 arrangePageControls(host);
}
function renderWorkspaceStatus(owner=presentation){if(!livePage(owner))return;removeControl(owner,'workspace');const host=owner.root.querySelector('.page-heading');if(!state.notice||!host)return;owner.workspace=compactDisclosure({portal:true,label:'Workspace needs attention',icon:state.authExpired?'alert':state.online?'device':'alert',content:()=>el('div',{},el('p',{},state.notice),state.authExpired?el('a',{href:'/login',target:'_blank',rel:'noopener'},'Sign in'):button('Review saved work',()=>context.go('settings?section=recovery'),'text-button'))});owner.workspace.node.classList.add('workspace-status');(host.querySelector(':scope > .actions, :scope > .workspace-tools')||host).append(owner.workspace.node);arrangePageControls(host);}

function armDayRollover(){clearTimeout(rolloverTimer);rolloverTimer=setTimeout(()=>{if(active?.dirty?.())notice('A new LifeOS day has started. Your open entry keeps its selected date.');void refresh({redraw:true}).catch(()=>{}).finally(armDayRollover);},Math.max(1000,nextLifeosDayAt(Date.now(),getDisplayTimeZone())-Date.now()+50));}
const jobWatchers = new WeakMap();
async function request(path, options = {}, control) {
  // Local completion policy stays outside fetch options, headers and the body.
  // Validate before any transport or connection-state change; invoke no getter.
  let refreshToday = true;
  if (control !== undefined) {
    if (!control || Object.getPrototypeOf(control) !== Object.prototype || Reflect.ownKeys(control).some(key => key !== 'refreshToday')) throw new TypeError('Invalid request control.');
    const descriptor = Object.getOwnPropertyDescriptor(control, 'refreshToday');
    if (descriptor && (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean')) throw new TypeError('Request control refreshToday must be a boolean.');
    if (descriptor) refreshToday = descriptor.value;
  }
  if(!navigator.onLine&&!window.__LIFEOS_BROWSER_DEMO__)throw new Error('Offline. Your edits are saved on this device.');
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof Blob)) headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('X-LifeOS-CSRF', state.session?.csrf || '');
  let response; const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 30000);
  try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: abort.signal, headers, body: options.body instanceof Blob ? options.body : options.body ? JSON.stringify(options.body) : undefined }); }
  catch { setConnection(false); throw new Error('LifeOS is unavailable. Your unsent writing stays on this device.'); }
  finally { clearTimeout(timeout); }
  let data = {}; try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.error || (response.status === 401 ? 'Your session expired. Sign in again to send saved drafts.' : `Request failed with status ${response.status}`));
    error.status = response.status;
    // Preserve the API's absence of optional metadata so retained errors remain
    // JSON data; manufacturing own undefined fields strands original custody.
    for (const key of ['code', 'current']) if (Object.hasOwn(data, key)) error[key] = data[key];
    const cookingUnavailable = path === '/api/cooking-help' && options.method === 'POST' && response.status === 503 && error.code === 'cooking_help_unavailable';
    if (response.status === 401) sessionExpired(); else if (response.status >= 502 && !cookingUnavailable) setConnection(false);
    throw error;
  }
  if(refreshToday&&options.method&&options.method!=='GET'&&state.route==='today')queueMicrotask(()=>{void refresh().catch(()=>{});});
  setConnection(true); return data;
}
function setConnection(online) {
  state.online = online; $('#connection-label').textContent = window.__LIFEOS_BROWSER_DEMO__ ? (online?'Saved on this device':'Local workspace unavailable') : online ? 'Connected to LifeOS' : 'LifeOS unavailable'; $('#connection-dot').className = `connection-dot ${online ? 'online' : 'offline'}`;
  if (!online) notice(window.__LIFEOS_BROWSER_DEMO__?'Local storage is unavailable. Keep this page open to preserve your writing.':'LifeOS is unavailable. New changes are not yet saved to the server.');
}
function notice(message) { state.notice=message||null;const node=$('#global-notice');node.hidden=true;node.textContent='';renderWorkspaceStatus(); }
function sessionExpired() {
  state.authExpired = true;
  notice('Sign in again to sync your saved work.');
}
const outbox = new MutationOutbox(store, request, () => { void updatePending(); });
async function updatePending() { const pending = await store.list('outbox:'); if (pending.length) notice(`${pending.length} ${pending.length === 1 ? 'request is' : 'requests are'} still on this device. Open Settings to review or retry.`); else if (state.online) notice(null); if (store.warning) notice(store.warning); if (state.authExpired) sessionExpired(); }
async function refresh({ redraw = false } = {}) {
  if (!refreshPromise) refreshPromise = (async () => {
    state.session = await request('/api/session'); state.authExpired = false;configureAssistantPresets(state.session.ai?.models);configureExternalLinks(state.session.externalOrigins??[]);context.capabilities={...context.capabilities,usage:state.session.ai?.usage===true};
    $('#environment').textContent = state.session.mode === 'demo' ? 'Fictional demo' : 'Local workspace';

    await outbox.flush(); state.bootstrap = await request('/api/bootstrap'); state.bootstrap.receivedAt=Date.now();const preferences=state.bootstrap.records?.settings?.find(r=>r.id==='preferences')?.data;setDisplayTimeZone(preferences?.timezone||'America/Toronto');applyWorkspacePreferences(preferences);
    await updatePending(); void prayerRecovery.kick(); armDayRollover(); if (redraw && !active?.dirty?.()) await navigate(true); else active?.update?.(); renderWorkspaceStatus();renderAppTools();return state.bootstrap;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
const context = {
  state, store, request, outbox, refresh, renderWorkspaceStatus:()=>{renderWorkspaceStatus();renderAppTools();},
  records: kind => state.bootstrap.records?.[kind] || [],
  date: () => dateToday(),
  go: route => { location.hash = route; },
  async save(kind, record, data) {
    const id = record?.id || crypto.randomUUID();
    const allowed = editableFields[kind]?.split(' ') || []; const editable = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.includes(key)));
    const result = await outbox.submit(`/api/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { data: editable, version: record?.version || 0 }, 'PUT');
    if (result.item) { const list = state.bootstrap.records[kind] ||= []; const index = list.findIndex(item => item.id === result.item.id); if (index < 0) list.push(result.item); else list[index] = result.item; }
    return { ...result, recordId: id };
  },
  action: (action, payload = {}) => outbox.submit(`/api/actions/${encodeURIComponent(action)}`, payload),
  async job(type, payload, target) {
    const result = await outbox.submit('/api/jobs', { type, payload, ...(type === 'maintenance' ? { intentional: true } : {}) });
    if (target) context.showJob(target, result.job || { status: 'not-yet-sent', type });
    if (result.job) { state.bootstrap.jobs ||= []; state.bootstrap.jobs.unshift(result.job); }
    if (result.pending) showResult(result); return result;
  },
  showJob(node, initial, onComplete) {
    jobWatchers.get(node)?.stop();
    let job = initial; let timer; let disposed = false; let completed = false;
    const done = () => ['completed', 'succeeded', 'failed', 'cancelled', 'needs-input', 'usage-limited', 'not-yet-sent'].includes(job.status);
    const paint = () => {
      node.classList.add('job'); const state = job.status || 'queued';
      replace(node, el('div', { class: 'row' }, el('strong', {}, ({ support: 'Support', inspire: 'A starting point', 'source-sync': 'Source refresh', maintenance: 'Beta update', backup: 'Backup' })[job.type] || 'Request'), status(state.replaceAll('-', ' '), state === 'completed' || state === 'succeeded' ? 'saved' : state === 'failed' ? 'failed' : 'pending')),
        job.progress && !done() ? el('p', { class: 'muted' }, typeof job.progress === 'string' ? job.progress : job.progress.message || 'Working') : null,
        job.error ? el('p', { class: 'error-text' }, typeof job.error === 'string' ? job.error : job.error.message || 'This request needs review.') : null,
        job.result ? el('div', { class: 'job-result' }, typeof job.result === 'string' ? job.result : job.result.message || job.result.reply || job.result.answer || job.result.summary || JSON.stringify(job.result, null, 2)) : null,
        !done() && job.id ? el('div', { class: 'job-actions' }, button('Stop this request', async event => { await busy(event.currentTarget, async () => { await request(`/api/jobs/${job.id}/cancel`, { method: 'POST', body: { mutationId: crypto.randomUUID() } }); await poll(); }); }, 'quiet compact')) : null);
    };
    const poll = async () => {
      clearTimeout(timer); if (!node.isConnected) { handle.stop(); return; } if (disposed || document.hidden || !job.id || done()) return;
      try { const result = await request(`/api/jobs/${encodeURIComponent(job.id)}`); job = result.job; if (!disposed) paint(); if (done() && !completed) { completed = true; onComplete?.(job); handle.stop(); } } catch (error) { if (!disposed) { append(node, el('p', { class: 'muted' }, error.message)); } }
      if (!disposed && !done() && !document.hidden) timer = setTimeout(poll, 5000);
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    if (!done()) document.addEventListener('visibilitychange', visibility); paint(); if (!done() && !document.hidden) timer = setTimeout(poll, 1800);
    const handle = { stop() { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); } };
    jobWatchers.set(node, handle); return handle;
  },
  reportBug
};

context.uploads = new FileUploads({ store, request, action: context.action });
const prayerRecovery = new PrayerRecovery({store,request,action:context.action,changed:()=>window.dispatchEvent(new Event('lifeos-prayer-recovered'))});
context.retryPrayerUploads=()=>prayerRecovery.kick();
const keyLegends={today:'Today',devotional:'Devotion',prayer:'Prayer',school:'School',tickets:'Projects',exercise:'Exercise',reminders:'Remind',finances:'Money',notes:'Notes',friends:'Friends',journal:'Journal',photos:'Photos',support:'Support',settings:'Settings'};
function navLink([id, title]) { return el('a', { class: 'nav-link', href: `#${id}`, 'aria-label':title, 'aria-current': state.route === id ? 'page' : null }, icon(id), keyLegends[id]||title); }
function moreKey(visible){
 const remaining=routesFor(state.session?.environment).filter(([id])=>!visible.includes(id)&&id!=='settings');
 const more=button([icon('more'),'More'],()=>modal('More',el('nav',{class:'more-links','aria-label':'More navigation'},remaining.map(item=>{const a=navLink(item);a.onclick=()=>$('#dialog').close();return a;}))),'nav-link');
 more.setAttribute('aria-label','More navigation');if(remaining.some(([id])=>id===state.route))more.setAttribute('aria-current','page');return more;
}
function renderNavigation() {
 const desktop=['today','school','tickets','photos','exercise','reminders','finances','notes','friends'],mobile=['today','school','tickets','photos'];
 const routes=routesFor(state.session?.environment);
  $('#navigation').replaceChildren(...desktop.map(id=>navLink(routes.find(r=>r[0]===id))),moreKey(desktop));
 $('#settings-navigation').replaceChildren(navLink(routes.find(r=>r[0]==='settings')));
 $('#phone-settings-navigation').replaceChildren(navLink(routes.find(r=>r[0]==='settings')));
 $('#mobile-navigation').replaceChildren(...mobile.map(id=>navLink(routes.find(r=>r[0]===id))),moreKey(mobile));
}
async function navigate(force = false) {
  const routes=routesFor(state.session?.environment);
  const destinationHash=location.hash;
  const originalRoute=destinationHash.slice(1).split('?')[0]||'today',requested=originalRoute==='meals'?'reminders':originalRoute;
  const route=routes.some(([id])=>id===requested)?requested:'today';
  if(route===state.route&&destinationHash===state.routeHash&&!force)return;
  const token=++routeToken,leavingOwner=presentation,leaving=leavingOwner.view,previousHash=state.routeHash||`#${state.route}`,previousRoute=state.route;
  const currentAttempt=()=>token===routeToken&&livePage(leavingOwner)&&location.hash===destinationHash;
  const currentLeave=()=>currentAttempt()&&leavingOwner.view===leaving;
  // A pending mount can return while leaveRoute is saving. Its new handle must
  // be guarded on a later attempt, but this current attempt can still refuse.
  const refuse=()=>{if(currentAttempt())history.replaceState(null,'',previousHash);};
  const custody=async guard=>{if(!guard)return true;try{return await guard.call(leaving)===true;}catch{return false;}};
  if(!await custody(leaving?.beforeLeave)){refuse();return;}
  if(!currentLeave()){refuse();return;}
  try{await context.timers.leaveRoute();}catch{if(currentAttempt()){refuse();toast('Keep this page open. Its timer could not finish saving.');}return;}
  if(!currentLeave()){refuse();return;}
  document.activeElement?.blur?.();
  // A view may acquire newer writing while the timer pause or blur is pending.
  // This final hook only proves local custody; it must not initiate an external effect.
  if(!await custody(leaving?.finalBeforeLeave)){refuse();return;}
  if(!currentLeave()){refuse();return;}
  if(leaving?.finalCustodyCurrent){let safe=false;try{safe=leaving.finalCustodyCurrent()===true;}catch{}if(!safe){refuse();return;}}
  const root=el('main',{id:'main',tabindex:'-1'},empty('Opening...'));root.dataset.route=route;
  const owner=pageOwner(root,route,destinationHash);
  // Revalidate after every caller hook, including synchronous final proof.
  // The native swap and ownership publication have no intervening await.
  if(!currentLeave()){refuse();return;}
  leavingOwner.root.replaceWith(root);leavingOwner.retired=true;presentation=owner;active=null;state.route=route;state.routeHash=destinationHash;
  observePage(owner);retirePage(leavingOwner);if(!livePage(owner))return;
  renderNavigation();document.title=`${routes.find(([id])=>id===route)[1]}, LifeOS`;
  document.querySelector('#dialog')?.close();window.scrollTo({top:0,left:0,behavior:'instant'});
  try{
    await context.timers.enterRoute(destinationHash);if(!livePage(owner))return;
    if(route==='today'&&!force&&previousRoute){await refresh();if(!livePage(owner))return;}
    const file=routeModule(route,state.session?.environment),module=await import(new URL(`modules/${file}.js`,import.meta.url).href);
    if(!livePage(owner))return;
    const mounted=await module.mount(root,context,route);
    owner.view=mounted;
    if(!livePage(owner)){disposeView(owner);return;}
    active=mounted;
    if(location.hash===owner.hash&&!document.querySelector('#dialog')?.open&&!new URLSearchParams(destinationHash.split('?')[1]??'').has('section'))owner.stopScroll=settleRouteTop();
    renderWorkspaceStatus(owner);renderAppTools(owner);
  }catch(error){if(livePage(owner))replace(root,heading('This page could not open','Your saved records have not changed.'),errorNotice(error),button('Reload page',()=>location.reload()));}
}
async function reportBug() {
  const description = field('What happened, and what should happen?', { multiline: true, required: true, maxLength: 8000, placeholder: 'Describe the problem or feature you want.' });
  const attachment = field('Optional screenshot or file', { type: 'file', accept: 'image/*,.txt,.log' });
  let attachmentManifest = null; attachment.input.onchange = () => { attachmentManifest = null; };
  const diagnostics = el('input', { type: 'checkbox', checked: true }); const results = el('div');
  const submit = button('Save report', event => busy(event.currentTarget, async () => {
    if (!description.input.value.trim()) return description.input.reportValidity();
    const payload = { description: description.input.value.trim(), route: state.route, version: state.session?.version || 'unknown', intentional: true };
    if (attachment.input.files.length) {
      const uploaded = attachmentManifest ? await context.uploads.retry(attachmentManifest) : await context.uploads.capture(attachment.input.files[0], { kind: 'attachment' });
      attachmentManifest = uploaded.manifestId;
      if (uploaded.pending) { showResult(uploaded); return; }
      payload.attachmentIds = [uploaded.item.id];
    }
    if (diagnostics.checked) payload.diagnostics = { online: state.online, route: state.route, version: state.session?.version || 'unknown' };
    const result = await context.job('maintenance', payload, results); if (result.job) { description.input.disabled = true; submit.disabled = true; }
  }));
  modal('Report a bug or request a feature', el('div', { class: 'form-stack' }, el('p', { class: 'muted' }, 'Save a local report for review. Automatic code changes and deployment are unavailable in the standalone app.'), description.node, el('label', { class: 'check' }, diagnostics, 'Include app version, page and connection state. Journal text is excluded.'), attachment.node, submit, results));
}
// Report Bug remains available to future feature entry points through context.
$('#refresh-app').onclick = event => busy(event.currentTarget, () => refresh({ redraw: true }));
window.addEventListener('hashchange', () => { void navigate(); });
// Only the current committed root may attach shared page controls.
observePage(presentation);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.altKey){e.preventDefault();if(state.session)openActionFinder(context,routesFor(state.session?.environment));}});
window.addEventListener('online', () => {void context.timers?.refresh(true); void refresh().catch(() => {}); });
window.addEventListener('offline', () => setConnection(window.__LIFEOS_BROWSER_DEMO__===true));
window.addEventListener('beforeunload', event => { if (active?.dirty?.()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.session) void refresh().catch(() => {}); });
try { await refresh();context.timers=createTaskTimers(context);void context.timers.refresh(); restoreLiveNoteDock(context); await navigate(); if ('serviceWorker' in navigator&&!window.__LIFEOS_BROWSER_DEMO__) await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
catch (error) { $('#main').replaceChildren(heading('Your workspace is unavailable', 'Your saved local drafts remain on this device.'), errorNotice(error), el('div', { class: 'actions' }, el('a', { href: '/login' }, 'Sign in'), button('Try again', () => location.reload()), button('Download local drafts', async () => download('lifeos-local-recovery.json', JSON.stringify(await store.list('draft:'), null, 2), 'application/json'), 'quiet'))); }
