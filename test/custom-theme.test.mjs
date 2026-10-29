import test from 'node:test';
import assert from 'node:assert/strict';
import {customPalette,contrastRatio,validateCustomTheme} from '../public/custom-theme.js';
import {recordData} from '../src/server/validation.mjs';
import {createService} from '../src/local/service.ts';
const custom={base:'midnight',name:'Custom',primary:'#7FA6F5',display:'#fafafa',chassis:'#eeeeee'};
test('custom colours correct text contrast on display, chassis and primary',()=>{
 for(const bg of ['#ffffff','#777777','#000000','#ff00ff','#808000']){
  const p=customPalette({...custom,display:bg,chassis:bg,primary:bg});
  for(const [ink,surface] of [[p.displayInk,p.display],[p.ink,p.chassis],[p.primaryInk,p.primary]])assert.ok(contrastRatio(ink,surface)>=4.5);
 }
});
test('custom theme validates bounded names, base themes and literal colours',()=>{
 assert.deepEqual(validateCustomTheme(custom),custom);
 for(const bad of [{...custom,base:'custom'},{...custom,name:' '},{...custom,display:'red'},{...custom,primary:'url(x)'},{...custom,extra:true}])assert.throws(()=>validateCustomTheme(bad));
 assert.equal(recordData('settings',{theme:'custom',customTheme:custom}).theme,'custom');
 assert.throws(()=>recordData('settings',{theme:'custom',customTheme:null}));
});
test('Node settings persist, rename and reset a custom theme without losing preferences',async()=>{
 const app=await createService({database:':memory:'});
 try{
  const session=await(await app.fetch(new Request(app.origin+'/api/session'))).json();
  const read=async()=>(await(await app.fetch(new Request(app.origin+'/api/records/settings/preferences'))).json()).item;
  let record=await read();const wake=record.data.wakeTime;
  const save=async data=>{const r=await app.fetch(new Request(app.origin+'/api/records/settings/preferences',{method:'PUT',headers:{origin:app.origin,'x-lifeos-csrf':session.csrf,'content-type':'application/json'},body:JSON.stringify({mutationId:crypto.randomUUID(),version:record.version,data:{...record.data,...data}})}));assert.equal(r.status,200);record=await read();};
  await save({theme:'custom',customTheme:custom});assert.deepEqual(record.data.customTheme,custom);
  await save({customTheme:{...custom,name:'Evening'}});assert.equal(record.data.customTheme.name,'Evening');
  await save({theme:'midnight',customTheme:null});assert.equal(record.data.theme,'midnight');assert.equal(record.data.customTheme,null);assert.equal(record.data.wakeTime,wake);
 }finally{app.close();}
});
test('opening a custom draft keeps unedited base surfaces and accent links',async()=>{
 const {applyTheme}=await import('../public/themes.js');const values=new Map(),root={dataset:{},style:{removeProperty:key=>values.delete(key),setProperty:(key,value)=>values.set(key,value)}};
 applyTheme('custom',root,{base:'midnight',name:'Custom',primary:'#E8B34B',display:'#070A10',chassis:'#121620'},{persist:false});
 for(const key of ['--plate','--key','--blue','--display-dim'])assert.equal(values.has(key),false,'Unedited primitive must inherit the base palette: '+key);
});
