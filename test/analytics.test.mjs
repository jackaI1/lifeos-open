import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONSENT_KEY,GTM_SRC,createAnalytics} from '../src/analytics/datalayer.ts';
import {classifyRequest,observeFetch,observeViews} from '../src/analytics/observe.ts';
import {configFromDocument,configFromEnv,hasAnalyticsMeta,metaTags,parseGa4Id,parseGtmId} from '../src/analytics/config.ts';
import {EVENT_NAMES,TRACKED_VIEWS,sanitizeView} from '../src/analytics/events.ts';
import {staticSecurityHeaders} from '../src/hosted/worker.ts';
import {buildHostedAssets} from '../tools/build-hosted-assets.mjs';

const config={gtmId:'GTM-ABC1234',ga4Id:'G-ABCDE12345'};
function harness(options={}){
 const dataLayer=[],scripts=[],store=new Map();
 const storage=options.noStorage?null:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>{store.set(k,v);}};
 const analytics=createAnalytics({config:options.config??config,dataLayer,storage,loadScript:src=>scripts.push(src),origin:'https://demo.test',privacySignal:options.privacySignal,now:()=>1234});
 // gtag() commands are `arguments` objects; events are plain objects.
 const commands=()=>dataLayer.filter(e=>typeof e?.length==='number'&&!Array.isArray(e)).map(e=>Array.from(e));
 const events=()=>dataLayer.filter(e=>e&&typeof e==='object'&&!Array.isArray(e)&&typeof e.length!=='number'&&e.event&&e.event!=='gtm.js');
 return {analytics,dataLayer,scripts,store,commands,events};
}

test('Consent Mode v2 defaults analytics and advertising storage to denied before anything else',()=>{
 const h=harness();
 const first=h.commands()[0];
 assert.deepEqual(first.slice(0,2),['consent','default']);
 for(const key of ['ad_storage','ad_user_data','ad_personalization','analytics_storage'])assert.equal(first[2][key],'denied',key);
 assert.equal(h.analytics.consent(),'unset');
});

test('nothing is tracked and no Google script is requested before consent',()=>{
 const h=harness();
 assert.equal(h.analytics.track('item_created',{item_type:'task'}),false);
 assert.equal(h.analytics.track('view_changed',{view:'today',previous_view:'none',page_location:'https://x/#today',page_title:'Today, LifeOS'}),false);
 assert.deepEqual(h.events(),[]);
 assert.deepEqual(h.scripts,[]);
 assert.equal(h.dataLayer.some(e=>e?.ga4_measurement_id),false,'measurement id is not even queued');
});

test('declining keeps analytics off and remembers the choice',()=>{
 const h=harness();
 h.analytics.deny();
 assert.equal(h.analytics.consent(),'denied');
 assert.equal(h.store.get(CONSENT_KEY),'denied');
 assert.equal(h.analytics.track('item_created',{item_type:'task'}),false);
 assert.deepEqual(h.scripts,[]);
 assert.deepEqual(h.events(),[]);
});

test('accepting updates consent, loads the container once, then tracks',()=>{
 const h=harness();
 h.analytics.grant();h.analytics.grant();
 assert.equal(h.analytics.consent(),'granted');
 assert.equal(h.store.get(CONSENT_KEY),'granted');
 assert.deepEqual(h.scripts,[GTM_SRC('GTM-ABC1234')]);
 assert.ok(h.commands().some(c=>c[0]==='consent'&&c[1]==='update'&&c[2].analytics_storage==='granted'));
 assert.ok(h.dataLayer.some(e=>e?.ga4_measurement_id==='G-ABCDE12345'));
 const loader=h.dataLayer.findIndex(e=>e?.event==='gtm.js');
 const update=h.dataLayer.findIndex(e=>typeof e?.length==='number'&&e[0]==='consent'&&e[1]==='update');
 assert.ok(update>=0&&loader>update,'consent update precedes the container start');
 assert.equal(h.analytics.track('item_created',{item_type:'task'}),true);
 assert.deepEqual(h.events().map(e=>e.event),['consent_changed','item_created']);
 assert.deepEqual(h.events().at(-1),{event:'item_created',item_type:'task'});
});

test('withdrawing consent stops further events and tells GTM',()=>{
 const h=harness();
 h.analytics.grant();h.analytics.deny();
 assert.equal(h.analytics.track('item_created',{item_type:'task'}),false);
 const updates=h.commands().filter(c=>c[1]==='update');
 assert.equal(updates.at(-1)[2].analytics_storage,'denied');
 assert.equal(h.store.get(CONSENT_KEY),'denied');
});

test('a stored grant restores analytics on the next visit; a stored decline does not',()=>{
 const granted=harness();granted.analytics.grant();
 const again=createAnalytics({config,dataLayer:[],storage:{getItem:()=>'granted',setItem(){}},loadScript:()=>{}});
 assert.equal(again.consent(),'granted');
 const scripts=[];
 const declined=createAnalytics({config,dataLayer:[],storage:{getItem:()=>'denied',setItem(){}},loadScript:src=>scripts.push(src)});
 assert.equal(declined.consent(),'denied');assert.deepEqual(scripts,[]);
});

test('Global Privacy Control / Do Not Track forces analytics off even if a grant was stored',()=>{
 const scripts=[],store={getItem:()=>'granted',setItem(){}};
 const analytics=createAnalytics({config,dataLayer:[],storage:store,loadScript:s=>scripts.push(s),privacySignal:true});
 assert.equal(analytics.consent(),'denied');assert.equal(analytics.blockedByBrowser(),true);
 analytics.grant();
 assert.equal(analytics.consent(),'denied');assert.deepEqual(scripts,[]);
 assert.equal(analytics.track('item_created',{item_type:'task'}),false);
});

test('unavailable storage degrades to per-page-view consent without throwing',()=>{
 const broken={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
 const scripts=[];
 const analytics=createAnalytics({config,dataLayer:[],storage:broken,loadScript:s=>scripts.push(s)});
 assert.equal(analytics.consent(),'unset');
 analytics.grant();
 assert.equal(analytics.consent(),'granted');assert.equal(scripts.length,1);
 assert.equal(harness({noStorage:true}).analytics.consent(),'unset');
});

test('GA4 id is optional; the container still loads without it',()=>{
 const h=harness({config:{gtmId:'GTM-ABC1234'}});
 h.analytics.grant();
 assert.equal(h.dataLayer.some(e=>e?.ga4_measurement_id),false);
 assert.equal(h.scripts.length,1);
});

test('request classification covers headline features and nothing else',()=>{
 assert.deepEqual(classifyRequest('PUT','/api/records/task/abc',0),{event:'item_created',params:{item_type:'task'}});
 assert.deepEqual(classifyRequest('PUT','/api/records/task/abc',3),{event:'item_updated',params:{item_type:'task'}});
 assert.deepEqual(classifyRequest('PUT','/api/records/project/abc',undefined),{event:'item_updated',params:{item_type:'project'}});
 assert.deepEqual(classifyRequest('POST','/api/finances/transaction'),{event:'budget_entry_added',params:{}});
 assert.deepEqual(classifyRequest('POST','/api/actions/ticket-spend'),{event:'feature_used',params:{feature:'time_logged'}});
 // Sensitive or unlisted kinds and actions are invisible to analytics.
 for(const kind of ['prayer-note','prayer-list','accountability-draft','settings','training','support-thread'])assert.equal(classifyRequest('PUT',`/api/records/${kind}/x`,0),null,kind);
 assert.equal(classifyRequest('POST','/api/actions/logout'),null);
 assert.equal(classifyRequest('POST','/api/actions/__proto__'),null);
 assert.equal(classifyRequest('GET','/api/finances/transaction'),null);
 assert.equal(classifyRequest('POST','/api/jobs'),null);
});

function fakeFetch(ok=true){const calls=[];const fn=async(input,init)=>{calls.push({input,init});return {ok,status:ok?200:500};};fn.calls=calls;return fn;}

test('observed fetch emits one clean event for a successful write and returns the original response',async()=>{
 const h=harness();h.analytics.grant();
 const inner=fakeFetch();
 const fetchImpl=observeFetch(inner,h.analytics,'https://demo.test');
 const secret='My private thesis topic 4242';
 const response=await fetchImpl('/api/records/task/9f',{method:'PUT',body:JSON.stringify({data:{title:secret,notes:secret,dueDate:'2026-12-01'},version:0})});
 assert.equal(response.ok,true);
 assert.equal(inner.calls.length,1);
 await fetchImpl('/api/finances/transaction',{method:'POST',body:JSON.stringify({id:'1',description:secret,amountCents:123456})});
 const sent=h.events().filter(e=>e.event!=='consent_changed');
 assert.deepEqual(sent,[{event:'item_created',item_type:'task'},{event:'budget_entry_added'}]);
 const wire=JSON.stringify(h.dataLayer.map(e=>typeof e?.length==='number'?Array.from(e):e));
 for(const leak of [secret,'4242','123456','2026-12-01','9f'])assert.equal(wire.includes(leak),false,`dataLayer must not contain ${leak}`);
});

test('observed fetch ignores failures, reads, foreign origins and the no-consent state',async()=>{
 const h=harness();
 const fetchImpl=observeFetch(fakeFetch(),h.analytics,'https://demo.test');
 await fetchImpl('/api/records/task/1',{method:'PUT',body:'{"version":0}'});
 assert.deepEqual(h.events(),[],'no consent');
 h.analytics.grant();
 await fetchImpl('/api/records/task/1',{method:'GET'});
 await fetchImpl('https://elsewhere.test/api/records/task/1',{method:'PUT',body:'{"version":0}'});
 await observeFetch(fakeFetch(false),h.analytics,'https://demo.test')('/api/records/task/1',{method:'PUT',body:'{"version":0}'});
 assert.deepEqual(h.events().filter(e=>e.event!=='consent_changed'),[]);
});

test('an analytics failure can never break the app request',async()=>{
 const broken={consent:()=>{throw new Error('boom');},track(){throw new Error('boom');}};
 const response=await observeFetch(fakeFetch(),broken,'https://demo.test')('/api/records/task/1',{method:'PUT',body:'{"version":0}'});
 assert.equal(response.ok,true);
});

function route(initial='#today'){
 let hash=initial;const listeners=new Set();
 return {source:{hash:()=>hash,origin:()=>'https://demo.test',onHashChange:l=>{listeners.add(l);return()=>listeners.delete(l);}},go:next=>{hash=next;listeners.forEach(l=>l());}};
}

test('view changes are reported with a sanitized location and sensitive views are bucketed as "other"',()=>{
 const h=harness();h.analytics.grant();
 const r=route('#today');
 const views=observeViews(r.source,h.analytics);views.report();
 r.go('#finances?period=2026-10&account=1234');
 r.go('#prayer');
 r.go('#devotional');
 r.go('#journal');
 r.go('#meals');
 const seen=h.events().filter(e=>e.event==='view_changed');
 assert.deepEqual(seen.map(e=>e.view),['today','finances','other','reminders']);
 assert.equal(seen[1].previous_view,'today');
 assert.equal(seen[1].page_location,'https://demo.test/#finances');
 assert.equal(seen[1].page_title,'Finances, LifeOS');
 assert.equal(JSON.stringify(seen).includes('1234'),false);
 for(const word of ['prayer','devotional','journal'])assert.equal(JSON.stringify(seen).includes(word),false,word);
 views.stop();
});

test('the view on screen is reported once consent is granted, not before',()=>{
 const h=harness();
 const r=route('#school');
 observeViews(r.source,h.analytics).report();
 assert.deepEqual(h.events(),[]);
 h.analytics.grant();
 const seen=h.events().filter(e=>e.event==='view_changed');
 assert.equal(seen.length,1);assert.equal(seen[0].view,'school');assert.equal(seen[0].previous_view,'none');
});

test('view allowlist stays small and explicit',()=>{
 for(const sensitive of ['devotional','prayer','journal','friends'])assert.equal(TRACKED_VIEWS.includes(sensitive),false,sensitive);
 assert.equal(sanitizeView('constructor'),'other');
});

test('build-time ids: placeholders and malformed values disable analytics',()=>{
 assert.equal(configFromEnv({}),null);
 assert.equal(configFromEnv({LIFEOS_GTM_ID:'GTM-XXXXXXX'}),null);
 assert.equal(configFromEnv({LIFEOS_GTM_ID:'GTM-ABC1234" onload="x'}),null);
 assert.equal(configFromEnv({LIFEOS_GTM_ID:'gtm-abc1234'}),null);
 assert.equal(parseGa4Id('G-XXXXXXXXXX'),null);assert.equal(parseGa4Id('UA-12345-1'),null);
 assert.deepEqual(configFromEnv({LIFEOS_GTM_ID:'GTM-ABC1234',LIFEOS_GA4_MEASUREMENT_ID:'G-XXXXXXXXXX'}),{gtmId:'GTM-ABC1234'});
 assert.deepEqual(configFromEnv({LIFEOS_GTM_ID:' GTM-ABC1234 ',LIFEOS_GA4_MEASUREMENT_ID:'G-ABCDE12345'}),config);
 assert.equal(parseGtmId('GTM-ABC1234'),'GTM-ABC1234');
});

test('the runtime re-validates the injected meta tags',()=>{
 const doc=content=>({querySelector:selector=>selector.includes('gtm')&&content?{getAttribute:()=>content}:null});
 assert.deepEqual(configFromDocument(doc('GTM-ABC1234')),{gtmId:'GTM-ABC1234'});
 assert.equal(configFromDocument(doc('https://evil.test/x.js')),null);
 assert.equal(configFromDocument(doc(null)),null);
 assert.equal(hasAnalyticsMeta('<head>'+metaTags(config)+'</head>'),true);
 assert.equal(hasAnalyticsMeta('<head></head>'),false);
});

test('CSP admits Google only for analytics builds, and only the documented hosts',()=>{
 const off=staticSecurityHeaders('https://owner.example.test')['content-security-policy'];
 assert.equal(/google/.test(off),false);
 assert.match(off,/script-src 'self' 'wasm-unsafe-eval';/);assert.match(off,/connect-src 'self';/);
 const on=staticSecurityHeaders('https://owner.example.test',true)['content-security-policy'];
 assert.match(on,/script-src 'self' 'wasm-unsafe-eval' https:\/\/www\.googletagmanager\.com;/);
 assert.match(on,/connect-src 'self' https:\/\/\*\.google-analytics\.com https:\/\/\*\.analytics\.google\.com https:\/\/\*\.googletagmanager\.com;/);
 assert.equal(/unsafe-inline/.test(on.match(/script-src[^;]*/)[0]),false,'scripts stay non-inline');
 assert.match(on,/frame-ancestors https:\/\/owner\.example\.test$/);
});

async function stagedSource(){
 const dir=await mkdtemp(join(tmpdir(),'lifeos-analytics-'));
 const source=join(dir,'public');await mkdir(join(source,'vendor'),{recursive:true});
 await writeFile(join(source,'index.html'),'<!doctype html><html><head><title>x</title></head><body><script type="module" src="/app.js"></script></body></html>');
 await writeFile(join(source,'vendor','analytics.mjs'),'export {};');
 return {dir,source,out:join(dir,'out')};
}
const origins={demoOrigin:'https://demo.example.test',parentOrigin:'https://owner.example.test',requireBrowserEngine:false};

test('hosted build injects ids and a widened CSP only when analytics is configured',async()=>{
 const {dir,source,out}=await stagedSource();
 try{
  await buildHostedAssets({source,directory:out,...origins,analytics:{gtmId:'GTM-ABC1234',ga4Id:'G-ABCDE12345'}});
  const html=await readFile(join(out,'index.html'),'utf8');
  assert.match(html,/<meta name="lifeos-analytics-gtm" content="GTM-ABC1234"><meta name="lifeos-analytics-ga4" content="G-ABCDE12345"><\/head>/);
  assert.match(html,/src="\/demo-bootstrap\.js"/);
  assert.match(await readFile(join(out,'_headers'),'utf8'),/googletagmanager\.com/);
  await buildHostedAssets({source,directory:out,...origins});
  const plain=await readFile(join(out,'index.html'),'utf8');
  assert.equal(/lifeos-analytics|google/i.test(plain),false);
  assert.equal(/google/i.test(await readFile(join(out,'_headers'),'utf8')),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('the GTM container export is internally consistent and matches the event taxonomy',async()=>{
 const doc=JSON.parse(await readFile(new URL('../analytics/gtm/lifeos-demo-container.json',import.meta.url),'utf8'));
 const version=doc.containerVersion;
 assert.equal(doc.exportFormatVersion,2);
 assert.match(JSON.stringify(doc),/GTM-XXXXXXX/);assert.equal(/G-[A-Z0-9]{8,}/.test(JSON.stringify(doc).replace(/G-XXXXXXXXXX/g,'')),false,'no real ids committed');
 const triggers=new Map(version.trigger.map(t=>[t.triggerId,t]));
 const variables=new Set(version.variable.map(v=>`{{${v.name}}}`));
 const builtIns=new Set(['{{_event}}']);
 // Every dataLayer event has exactly one custom-event trigger and one GA4 tag.
 const triggerEvents=version.trigger.map(t=>t.customEventFilter[0].parameter[1].value).sort();
 assert.deepEqual(triggerEvents,[...EVENT_NAMES].sort());
 const eventTags=version.tag.filter(t=>t.type==='gaawe');
 assert.equal(eventTags.length,EVENT_NAMES.length);
 for(const tag of version.tag){
  for(const id of tag.firingTriggerId)assert.ok(triggers.has(id)||id==='2147479573',`${tag.name} -> trigger ${id}`);
  const consent=tag.consentSettings;
  assert.equal(consent.consentStatus,'NEEDED');assert.equal(consent.consentType.list[0].value,'analytics_storage',`${tag.name} requires analytics consent`);
  for(const ref of JSON.stringify(tag).match(/\{\{[^}]+\}\}/g)??[])assert.ok(variables.has(ref)||builtIns.has(ref),`${tag.name} references unknown ${ref}`);
 }
 for(const t of version.trigger)for(const ref of JSON.stringify(t).match(/\{\{[^}]+\}\}/g)??[])assert.ok(variables.has(ref)||builtIns.has(ref),ref);
 assert.ok(version.builtInVariable.some(b=>b.type==='EVENT'));
 const config=version.tag.find(t=>t.type==='googtag');
 assert.deepEqual(config.firingTriggerId,['2147479573']);
 assert.match(JSON.stringify(config),/"send_page_view"[^]*"false"/);
 // Ids are unique.
 const ids=[...version.tag.map(t=>t.tagId),...version.trigger.map(t=>t.triggerId),...version.variable.map(v=>v.variableId)];
 assert.equal(new Set(ids).size,ids.length);
});

test('docs/analytics.md documents every event and view the code can send',async()=>{
 const text=await readFile(new URL('../docs/analytics.md',import.meta.url),'utf8');
 for(const event of EVENT_NAMES)assert.ok(text.includes('`'+event+'`'),`docs mention ${event}`);
 for(const view of TRACKED_VIEWS)assert.ok(text.includes('`'+view+'`'),`docs mention view ${view}`);
});

test('every event has safe page metadata and unexpected runtime fields are discarded',()=>{
 const h=harness();h.analytics.grant();
 h.analytics.track('item_created',{item_type:'task',title:'PRIVATE TITLE',amount:123});
 assert.deepEqual(h.events().at(-1),{event:'item_created',item_type:'task'});
 assert.equal(h.analytics.track('item_created',{item_type:'PRIVATE KIND'}),false);
 assert.equal(h.analytics.track('unknown',{secret:'PRIVATE'}),false);
 const defaults=h.commands().find(c=>c[0]==='set'&&typeof c[1]==='object');
 assert.ok(defaults,'safe GA4 defaults are queued before the container');
 assert.equal(defaults[1].page_referrer,'');
 assert.equal(defaults[1].page_title,'LifeOS public demo');
 assert.equal(defaults[1].page_location,'https://demo.test/');
 assert.equal(defaults[1].send_page_view,false);
});

test('all GTM tags override automatic URL, title and referrer metadata',async()=>{
 const {containerVersion:v}=JSON.parse(await readFile(new URL('../analytics/gtm/lifeos-demo-container.json',import.meta.url),'utf8'));
 for(const tag of v.tag){
  const table=tag.parameter.find(p=>p.key===(tag.type==='googtag'?'configSettingsTable':'eventSettingsTable'));
  const settings=Object.fromEntries(table.list.map(row=>[row.map[0].value,row.map[1].value]));
  assert.equal(settings.page_referrer,'');
  assert.equal(settings.page_location,'{{DLV - page_location}}');
  assert.equal(settings.page_title,'{{DLV - page_title}}');
 }
});

test('consented GA4 collection bypasses local transport only for exact collection endpoints',async()=>{
 const {browserFetch}=await import('../public/browser-demo-transport.js');
 const {analyticsTransport}=await import('../src/analytics/observe.ts');
 const h=harness(),sent=[];
 const network=async(input,init)=>{sent.push({url:String(input),init});return new Response('ok');};
 const local=browserFetch({fetch:async()=>new Response('local')},{origin:'https://demo.test',network});
 const fetchImpl=analyticsTransport(local,network,h.analytics,'https://demo.test');
 const endpoint='https://www.google-analytics.com/g/collect?v=2';
 await assert.rejects(fetchImpl(endpoint,{method:'POST',body:'fixture'}));
 assert.equal(sent.length,0);
 h.analytics.grant();
 await fetchImpl(endpoint,{method:'POST',body:'fixture'});
 assert.equal(sent.length,1);
 assert.equal(sent[0].init.credentials,'omit');assert.equal(sent[0].init.referrerPolicy,'no-referrer');
 for(const url of ['https://evil.test/g/collect','https://www.google-analytics.com.evil.test/g/collect','https://www.google-analytics.com/upload','https://www.googletagmanager.com/g/collect','http://www.google-analytics.com/g/collect'])await assert.rejects(fetchImpl(url,{method:'POST',body:'must stay local'}));
 await assert.rejects(fetchImpl(endpoint,{method:'PUT',body:'must stay local'}));
 assert.equal(await(await fetchImpl('/api/records/task/1',{method:'PUT',body:'private'})).text(),'local');
 assert.equal(sent.length,1);
 h.analytics.deny();
 await assert.rejects(fetchImpl(endpoint,{method:'POST',body:'fixture'}));
 assert.equal(sent.length,1);
});
