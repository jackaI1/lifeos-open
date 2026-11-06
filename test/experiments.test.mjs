import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EXPERIMENT, analyze, conversion, requiredPerVariant} from '../src/analytics/experiments/analysis.ts';
import {bucket, createExperiment, STATE_KEY, WINDOW_MS} from '../src/analytics/experiments/controller.ts';
import {createAnalytics} from '../src/analytics/datalayer.ts';

const close = (actual, expected, tolerance=1e-7) => assert.ok(Math.abs(actual-expected)<tolerance, `${actual} != ${expected}`);
function harness({enabled=true,privacySignal=false,storage=new Map(),now=()=>1000,id='fictional-browser-1'}={}) {
 const store={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const analytics=createAnalytics({config:null,storage:store,dataLayer:[],loadScript(){throw Error('Local mode must never load Google');},privacySignal});
 return {storage,store,analytics,make:()=>createExperiment({enabled,consent:analytics,storage:store,now,newId:()=>id})};
}
async function settle(experiment) {await experiment.refresh();}
const counts = (n0,x0,n1,x1) => ({experiment:EXPERIMENT,control:{exposures:n0,conversions:x0},treatment:{exposures:n1,conversions:x1}});

test('bucketing matches independent SHA-256 values, stays stable and covers both arms',async()=>{
 const totals={control:0,treatment:0};
 for(let i=0;i<200;i++) {
  const id=`fictional-browser-${i}`;
  const expected=createHash('sha256').update(`${EXPERIMENT}:${id}`).digest().readUInt32BE(0)<0x80000000?'control':'treatment';
  assert.equal(await bucket(id),expected); assert.equal(await bucket(id),await bucket(id)); totals[expected]++;
 }
 assert.ok(totals.control>70 && totals.treatment>70);
 await assert.rejects(bucket(''),/nonempty/);
});

test('flag off always serves control and writes no experiment state, even with consent',async()=>{
 const h=harness({enabled:false}); h.analytics.grant();const e=await h.make();
 assert.equal(e.label(),'New task');assert.equal(e.expose(),false);assert.equal(e.beginOutcome()(true),false);assert.equal(h.storage.has(STATE_KEY),false);e.stop();
});

test('unset, decline and browser privacy signals never log exposure or outcome',async()=>{
 for(const privacySignal of [false,true]) {
  const h=harness({privacySignal}),e=await h.make();
  assert.equal(e.label(),'New task');assert.equal(e.expose(),false);assert.equal(e.beginOutcome()(true),false);assert.equal(h.storage.has(STATE_KEY),false);
  h.analytics.deny();h.analytics.grant();await settle(e);
  if(privacySignal){assert.equal(e.expose(),false);assert.equal(h.storage.has(STATE_KEY),false);}
  e.stop();
 }
});

test('consented assignment and two events survive reload without duplicate counts',async()=>{
 const h=harness();h.analytics.grant();const e=await h.make();
 const variant=await bucket('fictional-browser-1');
 assert.equal(e.variant(),variant);assert.equal(e.label(),variant==='control'?'New task':'Plan a task');
 assert.equal(e.beginOutcome()(true),false,'no outcome before exposure');
 assert.equal(e.expose(),true);assert.equal(e.expose(),false);
 assert.equal(e.beginOutcome()(false),false,'failed save');assert.equal(e.beginOutcome()(true),true);assert.equal(e.beginOutcome()(true),false);
 assert.deepEqual(e.counts()[variant],{exposures:1,conversions:1});e.stop();
 const again=await h.make();assert.equal(again.variant(),variant);assert.deepEqual(again.counts(),e.counts());assert.equal(again.expose(),false);assert.equal(again.beginOutcome()(true),false);again.stop();
});

test('withdrawal erases events and invalidates in-flight saves across regrant',async()=>{
 const h=harness();h.analytics.grant();const e=await h.make();e.expose();const finish=e.beginOutcome();
 h.analytics.deny();assert.equal(h.storage.has(STATE_KEY),false);assert.equal(e.label(),'New task');assert.equal(finish(true),false);
 h.analytics.grant();await settle(e);e.expose();assert.equal(finish(true),false);assert.equal(e.beginOutcome()(true),true);e.stop();
});

test('pre-consent and pre-exposure saves cannot be retroactively counted',async()=>{
 const h=harness(),e=await h.make();const before=e.beginOutcome();h.analytics.grant();await settle(e);const hidden=e.beginOutcome();e.expose();
 assert.equal(before(true),false);assert.equal(hidden(true),false);assert.equal(e.beginOutcome()(true),true);e.stop();
});

test('outcomes outside the 24-hour window are refused',async()=>{
 let clock=1000;const h=harness({now:()=>clock});h.analytics.grant();const e=await h.make();e.expose();const finish=e.beginOutcome();
 clock+=WINDOW_MS+1;assert.equal(finish(true),false);e.stop();
});

test('malformed or blocked storage cannot break experiment use',async()=>{
 const h=harness();h.storage.set(STATE_KEY,'{"id":42,"outcome":1}');h.analytics.grant();const e=await h.make();assert.equal(e.expose(),true);e.stop();
 const store={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const fallback=await createExperiment({enabled:true,consent:h.analytics,storage:store,newId:()=> 'fictional-fallback'});assert.equal(fallback.expose(),true);fallback.stop();
});

test('planned sample size is 1094 per arm and sparse/underpowered results never win',()=>{
 assert.equal(requiredPerVariant(),1094);
 for(const input of [counts(0,0,0,0),counts(20,1,20,19),counts(1093,200,1200,300),counts(1200,0,1200,100),counts(1200,1200,1200,1100)]) {
  const result=analyze(input);assert.equal(result.status,'not enough data');assert.equal(result.winner,null);assert.equal(result.pValue,null);assert.equal(result.z,null);
 }
});

test('pooled z-test and unpooled 95% interval match independent known values',()=>{
 // Independent reference: Python math.erfc and direct textbook formulas.
 const result=analyze(counts(1200,240,1200,300));
 assert.equal(result.status,'winner');assert.equal(result.winner,'treatment');
 close(result.z,2.9329423004270647);close(result.pValue,.003357662859672375);
 close(result.difference,.05);close(result.differenceCi95[0],.01664700238120507);close(result.differenceCi95[1],.08335299761879494);
 const swapped=analyze(counts(1200,300,1200,240));assert.equal(swapped.winner,'control');close(swapped.pValue,result.pValue);close(swapped.z,-result.z);
});

test('equal and unequal sample sizes support honest no-difference reports',()=>{
 const equal=analyze(counts(1200,240,1200,240));assert.equal(equal.status,'no clear difference');assert.equal(equal.winner,null);close(equal.pValue,1);
 const unequal=analyze(counts(1500,300,1200,240));assert.equal(unequal.winner,null);close(unequal.difference,0);
});

test('Wilson intervals match a known 20/100 result and handle boundaries',()=>{
 const result=conversion({exposures:100,conversions:20});close(result.ci95[0],.1333669333310325);close(result.ci95[1],.2888291655931589);
 assert.equal(conversion({exposures:0,conversions:0}).ci95,null);
 close(conversion({exposures:100,conversions:0}).ci95[0],0);close(conversion({exposures:100,conversions:100}).ci95[1],1);
});

test('invalid counts and incompatible experiment plans fail closed',()=>{
 for(const bad of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>analyze(counts(bad,0,1200,240)),/safe integers/);
 assert.throws(()=>analyze(counts(10,11,1200,240)),/conversions/);
 assert.throws(()=>analyze({...counts(1200,240,1200,300),experiment:'wrong'}),/incompatible/);
});
