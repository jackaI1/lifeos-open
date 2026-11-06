import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {readdirSync,readlinkSync,realpathSync} from 'node:fs';

const api=await import('../src/local/retrieval.mjs').catch(()=>({}));
const source=(id,text,extra={})=>({kind:'private-note',id,data:{title:id,text,...extra}});
const embed=async texts=>texts.map(text=>/goggles|lab/i.test(text)?[5,0,0]:/feedback|thermostat/i.test(text)?[0,2,0]:[0,0,3]);

test('chunks preserve every character, overlap and stable source identity',()=>{
 assert.equal(typeof api.chunkSource,'function','source chunker is implemented');
 const text='First paragraph.\n\n'+('Thermostats use feedback. '.repeat(50));
 const chunks=api.chunkSource({key:'private-note/one',title:'One',text},{size:160,overlap:30});
 assert.ok(chunks.length>5);assert.equal(chunks[0].start,0);assert.equal(chunks.at(-1).end,text.length);
 for(const [i,c] of chunks.entries()){
  assert.equal(c.text,text.slice(c.start,c.end));assert.ok(c.text.length<=160);
  if(i)assert.equal(c.start,chunks[i-1].end-30);
  assert.ok(c.id.startsWith('private-note/one#'));
 }
 assert.deepEqual(api.chunkSource({key:'x',title:'Empty',text:'  '}),[]);
 assert.throws(()=>api.chunkSource({key:'x',text},{size:20,overlap:20}));
});

test('source projection excludes non-text, archived sources and cancelled events',()=>{
 assert.equal(typeof api.savedSources,'function','saved-source projection is implemented');
 const sources=api.savedSources([source('one','Useful text'),source('old','Secret old',{archived:true}),
  {kind:'calendar-event',id:'lab',data:{title:'Lab',description:'Bring goggles',location:'S-204',start:{dateTime:'2026-11-06T10:00Z'}}},
  {kind:'calendar-event',id:'gone',data:{title:'Cancelled',status:'cancelled'}},
  {kind:'finance-transaction',id:'money',data:{text:'not in this index'}}]);
 assert.equal(sources.length,2);assert.match(sources[1].text,/S-204/);assert.match(sources[1].text,/2026-11-06/);
 assert.ok(sources.every(s=>!s.text.includes('Secret')));
});

test('SQLite ranking uses cosine, persists, refreshes edits and removes deleted sources',async()=>{
 assert.equal(typeof api.RetrievalIndex,'function','SQLite vector index is implemented');
 const dir=await mkdtemp(join(tmpdir(),'lifeos-rag-'));let index;
 try{
  let embedded=0;const counting=async texts=>{embedded+=texts.length;return embed(texts);};
  index=new api.RetrievalIndex(join(dir,'vectors.sqlite'),{embed:counting,modelId:'test-v1'});
  const sources=api.savedSources([source('lab','Bring goggles to the lab.'),source('feedback','A thermostat uses feedback.')]);
  await index.sync(sources);const first=embedded;await index.sync(sources);assert.equal(embedded,first,'unchanged chunks are reused');
  const matches=await index.search('What should I bring to the lab?',{k:1,threshold:0.5});
  assert.equal(matches[0].sourceKey,'private-note/lab');assert.equal(matches.length,1);
  assert.deepEqual(await index.search('unrelated stars',{threshold:0.5}),[]);
  index.close();index=new api.RetrievalIndex(join(dir,'vectors.sqlite'),{embed,modelId:'test-v1'});
  assert.equal((await index.search('goggles'))[0].sourceKey,'private-note/lab');
  await index.sync(api.savedSources([source('lab','A thermostat uses feedback.',{title:'Updated'})]));
  assert.deepEqual(await index.search('goggles'),[],'old content is not returned after edit or delete');
  assert.equal((await index.search('feedback')).length,1);
 }finally{index?.close();await rm(dir,{recursive:true,force:true});}
});

test('failed embedding refresh is atomic and model changes invalidate cached vectors',async()=>{
 assert.equal(typeof api.RetrievalIndex,'function');
 const dir=await mkdtemp(join(tmpdir(),'lifeos-rag-'));let index;
 try{
  const path=join(dir,'vectors.sqlite');
  index=new api.RetrievalIndex(path,{embed,modelId:'v1'});
  await index.sync(api.savedSources([source('lab','goggles')]));index.close();
  index=new api.RetrievalIndex(path,{embed:async()=>[[NaN,0,0]],modelId:'v1'});
  await assert.rejects(()=>index.sync(api.savedSources([source('lab','new text')])));
  assert.equal(index.db.prepare('SELECT text FROM rag_chunks').get().text,'goggles');index.close();
  index=new api.RetrievalIndex(path,{embed,modelId:'v2'});
  assert.deepEqual(await index.search('goggles'),[]);
 }finally{index?.close();await rm(dir,{recursive:true,force:true});}
});

test('abstention bypasses generation and grounded responses reject fabricated citations',async()=>{
 assert.equal(typeof api.groundedAnswer,'function','grounded answer generation is implemented');
 let called=false;
 const empty=await api.groundedAnswer('unknown',[],async()=>{called=true;throw Error('must not call');});
 assert.equal(empty.abstained,true);assert.match(empty.text,/don't know/i);assert.equal(called,false);
 const hits=[{id:'note/one#0',sourceKey:'note/one',title:'Lab',text:'Bring goggles.',score:0.8}];
 const extract=await api.groundedAnswer('bring?',hits);assert.match(extract.text,/Bring goggles\./);assert.match(extract.text,/\[1\]/);
 const generated=await api.groundedAnswer('bring?',hits,async()=>JSON.stringify({claims:[{text:'Pack goggles.',source:'note/one#0',quote:'Bring goggles.'}]}));
 assert.match(generated.text,/Pack goggles\. \[1\]/);assert.equal(generated.citations[0].sourceKey,'note/one');
 for(const claims of [[{text:'Invented',source:'missing',quote:'Bring goggles.'}],[{text:'Invented',source:'note/one#0',quote:'Bring a rocket.'}]]){
  const result=await api.groundedAnswer('bring?',hits,async()=>JSON.stringify({claims}));
  assert.ok(!result.text.includes('Invented'));assert.match(result.text,/Bring goggles/);
 }
});

test('lecture retrieval stays within the requested course and threshold settings are validated',async()=>{
 const index=new api.RetrievalIndex(':memory:',{embed,modelId:'test'});
 try{
  await index.sync(api.savedSources([source('allowed','Feedback notes',{courseId:'course-a'}),source('other','Feedback notes',{courseId:'course-b'}),source('personal','Feedback diary')]));
  const hits=await index.search('feedback',{courseId:'course-a'});
  assert.deepEqual(hits.map(h=>h.sourceKey),['private-note/allowed']);
  assert.deepEqual(await index.search('feedback',{courseId:'missing'}),[]);
  await assert.rejects(()=>index.search('feedback',{threshold:NaN}));
  await assert.rejects(()=>index.search('feedback',{k:0}));
  assert.deepEqual(await index.search(' '),[]);
 }finally{index.close();}
});

test('incompatible index initialization closes every SQLite file handle before retry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lifeos-rag-schema-')),path=join(dir,'vectors.sqlite');
 try{
  const fixture=new DatabaseSync(path);fixture.exec('CREATE TABLE rag_meta(wrong TEXT)');fixture.close();
  for(let i=0;i<3;i++)assert.throws(()=>new api.RetrievalIndex(path,{embed,modelId:'v1'}));
  let open=false;
  if(process.platform==='linux'){
   const target=realpathSync(path);
   open=readdirSync('/proc/self/fd').some(fd=>{try{return readlinkSync('/proc/self/fd/'+fd)===target;}catch{return false;}});
  }else{
   let files='';
   try{files=execFileSync('lsof',['-a','-p',String(process.pid),'-Fn',path],{encoding:'utf8'});}
   catch(error){if(error.status!==1)throw error;files=String(error.stdout??'');}
   open=files.split('\n').some(line=>line.startsWith('n'));
  }
  assert.equal(open,false,'failed constructors leaked handles to the index file');
 }finally{await rm(dir,{recursive:true,force:true});}
});
