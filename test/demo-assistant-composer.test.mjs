import test from 'node:test';
import assert from 'node:assert/strict';
const demo={mode:'demo',services:{ai:'mock'}};
function controls(value=''){return {input:{value,placeholder:'Ask about your day',attributes:{},classList:{add(){}},setAttribute(name,value){this.attributes[name]=value;}},send:{disabled:false}};}
test('demo chat is visibly unavailable for free typing without erasing an existing draft',async()=>{
 const module=await import('../public/demo-assistant-composer.js').catch(()=>({}));assert.equal(typeof module.configureDemoComposer,'function','demo-only composer state is missing');
 const {input,send}=controls('Original unsent draft');assert.equal(module.configureDemoComposer(demo,input,send),true);assert.equal(input.readOnly,true);assert.equal(input.placeholder,'No AI is connected for this demo, try a question instead.');assert.equal(input.value,'Original unsent draft');assert.equal(input.attributes['aria-disabled'],'true');assert.equal(send.disabled,true);
});
test('a connected model retains normal editable input and sending',async()=>{
 const module=await import('../public/demo-assistant-composer.js').catch(()=>({}));assert.equal(typeof module.configureDemoComposer,'function');
 for(const session of [{mode:'demo',services:{ai:'real'}},{mode:'owner',services:{ai:'mock'}}]){const {input,send}=controls();assert.equal(module.configureDemoComposer(session,input,send),false);assert.equal(input.readOnly,undefined);assert.equal(input.placeholder,'Ask about your day');assert.equal(send.disabled,false);}
});
test('local retrieval accepts typed note questions while finance, project and support retain demo controls',async()=>{
 const {configureDemoComposer}=await import('../public/demo-assistant-composer.js');
 const session={mode:'demo',services:{ai:'mock',retrieval:'local'}};
 for(const scope of ['academics','today','lecture']){
  const {input,send}=controls();assert.equal(configureDemoComposer(session,input,send,scope),false);assert.notEqual(input.readOnly,true);assert.equal(send.disabled,false);
 }
 for(const scope of ['finances','project','support']){
  const {input,send}=controls();assert.equal(configureDemoComposer(session,input,send,scope),true);assert.equal(input.readOnly,true);
 }
});
