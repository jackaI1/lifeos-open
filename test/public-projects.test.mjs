import test from 'node:test';
import assert from 'node:assert/strict';
import {recordData} from '../src/server/validation.mjs';

const profile='https://github.com/example';

test('project records preserve a public GitHub profile link when edited',()=>{
 const data={title:'LifeOS',category:'personal-project',status:'completed',notes:'',githubUrl:profile};
 assert.deepEqual(recordData('project',data),data);
});

test('fictional repositories seed with LifeOS active and six completed projects',async()=>{
 const {publicProjectRecords}=await import('../demo/public-projects.mjs');
 const rows=publicProjectRecords();
 assert.deepEqual(rows.map(row=>[row.data.title,row.data.status,row.data.githubUrl]),[
  ['LifeOS Open','active','https://github.com/example/lifeos-open'],
  ['Community Garden Planner','completed','https://github.com/example/community-garden-planner'],
  ['Library Catalogue','completed','https://github.com/example/library-catalogue'],
  ['Habit Tracker','completed','https://github.com/example/habit-tracker'],
  ['Reading Queue','completed','https://github.com/example/reading-queue'],
  ['Weather Dashboard','completed','https://github.com/example/weather-dashboard'],
  ['Sketchbook','completed','https://github.com/example/sketchbook']
 ]);
 assert.equal(new Set(rows.map(row=>row.id)).size,7);
 for(const row of rows){assert.equal(row.data.archived,false);assert.doesNotThrow(()=>recordData('project',row.data));}
 rows[0].data.title='Visitor edit';assert.equal(publicProjectRecords()[0].data.title,'LifeOS Open');
});

test('project links reject non-GitHub, insecure and credential-bearing destinations',()=>{
 const credentialUrl=new URL('https://github.com/project');credentialUrl.username='example';credentialUrl.password='fictional-placeholder';
 for(const githubUrl of ['javascript:alert(1)','http://github.com/jackaI1','https://github.com.evil.test/jackaI1',credentialUrl.href,'https://github.com/example?token=secret','https://github.com/example#private','https://github.com/example/repo/issues','https://github.com/example/%2e%2e','https://github.com/example\\repo']){
  assert.throws(()=>recordData('project',{title:'Example',githubUrl}),undefined,githubUrl);
 }
});

test('GitHub projects open externally while ordinary projects keep their editor',async()=>{
 const {projectOpenControl}=await import('../public/project-open.js');
 class Node {
  constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.attributes={};this.children=[];this.listeners={};}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(type,handler){this.listeners[type]=handler;}
  append(child){this.children.push(child);}
 }
 const previousNode=globalThis.Node,previousDocument=globalThis.document;
 globalThis.Node=Node;
 globalThis.document={createElementNS:(_namespace,tag)=>new Node(tag),createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 try{
  const external=projectOpenControl({id:'portfolio',data:{githubUrl:profile}},()=>assert.fail('External project must use its link'));
  assert.equal(external.tagName,'a');
  assert.equal(external.attributes.href,profile);
  assert.equal(external.attributes.target,'_blank');
  assert.equal(external.attributes.rel,'noopener noreferrer');
  assert.equal(external.children[0].textContent,'Open');
  let opened=null;
  const internal={id:'new-user-project',data:{title:'My own project'}},button=projectOpenControl(internal,row=>{opened=row.id;});
  assert.equal(button.tagName,'button');assert.equal(button.attributes['aria-label'],'Open');assert.equal(button.children[0].tagName,'svg');button.listeners.click();assert.equal(opened,'new-user-project');
  const unsafe=projectOpenControl({id:'unsafe',data:{githubUrl:'https://evil.test'}},()=>{});
  assert.equal(unsafe.tagName,'button');
 }finally{globalThis.Node=previousNode;globalThis.document=previousDocument;}
});
