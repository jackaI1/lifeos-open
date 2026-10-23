import test from 'node:test';
import assert from 'node:assert/strict';
import {createCookingHelpReview} from '../public/cooking-help-review.js';
import {CookingHelp} from '../public/cooking-help-journal.js';
import {captureCookingHelpIntent} from '../public/cooking-help-contract.js';

class Node{
 constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.children=[];this.attributes={};this.listeners={};this.classList={add(){}};this.value='';}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}removeAttribute(k){delete this.attributes[k];}
 addEventListener(k,v){this.listeners[k]=v;}
 append(child){if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(c=>c!==child);child.parentNode=this;this.children.push(child);}
 replaceChildren(...children){this.children=[];for(const child of children)this.append(child);}
 contains(n){return n===this||this.children.some(c=>c.contains?.(n));}focus(){document.activeElement=this;}
}
const nodes=root=>[root,...root.children.flatMap(nodes)],words=n=>n.textContent+n.children.map(words).join('');
async function fixture(fn,session={mode:'demo',services:{ai:'mock'}},{draftText=''}={}){
 const previous={Node:globalThis.Node,document:globalThis.document};globalThis.Node=Node;globalThis.document={createElement:t=>new Node(t),createTextNode:t=>new Node('#text',t),activeElement:null};
 const host=new Node('section'),stepId=crypto.randomUUID(),entry={value:{token:crypto.randomUUID(),cookId:crypto.randomUUID(),branchId:crypto.randomUUID(),revision:0,source:{kind:'meal',id:'example-soup',version:1,data:{recipe:'Simmer lentils for 20 minutes. Season to taste.'}},steps:[{id:stepId,text:'Simmer lentils for 20 minutes.'}]}};
 const before=structuredClone(entry.value),physical=new Map(),store={async put(k,v){physical.set(k,structuredClone(v));return true;},async inspectPhysical(k){return physical.has(k)?[{key:k,value:physical.get(k)}]:[];},async isDurable(){return true;}};
 let eligible=true;const help=new CookingHelp({sessions:{store,assertEntry(e){assert.equal(e,entry);}},request:async()=>assert.fail('No network'),getScope:()=>({environment:'beta',owner:'demo@example.invalid',entry})});
 const sent=[];help.ask=async(e,{stepId,draftToken})=>{const d=help.draft(e,stepId);assert.equal(d.value.token,draftToken);const intent=captureCookingHelpIntent({schema:1,operation:'explain-step',environment:'beta',owner:help.owner,requestId:crypto.randomUUID(),cookId:e.value.cookId,branchId:e.value.branchId,selectionToken:e.value.token,revision:e.value.revision,source:{...d.value.source,range:d.value.range},selectedStep:d.value.selectedStep,question:d.value.question});sent.push(intent);help.intents.set(intent.requestId,{value:{intent,requestId:intent.requestId}});};
 help.operation=()=>({status:'queued',requestPending:false,durable:true});
 let saved;if(draftText){saved=help.setDraft(entry,{stepId,question:draftText,range:{start:0,end:29}});await saved.persistence;}
 const review=createCookingHelpReview({host,manager:{help},getView:()=>({eligible,entry,stepId,lease:'same-view'}),onAdopt(){},session});
 try{review.render(entry,stepId);await fn({host,entry,before,help,review,sent,saved,retire:()=>{eligible=false;}});}finally{await Promise.all([...help.writes]);review.retire();Object.assign(globalThis,previous);}
}
const control=(root,label)=>nodes(root).find(n=>n.tagName==='button'&&words(n)===label);
const click=async node=>node.listeners.click({currentTarget:node});
test('demo step help is read-only and authored questions submit an exact recipe intent once',()=>fixture(async({host,entry,before,sent,review})=>{
 const question=nodes(host).find(n=>n.tagName==='textarea'&&n.attributes['aria-describedby']);
 assert.equal(question.readOnly,true);assert.equal(question.placeholder,'No AI is connected for this demo, try a question instead.');
 assert.equal(control(host,'Ask').disabled,true);assert.doesNotMatch(words(host),/Local Qwen/);
 const choice=control(host,'Explain this step');assert.ok(choice);await click(choice);await click(choice);
 assert.equal(sent.length,1);assert.equal(sent[0].source.recipe,before.source.data.recipe);assert.equal(sent[0].selectedStep.text,before.steps[0].text);assert.ok(sent[0].question.includes('saved recipe'));
 assert.deepEqual(entry.value,before);assert.equal(review.rawQuestion,sent[0].question);
}));
test('authored choices retain an older question and cannot send from a retired view',()=>fixture(async({host,help,saved,sent,retire})=>{
 const original=structuredClone(saved.value);await click(control(host,'Explain this step'));assert.deepEqual(saved.value,original);assert.ok(help.drafts.has(original.draftId));assert.equal(await help.physical(help.key(original),original),true);
 retire();await click(control(host,'What should I check?'));assert.equal(sent.length,1);
},undefined,{draftText:'My earlier unsent question'}));
test('connected step help retains its editable composer and has no demo choices',()=>fixture(async({host})=>{
 const question=nodes(host).find(n=>n.tagName==='textarea'&&n.attributes['aria-describedby']);assert.notEqual(question.readOnly,true);assert.equal(control(host,'Explain this step'),undefined);assert.match(words(host),/Local Qwen draft/);
},{mode:'owner',services:{ai:'real'}}));
test('an unretained earlier question blocks an example without replacing the draft',()=>fixture(async({host,help,saved,sent,review})=>{
 saved.durable=false;const count=help.drafts.size;await click(control(host,'Explain this step'));
 assert.equal(sent.length,0);assert.equal(help.drafts.size,count);assert.equal(review.rawQuestion,'Keep this question');assert.match(words(host),/earlier question open/);
},undefined,{draftText:'Keep this question'}));
test('oversized automatic excerpts leave the question and original recipe unchanged',()=>fixture(async({host,entry,help,sent,review})=>{
 entry.value.source.data.recipe='Lentils and water. '.repeat(200);review.render(entry,entry.value.steps[0].id);const original=entry.value.source.data.recipe;
 await click(control(host,'Explain this step'));assert.equal(sent.length,0);assert.equal(help.drafts.size,0);assert.equal(review.rawQuestion,'');assert.equal(entry.value.source.data.recipe,original);assert.match(words(host),/shorter excerpt/);
}));
test('all three authored questions submit distinct source-bound requests',()=>fixture(async({host,help,sent,entry,before})=>{
 for(const label of ['Explain this step','What should I check?','Check the recipe instructions']){await Promise.all([...help.writes]);await click(control(host,label));}
 assert.equal(sent.length,3);assert.equal(new Set(sent.map(intent=>intent.question)).size,3);assert.ok(sent.every(intent=>intent.source.range.start===0&&intent.source.range.end===before.source.data.recipe.length));assert.deepEqual(entry.value,before);
}));
