import test from 'node:test';
import assert from 'node:assert/strict';
import {recordData} from '../src/server/validation.mjs';

const profile='https://github.com/jackaI1';

test('project records preserve a public GitHub profile link when edited',()=>{
 const data={title:'LifeOS',category:'personal-project',status:'completed',notes:'',githubUrl:profile};
 assert.deepEqual(recordData('project',data),data);
});

test('owner-selected repositories seed with LifeOS active and six completed projects',async()=>{
 const {publicProjectRecords}=await import('../demo/public-projects.mjs');
 const rows=publicProjectRecords();
 assert.deepEqual(rows.map(row=>[row.data.title,row.data.status,row.data.githubUrl]),[
  ['LifeOS Open','active','https://github.com/jackaI1/lifeos-open'],
  ['Kitchen Renovation Modeling','completed','https://github.com/jackaI1/Kitchen-Renovation-Modeling'],
  ['Structural Review Prototype','completed','https://github.com/jackaI1/structural-review-prototype'],
  ['DistroFit','completed','https://github.com/jackaI1/DistroFit'],
  ['Predictive Workload Management System','completed','https://github.com/jackaI1/predictive-workload-management-system'],
  ['Computer Vision Layout Stamping System','completed','https://github.com/jackaI1/computer-vision-layout-stamping-system'],
  ['Multimodal Drawing Review System','completed','https://github.com/jackaI1/multimodal-drawing-review-system']
 ]);
 assert.equal(new Set(rows.map(row=>row.id)).size,7);
 for(const row of rows){assert.equal(row.data.archived,false);assert.doesNotThrow(()=>recordData('project',row.data));}
 rows[0].data.title='Visitor edit';assert.equal(publicProjectRecords()[0].data.title,'LifeOS Open');
});

test('project links reject non-GitHub, insecure and credential-bearing destinations',()=>{
 const credentialUrl=new URL('https://github.com/project');credentialUrl.username='example';credentialUrl.password='fictional-placeholder';
 for(const githubUrl of ['javascript:alert(1)','http://github.com/jackaI1','https://github.com.evil.test/jackaI1',credentialUrl.href,'https://github.com/jackaI1?token=secret','https://github.com/jackaI1#private','https://github.com/jackaI1/repo/issues','https://github.com/jackaI1/%2e%2e','https://github.com/jackaI1\\repo']){
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
 globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 try{
  const external=projectOpenControl({id:'portfolio',data:{githubUrl:profile}},()=>assert.fail('External project must use its link'));
  assert.equal(external.tagName,'a');
  assert.equal(external.attributes.href,profile);
  assert.equal(external.attributes.target,'_blank');
  assert.equal(external.attributes.rel,'noopener noreferrer');
  assert.equal(external.children[0].textContent,'Open');
  let opened=null;
  const internal={id:'new-user-project',data:{title:'My own project'}},button=projectOpenControl(internal,row=>{opened=row.id;});
  assert.equal(button.tagName,'button');button.listeners.click();assert.equal(opened,'new-user-project');
  const unsafe=projectOpenControl({id:'unsafe',data:{githubUrl:'https://evil.test'}},()=>{});
  assert.equal(unsafe.tagName,'button');
 }finally{globalThis.Node=previousNode;globalThis.document=previousDocument;}
});
